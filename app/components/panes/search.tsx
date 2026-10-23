"use client";

// [Librarian, Guru]
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/hooks/use-lang";
import { factMeta } from "@/lib/note/fact-line";
import { useCounts } from "@/hooks/use-notes-page";
import { tagsByUse } from "@/lib/note/notes-page";
import { ShowMore } from "@/components/note-pages";
import { useSearch } from "@/hooks/use-search";
import { useApi } from "@/lib/api";
import type { FactHit } from "@/lib/note/fact-line";
import { noteName, normalizeTags } from "@/lib/note/filing";
import { NoteRow } from "@/components/note-row";
import { BrainHits } from "@/components/what-next";
import { type BrainStart, OPEN_BRAIN } from "@/components/home-dashboard";
import { NoteShortcuts } from "@/components/note-shortcuts";
import { SwitchesNotice } from "@/components/switches-notice";
import { Button, Chip, Heading, Input, List, Notice, Reveal, selectClass } from "@/components/ui";

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
 * facts already read out of it. Searching by meaning costs a model call, so
 * it is a button, never a keystroke; Ask opens the Brain on the question
 * typed and these filters, where the answer is priced and written.
 */
export function SearchPane() {
  const { t, lang } = useLang();
  const params = useSearchParams();
  // An address can carry a search — a shared or bookmarked link, or Enter in
  // the sidebar — and a tag view's "Search these notes" narrows it by `tags`.
  const asked = params.get("q") || "";
  const within = normalizeTags((params.get("tags") || "").split(","));
  const { query, setQuery, setFilters, results, searching, active, runFuzzy, fuzzying, fuzzy, more, showMore, brain } = useSearch();
  const counts = useCounts().data;

  const [showFilters, setShowFilters] = useState(within.length > 0);
  const [tagFilters, setTagFilters] = useState<string[]>(within);
  const [range, setRange] = useState<Range>("any");
  const [language, setLanguage] = useState("");
  const [actionsOnly, setActionsOnly] = useState(false);
  // Cold storage and Trash are searched only here, by words, never by the AI.
  const [where, setWhere] = useState<"" | "cold" | "trash">("");
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

  // The tags on offer are the ones the store actually uses, most used first.
  const tags = tagsByUse(counts?.sets ?? []);

  const pinned = (counts?.pinned ?? []).map((n) => ({ id: n.id, path: n.path, label: noteName(n.path, n.label) }));

  // The question goes to the Brain with the filters it was typed under; the
  // answer is priced and written there.
  function ask(event: React.MouseEvent<HTMLButtonElement>) {
    const start: BrainStart = { ask: { q: trimmed, tags: tagFilters, from, language: language || null, actions: actionsOnly } };
    event.currentTarget.dispatchEvent(new CustomEvent(OPEN_BRAIN, { bubbles: true, detail: start }));
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      {/* On a wide screen the sidebar's box is this box; one is enough. */}
      <div className="mb-3 flex gap-2 md:hidden">
        <Input type="search" data-tip={t("tipSearchBox")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} />
      </div>

      <SwitchesNotice kind="hidden" />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Chip on={showFilters} aria-expanded={showFilters} tip={t("tipSearchFilter")} onClick={() => setShowFilters(!showFilters)}>
          {t("filter")}
        </Chip>
      </div>
      <Reveal open={showFilters}>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <select data-tip={t("tipSearchRange")} value={range} onChange={(e) => setRange(e.target.value as Range)} className={selectClass}>
            <option value="any">{t("filterAnyTime")}</option>
            <option value="week">{t("filterWeek")}</option>
            <option value="month">{t("filterMonth")}</option>
            <option value="year">{t("filterYear")}</option>
          </select>
          <select data-tip={t("tipSearchLanguage")} value={language} onChange={(e) => setLanguage(e.target.value)} className={selectClass}>
            <option value="">{t("filterAnyLang")}</option>
            <option value="en">{t("filterEnglish")}</option>
            <option value="cs">{t("filterCzech")}</option>
          </select>
          <Chip on={actionsOnly} tip={t("tipSearchActions")} onClick={() => setActionsOnly(!actionsOnly)}>
            {t("filterActions")}
          </Chip>
          <select data-tip={t("tipSearchShelf")} value={where} onChange={(e) => setWhere(e.target.value as typeof where)} className={selectClass}>
            <option value="">{t("shelfNormal")}</option>
            <option value="cold">{t("shelfCold")}</option>
            <option value="trash">{t("shelfTrash")}</option>
          </select>
        </div>
        {tags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Chip
                key={tag}
                on={tagFilters.includes(tag)}
                tip={t("tipSearchTag")}
                onClick={() =>
                  setTagFilters((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
                }
              >
                #{tag}
              </Chip>
            ))}
          </div>
        )}
      </Reveal>

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

      {!active ? (
        // Before a word is typed, the two shortest routes back to a note.
        <div>
          <p className="mb-4 text-sm text-muted-foreground">{t("searchEmpty")}</p>
          <NoteShortcuts pinned={pinned} hidden={counts?.hiddenIds} />
        </div>
      ) : (
        <>
          {fuzzy && results && results.length > 0 && (
            <div className="mb-2 text-xs uppercase tracking-wide text-primary">{t("fuzzyDone")}</div>
          )}
          {fuzzying ? (
            <div className="text-muted-foreground">{t("fuzzying")}</div>
          ) : results === null || searching ? null : results.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{t("searchNoResults")}</div>
          ) : (
            <>
              <List>
                {results.map((result) => (
                  <NoteRow key={result.note.id} note={result.note} excerpt={result.excerpt} />
                ))}
              </List>
              {more && !fuzzy && <ShowMore onMore={showMore} />}
            </>
          )}
          {!fuzzy && !where && brain.length > 0 && <BrainHits rows={brain} />}

          {/* The two ways further, after the free answer has been seen. */}
          {!where && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button tip={t("tipSearchMeaning")} onClick={runFuzzy} disabled={fuzzying || fuzzy}>
                {fuzzying ? t("fuzzying") : t("searchByMeaning")}
              </Button>
              {trimmed.length >= 3 && (
                <Button tip={t("tipSearchAsk")} onClick={ask}>
                  {t("askNotes")}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
