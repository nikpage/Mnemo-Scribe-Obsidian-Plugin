"use client";

// [Librarian, Guru]
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/hooks/use-lang";
import { factMeta } from "@/lib/note/fact-line";
import { useNotes } from "@/components/app-shell";
import { searchParams, useSearch } from "@/hooks/use-search";
import { api, useApi } from "@/lib/api";
import type { FactHit } from "@/lib/note/fact-line";
import { noteName, normalizeTags } from "@/lib/note/filing";
import { NoteRow } from "@/components/note-row";
import { SpentLine } from "@/components/what-next";

type Spent = { costUsd: number; readTokens: number; wroteTokens: number };
import { NoteShortcuts } from "@/components/note-shortcuts";
import { Button, Chip, Cost, Heading, Input, List, Notice, selectClass } from "@/components/ui";

/** How far back a search looks. Days, or everything. */
const RANGES = { any: 0, week: 7, month: 30, year: 365 } as const;
type Range = keyof typeof RANGES;

function since(range: Range): string | null {
  if (range === "any") return null;
  const from = new Date();
  from.setDate(from.getDate() - RANGES[range]);
  return from.toISOString();
}

/**
 * Finding a note. Typing is free: words matched against the store, and the
 * facts already read out of it. Searching by meaning and asking for a
 * written answer each cost a model call, so each is a button, never a
 * keystroke.
 */
export function SearchPane() {
  const { t, lang } = useLang();
  const params = useSearchParams();
  // An address can carry a search — a shared or bookmarked link, or Enter in
  // the sidebar — and a tag view's "Search these notes" narrows it by `tags`.
  const asked = params.get("q") || "";
  const within = normalizeTags((params.get("tags") || "").split(","));
  const { query, setQuery, setFilters, results, searching, active, runFuzzy, fuzzying, fuzzy } = useSearch();
  const { recordings } = useNotes();

  const [showFilters, setShowFilters] = useState(within.length > 0);
  const [tagFilters, setTagFilters] = useState<string[]>(within);
  const [range, setRange] = useState<Range>("any");
  const [language, setLanguage] = useState("");
  const [actionsOnly, setActionsOnly] = useState(false);
  // Cold storage and Trash are searched only here, by words, never by the AI.
  const [where, setWhere] = useState<"" | "cold" | "trash">("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [noCredits, setNoCredits] = useState(false);
  const [asking, setAsking] = useState(false);
  const [priceChanged, setPriceChanged] = useState<number | null>(null);
  const [spent, setSpent] = useState<Spent | undefined>(undefined);
  // What the store already knows about the words being typed. The one
  // request a keystroke may make: rows read when each note completed, so no
  // model, no embedding and nothing billed.
  const from = since(range);

  useEffect(() => {
    if (asked) setQuery(asked);
    // The address seeds the search once; after that the box owns it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  useEffect(() => {
    setFilters({ tags: tagFilters, from, language, actionsOnly, ...(where ? { shelf: where } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilters.join(","), from, language, actionsOnly, where]);

  const trimmed = query.trim();
  // Asked for once typing pauses, not on every key.
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(trimmed), 350);
    return () => clearTimeout(timer);
  }, [trimmed]);
  const facts =
    useApi<{ facts: FactHit[] }>(settled.length >= 3 ? `/api/notes/facts?q=${encodeURIComponent(settled)}` : null, {
      keepPreviousData: true,
    }).data?.facts ?? [];
  const shownFacts = trimmed.length >= 3 && !where ? facts : [];

  // An answer's price, asked once a question is long enough to ask: it moves
  // with the store, never with the words typed.
  const { data: price, mutate: requote } = useApi<{ credits: number; balance: number }>(trimmed.length >= 3 ? "/api/notes/search/quote" : null);
  const askWhy = price ? t("costAsk", { n: price.credits, balance: price.balance }) : undefined;

  // A new question clears the last written answer.
  const [answeredFor, setAnsweredFor] = useState("");

  // The tags on offer are the ones the store actually uses, most used first.
  const tagCounts = new Map<string, number>();
  for (const note of recordings) {
    if (note.status !== "done") continue;
    for (const tag of note.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30);

  const pinned = recordings
    .filter((n) => n.pinned && n.status === "done")
    .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))
    .map((n) => ({ id: n.id, path: n.path, label: noteName(n.path, n.label) }));

  // The written answer carries the same filters as the search it is asked
  // of, and finds its notes by meaning as well — it is already a billed press.
  async function ask() {
    const p = searchParams(trimmed, { tags: tagFilters, from, language, actionsOnly });
    p.set("answer", "1");
    p.set("fuzzy", "1");
    setAsking(true);
    setAnswer(null);
    if (price?.credits != null) p.set("credits", String(price.credits));
    const data = await api<{ answer?: string; declined?: boolean; noCredits?: boolean; priceChanged?: number; spent?: Spent }>(`/api/notes/search?${p}`).catch(() => null);
    setSpent(data?.spent);
    if (data?.priceChanged !== undefined) await requote();
    setPriceChanged(data?.priceChanged ?? null);
    setAnswer(data?.answer || null);
    setDeclined(Boolean(data?.declined));
    setNoCredits(Boolean(data?.noCredits));
    setAnsweredFor(trimmed);
    setAsking(false);
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      {/* On a wide screen the sidebar's box is this box; one is enough. */}
      <div className="mb-3 flex gap-2 md:hidden">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Chip on={showFilters} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          {t("filter")}
        </Chip>
        {showFilters && (
          <>
            <select value={range} onChange={(e) => setRange(e.target.value as Range)} className={selectClass}>
              <option value="any">{t("filterAnyTime")}</option>
              <option value="week">{t("filterWeek")}</option>
              <option value="month">{t("filterMonth")}</option>
              <option value="year">{t("filterYear")}</option>
            </select>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={selectClass}>
              <option value="">{t("filterAnyLang")}</option>
              <option value="en">{t("filterEnglish")}</option>
              <option value="cs">{t("filterCzech")}</option>
            </select>
            <Chip on={actionsOnly} onClick={() => setActionsOnly(!actionsOnly)}>
              {t("filterActions")}
            </Chip>
            <select value={where} onChange={(e) => setWhere(e.target.value as typeof where)} className={selectClass}>
              <option value="">{t("shelfNormal")}</option>
              <option value="cold">{t("shelfCold")}</option>
              <option value="trash">{t("shelfTrash")}</option>
            </select>
          </>
        )}
      </div>

      {showFilters && tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1">
          {tags.map(([tag]) => (
            <Chip
              key={tag}
              on={tagFilters.includes(tag)}
              onClick={() =>
                setTagFilters((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
              }
            >
              #{tag}
            </Chip>
          ))}
        </div>
      )}

      {shownFacts.length > 0 && (
        <Notice className="mb-4">
          <Heading>{t("knownAlready")}</Heading>
          <ul className="space-y-1 text-sm">
            {shownFacts.map((fact) => (
              <li key={fact.id}>
                <Link href={`/transcript/${fact.recordingId}`} className="hover:underline">
                  <span className="font-medium">{fact.subject}</span>
                  <span className="text-muted-foreground">
                    {": "}
                    {factMeta(fact, lang)}
                  </span>
                  {fact.valueText}
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {declined && answeredFor === trimmed && <Notice className="mb-4">{t("aiDeclinedAsk")}</Notice>}
      {noCredits && answeredFor === trimmed && <Notice className="mb-4">{t("outOfCredits")}</Notice>}
      {priceChanged !== null && answeredFor === trimmed && <Notice className="mb-4">{t("priceChanged", { n: priceChanged })}</Notice>}

      {answer && answeredFor === trimmed && (
        <Notice tone="primary" className="mb-4">
          <Heading className="text-primary">{t("answerFrom")}</Heading>
          <p className="whitespace-pre-wrap">{answer}</p>
          <SpentLine spent={spent} />
        </Notice>
      )}

      {!active ? (
        // Before a word is typed, the two shortest routes back to a note.
        <div>
          <p className="mb-4 text-sm text-muted-foreground">{t("searchEmpty")}</p>
          <NoteShortcuts pinned={pinned} />
        </div>
      ) : (
        <>
          {fuzzy && results && results.length > 0 && (
            <div className="mb-2 text-xs uppercase tracking-wide text-primary">{t("fuzzyDone")}</div>
          )}
          {results === null || searching || fuzzying ? (
            <div className="text-muted-foreground">{fuzzying ? t("fuzzying") : t("loading")}</div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{t("searchNoResults")}</div>
          ) : (
            <List>
              {results.map((result) => (
                <NoteRow key={result.note.id} note={result.note} excerpt={result.excerpt} />
              ))}
            </List>
          )}

          {/* The two paid ways further, after the free answer has been seen. */}
          {!where && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={runFuzzy} disabled={fuzzying || fuzzy}>
                {fuzzying ? t("fuzzying") : t("searchByMeaning")}
              </Button>
              {trimmed.length >= 3 && (
                <Button onClick={ask} disabled={asking} title={askWhy}>
                  {asking ? t("asking") : t("askNotes")}
                  <Cost credits={price?.credits} why={askWhy} />
                </Button>
              )}
            </div>
          )}
          {/* The answer's price in words, where a phone can read it. */}
          {trimmed.length >= 3 && !where && <p className="mt-1 min-h-4 text-xs text-muted-foreground">{price?.credits ? askWhy : ""}</p>}
        </>
      )}
    </div>
  );
}
