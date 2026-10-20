"use client";

// [Guru]
import { type ReactNode, useMemo, useState } from "react";
import { ApiError, allAnswered, answeredNow, send, useApi } from "@/lib/api";
import { useCounts } from "@/hooks/use-notes-page";
import { tagsByUse } from "@/lib/note/notes-page";
import { busyUntilDone } from "@/lib/busy";
import { useLang } from "@/hooks/use-lang";
import { formatDate, formatFactDate } from "@/lib/format";
import { readingSections } from "@/lib/note/reading-sections";
import { EVERYTHING, type Kind, type Narrow, type Scope, type Trail, dropTag, flipTag, liveNarrow, monthsBefore, readingOf, startOf, subjectOf } from "@/lib/note/what-next-target";
import { type LibraryRow, askedOf, kindOf } from "@/lib/note/brain-library";
import { webSetHref } from "@/lib/note/web-set";
import Link from "next/link";
import { Plus } from "lucide-react";
import { tipOf } from "@/lib/tooltip";
import { Button, Chip, Cost, Heading, Input, Notice, Options, Pill, buttonClass } from "@/components/ui";
import { NoteSection } from "@/components/note-section";
import { Additions, PressButton, Prose, type Quote, ReadingProse, Sections, type Spent, SpentLine, type Under } from "@/components/reading-prose";

type Status = "running" | "done" | "failed";
type Row = { id: string; target: string; part: string | null; status: Status; reading: string | null; created_at: string; notes?: number | null; spent?: Spent };
type Answer = { reading: Row | null; failed: "failed" | "declined" | null; more: Row[] };
type Suggestion = { label: string; subject: string; jobs: Kind[] };
/** What the Brain is asked for: a reading of one kind, or one question answered. */
type Job = Kind | "ask";
/** A written answer as the server holds it while it is written and after. */
type Asked = { status: Status; answer: string | null; declined: boolean; spent?: Spent };

/** A question brought from Search: its words and the filters it was typed under. */
export type AskStart = { q: string; tags: string[]; from: string | null; language: string | null; actions: boolean };

/** The jobs in the order they are offered, each named by what the person is about to do. */
const JOBS: Kind[] = ["inspiration", "next-best", "study", "log"];
export const JOB_LABEL = { ask: "jobAsk", picture: "jobPicture", inspiration: "jobInspiration", "next-best": "jobNextBest", study: "jobStudy", log: "jobLog" } as const;
/** What each job hands back, in a line under its name: said from what its prompt asks for. */
const JOB_WHAT = { ask: "jobAskWhat", picture: "jobPictureWhat", inspiration: "jobInspirationWhat", "next-best": "jobNextBestWhat", study: "jobStudyWhat", log: "jobLogWhat" } as const;

/** How far back the notes go: a few spans, or dates picked. */
const WHENS = ["any", "month", "3m", "year", "pick"] as const;
type When = (typeof WHENS)[number];
const WHEN_LABEL = { any: "brainAnyTime", month: "brainLastMonth", "3m": "brainLast3", year: "brainLastYear", pick: "brainPickDates" } as const;
const WHEN_TIP = { any: "tipWhenAny", month: "tipWhenMonth", "3m": "tipWhen3m", year: "tipWhenYear", pick: "tipWhenPick" } as const;
const WHEN_MONTHS = { any: 0, month: 1, "3m": 3, year: 12, pick: 0 } as const;

/** The newest readings the Brain panel names; the rest are in the Brain library. */
const LATEST = 10;

export const quoteUrl = (scope: Scope, target: string, parentId?: string) =>
  `/api/notes/what-next/quote?scope=${scope}&target=${encodeURIComponent(target)}${parentId ? `&parentId=${parentId}` : ""}`;

/**
 * The reading last asked for in `scope`, read back free while `open`, and
 * pressing for a new one or an Elaborate at the price the screen shows.
 *
 * A press runs on the server after the request ends, so the block asks
 * every 3 s while anything is being written; a reload keeps asking.
 */
function useReading(scope: Scope, asked: string, open: boolean) {
  const { t } = useLang();
  const { data, mutate } = useApi<Answer>(open ? `/api/notes/what-next?scope=${scope}&target=${encodeURIComponent(asked)}` : null, {
    refreshInterval: (latest) =>
      latest?.reading?.status === "running" || latest?.more.some((m) => m.status === "running") ? 3000 : 0,
  });
  const [pressed, setPressed] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reading = data?.reading ?? null;
  const done = reading?.status === "done" && reading.reading ? reading : null;
  const writing = Boolean(pressed) || reading?.status === "running" || Boolean(data?.more.some((m) => m.status === "running"));
  const failed = data?.failed ? t(data.failed === "declined" ? "aiDeclinedAsk" : "whatNextFailed") : null;
  const elaborateQuote = useApi<Quote>(open && done ? quoteUrl(scope, done.target, done.id) : null);

  /** Presses at `credits`, the price shown; a changed price is shown instead and nothing runs. */
  async function press(key: string, body: { scope?: Scope; target: string; parentId?: string; part?: string }, credits: number | null | undefined, requote: () => Promise<Quote | undefined>) {
    setPressed(key);
    setNote(null);
    // Off Netlify the work happens inside this request; a reload would lose it.
    const releasePage = busyUntilDone();
    try {
      await send("/api/notes/what-next", "POST", { scope, ...body, ...(credits == null ? {} : { credits }) });
      await mutate();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 412) {
        const fresh = await requote();
        setNote(t("priceChanged", { n: fresh?.credits ?? "?" }));
      } else {
        setNote(t(status === 402 ? "outOfCredits" : status === 409 ? "whatNextBusy" : "whatNextFailed"));
      }
    } finally {
      releasePage();
      setPressed(null);
    }
  }

  return { data, reading, done, writing, pressed, press, elaborateQuote, message: note ?? failed };
}

/**
 * One question answered from the notes, the notes found by meaning within
 * the filters given, quoting the notes it used: priced before the press
 * (`search/quote`), written on the server after the press's request has
 * ended (`ask-background`) and asked for every 2 s until it lands.
 */
function useAsk(on: boolean) {
  const { t } = useLang();
  const quote = useApi<{ credits: number; balance: number }>(on ? "/api/notes/search/quote" : null);
  const [pressing, setPressing] = useState(false);
  const [askId, setAskId] = useState<string | null>(null);
  const [asked, setAsked] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const answering = useApi<Asked>(askId ? `/api/notes/search/ask?id=${askId}` : null, {
    refreshInterval: (latest) => (latest?.status === "running" ? 2000 : 0),
  }).data;
  const asking = pressing || Boolean(askId && (!answering || answering.status === "running"));
  const done = answering?.status === "done" ? answering : null;
  const failed = answering?.status === "failed" ? t("whatNextFailed") : done?.declined ? t("aiDeclinedAsk") : null;

  /** Asks `body.q` at the price shown; a changed price is shown instead and nothing runs. */
  async function press(body: { q: string; tags: string[]; from: string | null; to: string | null; language: string | null; actions: boolean }) {
    setPressing(true);
    setAskId(null);
    setNote(null);
    setAsked(body.q);
    // Off Netlify the work happens inside this request; a reload would lose it.
    const releasePage = busyUntilDone();
    try {
      const credits = quote.data?.credits;
      const { askId: id } = await send<{ askId: string }>("/api/notes/search/ask", "POST", { ...body, ...(credits != null ? { credits } : {}) });
      setAskId(id);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 412) setNote(t("priceChanged", { n: (await quote.mutate())?.credits ?? "?" }));
      else setNote(t(status === 402 ? "outOfCredits" : status === 409 ? "whatNextBusy" : "whatNextFailed"));
    } finally {
      releasePage();
      setPressing(false);
    }
  }

  return { price: quote.data, asking, asked, done, message: note ?? failed, press };
}

/** The reading itself, each heading with its Elaborate at its price. */
function ReadingBody({ reading, label }: { reading: ReturnType<typeof useReading>; label?: string }) {
  const { lang, t } = useLang();
  const { done, data, writing, pressed, press, elaborateQuote } = reading;
  if (!done) return null;
  const elaborated = (part: string) => data?.more.find((m) => m.part === part && m.status !== "failed");
  const price = elaborateQuote.data;
  const why = price?.credits != null ? t("costReading", { n: price.credits, notes: price.notes ?? 0, balance: price.balance ?? 0 }) : undefined;
  return (
    <div className="mb-4 space-y-4" data-reading>
      <p className="text-xs text-muted-foreground">
        {label && `${label} · `}
        {formatDate(done.created_at, lang)}
      </p>
      <SpentLine spent={done.spent} />
      {readingSections(done.reading!).map((section, i) => {
        const more = section.heading ? elaborated(section.heading) : undefined;
        return (
          <section key={i}>
            {section.heading && <h3 className="mb-1 text-sm font-semibold">{section.heading}</h3>}
            {section.body && <Prose text={section.body} />}
            {section.heading &&
              section.body &&
              (more?.status === "done" && more.reading ? (
                <div className="mt-2 border-l-2 border-border pl-3">
                  <Prose text={readingSections(more.reading).map((s) => [s.heading, s.body].filter(Boolean).join("\n\n")).join("\n\n")} />
                  <SpentLine spent={more.spent} />
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="link"
                  className="mt-1"
                  disabled={writing || price?.credits === null}
                  tip={tipOf(t("tipElaborate"), why)}
                  onClick={() => press(`more:${section.heading}`, { target: done.target, parentId: done.id, part: section.heading! }, price?.credits, async () => (await elaborateQuote.mutate()) ?? undefined)}
                >
                  {more?.status === "running" || pressed === `more:${section.heading}` ? t("whatNextReading") : t("whatNextElaborate")}
                  <Cost credits={price?.credits} why={why} />
                </Button>
              ))}
          </section>
        );
      })}
      <Additions more={data?.more ?? []} />
    </div>
  );
}

/** One earlier reading in full, read back free: each heading and its text, nothing to press. */
export function ReadingText({ scope, target }: { scope: Scope; target: string }) {
  const { data } = useApi<Answer>(`/api/notes/what-next?scope=${scope}&target=${encodeURIComponent(target)}`);
  const text = data?.reading?.status === "done" ? data.reading.reading : null;
  if (!text) return null;
  return (
    <div className="space-y-4">
      <Sections text={text} />
    </div>
  );
}

/** One Brain output read back by its id, free: its text with every Elaborate and addition. */
export function ReadingById({ id }: { id: string }) {
  const { data } = useApi<{ reading: { reading: string | null }; more: Under[] }>(`/api/notes/what-next?id=${encodeURIComponent(id)}`);
  const text = data?.reading.reading;
  return text ? <ReadingProse text={text} more={data.more} /> : null;
}

/**
 * Brain outputs a search found, apart from the notes: the Brain's words, not
 * the person's. Each opens in place, free, so the app and the plugins show it
 * the same way.
 */
export function BrainHits({ rows }: { rows: LibraryRow[] }) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-sm font-semibold">{t("brainLibrary")}</h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Button variant="link" size="sm" className="text-left" aria-expanded={open === r.id} tip={t("tipBrainHit")} onClick={() => setOpen(open === r.id ? null : r.id)}>
              {r.title || t(JOB_LABEL[kindOf(r.scope, r.target)])} · {t(JOB_LABEL[kindOf(r.scope, r.target)])} · {formatDate(r.created_at, lang)}
            </Button>
            {open === r.id && (
              <div className="mt-2 border-l-2 border-border pl-3">
                <ReadingById id={r.id} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Notes come in since a reading: how many, and "Add what's new", which reads
 * only those against the reading and writes what they change under it, at
 * the price on the button. Says so when none have come in. `writing` is an
 * addition already being written; `onPressed` asks the page again.
 */
export function AddNew({ reading, writing, onPressed }: { reading: { id: string; scope: Scope; target: string; created_at: string }; writing: boolean; onPressed: () => Promise<unknown> }) {
  const { lang, t } = useLang();
  const quote = useApi<Quote>(`${quoteUrl(reading.scope, reading.target)}&add=${reading.id}`);
  const [pressed, setPressed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!allAnswered(quote)) return null;
  const price = quote.data;
  const fresh = price?.notes ?? 0;
  const why = price?.credits != null ? t("costReading", { n: price.credits, notes: fresh, balance: price.balance ?? 0 }) : undefined;
  const busy = pressed || writing;

  async function add() {
    setPressed(true);
    setNote(null);
    const releasePage = busyUntilDone();
    try {
      await send("/api/notes/what-next", "POST", { scope: reading.scope, target: reading.target, parentId: reading.id, add: true, ...(price?.credits == null ? {} : { credits: price.credits }) });
      await onPressed();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 412) {
        const fresh = await quote.mutate();
        setNote(t("priceChanged", { n: fresh?.credits ?? "?" }));
      } else {
        setNote(t(status === 402 ? "outOfCredits" : status === 409 ? "whatNextBusy" : "whatNextFailed"));
      }
    } finally {
      releasePage();
      setPressed(false);
      void quote.mutate();
    }
  }

  return (
    <section className="space-y-2" data-add-new>
      <h3 className="text-sm font-semibold">{t("addNewTitle")}</h3>
      {fresh === 0 && !busy ? (
        <p className="text-sm text-muted-foreground">{t("addNoneSince", { date: formatDate(reading.created_at, lang) })}</p>
      ) : (
        <>
          <p className="text-sm">{busy ? t("addWriting") : t("addNewWhat", { n: fresh })}</p>
          <PressButton label={busy ? t("whatNextReading") : t("addNew")} tip={t("tipAddNew")} primary disabled={busy} quote={price} why={why} onPress={() => void add()} />
        </>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

/**
 * What next, for the whole store, the notes carrying some tags, or one note
 * against the notes before it. Folded, and nothing is paid for until "Read"
 * is pressed, at the price on the button; the last reading is read back free
 * when the block opens. Each heading of a reading can be elaborated, once.
 */
export function WhatNext({ scope, target = "" }: { scope: "overview" | "tags" | "item"; target?: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const reading = useReading(scope, target, open);
  const quote = useApi<Quote>(open ? quoteUrl(scope, target) : null);
  const price = quote.data;
  const why = price?.credits != null ? t("costReading", { n: price.credits, notes: price.notes ?? 0, balance: price.balance ?? 0 }) : undefined;
  const busy = reading.pressed === "read" || reading.reading?.status === "running";

  return (
    <NoteSection id="what-next" title={t("whatNextTitle")} hint={t("whatNextHint")} onOpenChange={setOpen}>
      <ReadingBody reading={reading} />
      <PressButton
        label={busy ? t("whatNextReading") : reading.done ? t("whatNextAgain") : t("whatNextRead")}
        tip={t(reading.done ? "tipWhatNextAgain" : scope === "item" ? "tipWhatNextItem" : scope === "tags" ? "tipWhatNextTags" : "tipWhatNextOverview")}
        primary={!reading.done}
        disabled={reading.writing}
        quote={price}
        why={why}
        onPress={() => reading.press("read", { target }, price?.credits, async () => (await quote.mutate()) ?? undefined)}
      />
      {reading.message && <p className="mt-2 text-xs text-muted-foreground">{reading.message}</p>}
    </NoteSection>
  );
}

/**
 * The Brain for the store: its tags on offer, most used first, and centred
 * on `centreId` when a note is open, or on `ask`, a question brought from
 * Search. The app's Brain panel and the plugins' Brain tab are both this,
 * drawn once all is in. `map` offers "Pick on the map" (the app's panel);
 * `links` is false where the app's own pages are not reachable (a note app's
 * panel).
 */
export function BrainOf({ within, struck, alone, centreId, of, pick, ask, map = false, links = true }: { within?: string[]; struck?: string[]; alone?: boolean; centreId?: string; of?: { id: string; title: string }; pick?: Trail; ask?: AskStart; map?: boolean; links?: boolean }) {
  const counts = useCounts();
  const centre = useApi<{ recordings: { id: string; path: string }[] }>(centreId ? `/api/recordings?ids=${centreId}` : null);
  const tags = useMemo(() => tagsByUse(counts.data?.sets ?? []), [counts.data]);
  if (!allAnswered(counts, centreId ? centre : { data: null })) return null;
  const here = centre.data?.recordings[0];
  return <BrainReading tags={tags} within={within} struck={struck} alone={alone} centre={here ? { id: here.id, title: here.path } : undefined} of={of} pick={pick} ask={ask} map={map} links={links} />;
}

/**
 * Which notes, as pills: the topics added, the tags kept to or left out, the
 * dates. `start` is where they begin; `live` is the narrowing they make, the
 * struck pills left out.
 */
export function useWhich(start: { narrow: Narrow; struck: string[] }) {
  const [topics, setTopics] = useState<string[]>([]);
  const [narrow, setNarrow] = useState<Narrow>(start.narrow);
  // Tags struck through: still shown, narrowing nothing, until they are tapped back or removed.
  const [struck, setStruck] = useState<string[]>(start.struck);
  // A start with dates (a question brought from Search) starts on them, picked.
  const [when, setWhen] = useState<When>(start.narrow.from || start.narrow.to ? "pick" : "any");
  return { topics, setTopics, narrow, setNarrow, struck, setStruck, when, setWhen, live: liveNarrow(narrow, struck) };
}

export type Which = ReturnType<typeof useWhich>;

/**
 * The pills of `which`, each with its ×, then the dates and "Add": topics
 * suggested or typed, and the person's `tags`. `centre` and `of` name the
 * note and the Brain output the notes start from. `alone` offers "Only these
 * notes"; a piece never reads elsewhere, so New piece leaves it out. `ask`
 * keeps to what a question can be asked within: tags it carries and dates,
 * with `extra` pills (Search's own filters). `map` is where "Pick on the map"
 * leads.
 */
export function WhichNotes({ which, tags, centre, of, alone = true, ask = false, extra = [], map }: { which: Which; tags: string[]; centre?: { id: string; title: string }; of?: { id: string; title: string }; alone?: boolean; ask?: boolean; extra?: ReactNode[]; map?: string }) {
  const { lang, t } = useLang();
  const { topics, setTopics, narrow, setNarrow, struck, setStruck, when, setWhen, live } = which;
  const [open, setOpen] = useState<"add" | "when" | null>(null);
  const [query, setQuery] = useState("");
  const { data: suggested } = useApi<{ suggestions: Suggestion[] }>("/api/notes/what-next/suggest");

  const q = query.trim().toLowerCase();
  const chosen = new Set([...narrow.only, ...narrow.not]);
  const offeredTopics = ask ? [] : (suggested?.suggestions ?? []).filter((s) => !topics.includes(s.subject) && s.label.toLowerCase().includes(q));
  const offeredTags = tags.filter((tag) => !chosen.has(tag) && tag.includes(q));

  // Add stays open: several topics and tags are picked in one go.
  function about(subject: string) {
    if (!topics.includes(subject)) setTopics([...topics, subject]);
    setQuery("");
  }

  function addTag(tag: string) {
    setNarrow({ ...narrow, only: [...narrow.only, tag] });
    setQuery("");
  }

  function pickWhen(next: When) {
    setWhen(next);
    if (next !== "pick") {
      setNarrow({ ...narrow, from: next === "any" ? "" : monthsBefore(WHEN_MONTHS[next]), to: "" });
      setOpen(null);
    }
  }

  const whenLabel =
    when === "pick" ? [narrow.from && formatFactDate(narrow.from, lang), narrow.to && formatFactDate(narrow.to, lang)].filter(Boolean).join(" – ") || t("brainPickDates") : t(WHEN_LABEL[when]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!ask && centre && narrow.centre && (
          <Pill onRemove={() => setNarrow({ ...narrow, centre: undefined })} removeLabel={t("brainRemove")} tip={t("tipBrainCentre")} removeTip={t("tipBrainRemove")}>
            {t("brainCentre", { name: centre.title })}
          </Pill>
        )}
        {!ask && of && narrow.of && (
          <Pill onRemove={() => setNarrow({ ...narrow, of: undefined })} removeLabel={t("brainRemove")} tip={t("tipBrainOf")} removeTip={t("tipBrainRemove")}>
            {t("brainOf", { name: of.title })}
          </Pill>
        )}
        {!ask && narrow.pick && (
          <Pill onRemove={() => setNarrow({ ...narrow, pick: undefined })} removeLabel={t("brainRemove")} tip={t("tipBrainTrail")} removeTip={t("tipBrainRemove")}>
            {t("brainTrail", { n: narrow.pick.notes.length + narrow.pick.tags.length })}
          </Pill>
        )}
        {!ask && topics.map((topic) => (
          <Pill key={topic} onRemove={() => setTopics(topics.filter((x) => x !== topic))} removeLabel={t("brainRemove")} tip={t("tipBrainTopic")} removeTip={t("tipBrainRemove")}>
            {t("brainAbout", { name: topic })}
          </Pill>
        ))}
        {(ask ? narrow.only : [...narrow.only, ...narrow.not]).map((tag) => (
          struck.includes(tag) ? (
            <Pill key={tag} onClick={() => setStruck(struck.filter((x) => x !== tag))} onRemove={() => { setStruck(struck.filter((x) => x !== tag)); setNarrow(dropTag(narrow, tag)); }} removeLabel={t("brainRemove")} tip={t("tipBrainStruck")} removeTip={t("tipBrainRemove")}>
              <s>{t(narrow.only.includes(tag) ? "brainWith" : "brainWithout", { tag })}</s>
            </Pill>
          ) : (
            <Pill key={tag} onClick={ask ? undefined : () => setNarrow(flipTag(narrow, tag))} onRemove={() => setStruck([...struck, tag])} removeLabel={t("brainStrike")} tip={t(ask ? "tipBrainAskTag" : "tipBrainFlip")} removeTip={t("tipBrainStrike")}>
              {t(narrow.only.includes(tag) ? "brainWith" : "brainWithout", { tag })}
            </Pill>
          )
        ))}
        {extra}
        {(ask ? live.only.length + extra.length === 0 : topics.length === 0 && live.only.length + live.not.length === 0 && !narrow.of && !narrow.pick) && <span className="text-xs">{t("brainEverything")}</span>}
        {when === "any" ? (
          <Chip on={open === "when"} aria-expanded={open === "when"} tip={t("tipBrainWhenOpen")} onClick={() => setOpen(open === "when" ? null : "when")}>
            {whenLabel}
          </Chip>
        ) : (
          <Pill onClick={() => setOpen(open === "when" ? null : "when")} onRemove={() => pickWhen("any")} removeLabel={t("brainRemove")} tip={t("tipBrainWhen")} removeTip={t("tipWhenAny")}>
            {whenLabel}
          </Pill>
        )}
        <Chip on={open === "add"} aria-expanded={open === "add"} tip={t("tipBrainAdd")} onClick={() => setOpen(open === "add" ? null : "add")}>
          <Plus className="h-3 w-3" aria-hidden />
          {t("brainAdd")}
        </Chip>
        {map && (
          <Link href={map} data-tip={t("tipBrainMap")} className={`${buttonClass("secondary", "sm")} text-xs`}>
            {t("brainMap")}
          </Link>
        )}
        {alone && !ask && (
          <Chip on={!!narrow.alone} aria-pressed={!!narrow.alone} tip={t("tipBrainAlone")} onClick={() => setNarrow({ ...narrow, alone: !narrow.alone })}>
            {t("brainAlone")}
          </Chip>
        )}
      </div>

      {open === "when" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {WHENS.map((w) => (
              <Chip key={w} on={w === when} tip={t(WHEN_TIP[w])} onClick={() => pickWhen(w)}>
                {t(WHEN_LABEL[w])}
              </Chip>
            ))}
          </div>
          {when === "pick" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                {t("narrowFrom")}
                <Input type="date" data-tip={t("tipFromDate")} value={narrow.from} onChange={(e) => setNarrow({ ...narrow, from: e.target.value })} className="w-auto" />
              </label>
              <label className="flex items-center gap-1">
                {t("narrowTo")}
                <Input type="date" data-tip={t("tipToDate")} value={narrow.to} onChange={(e) => setNarrow({ ...narrow, to: e.target.value })} className="w-auto" />
              </label>
            </div>
          )}
        </div>
      )}

      {open === "add" && (
        <div className="space-y-2">
          <Input
            autoFocus
            data-tip={t("tipBrainAddField")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // A question is asked within tags, never about a topic: Enter takes the first tag on offer.
              if (e.key === "Enter" && query.trim()) {
                if (!ask) about(query.replace(/\s+/g, " ").trim());
                else if (offeredTags[0]) addTag(offeredTags[0]);
              }
              if (e.key === "Escape") setOpen(null);
            }}
            placeholder={t("brainAddField")}
            maxLength={200}
          />
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {!ask && query.trim() && <Chip tip={t("tipBrainTyped")} onClick={() => about(query.replace(/\s+/g, " ").trim())}>{t("brainAboutTyped", { q: query.trim() })}</Chip>}
            {offeredTopics.map((s) => (
              <Chip key={s.label} tip={t("tipBrainSuggested")} onClick={() => about(s.subject)}>
                {s.label}
              </Chip>
            ))}
            {offeredTags.map((tag) => (
              <Chip key={tag} tip={t("tipBrainTagOffer")} onClick={() => addTag(tag)}>
                #{tag}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The Brain, read top to bottom as one sentence: what the person wants, from
 * which notes, at what price. The first choice is a question answered from
 * the notes (Ask), the rest are readings. The notes start as all of them (or the tags of
 * the view it was opened on, or centred on the note open then) and each thing
 * added shows as a pill with its ×. Every choice is a reading, so the press
 * always carries its price and how many notes it reads. Nothing from before
 * is shown until asked for; earlier readings sit folded at the bottom. Under
 * a reading, in the app, "Write a piece from these notes" opens New piece on
 * the notes it read.
 */
export function BrainReading({
  tags,
  within = [],
  struck: struckAtStart,
  alone,
  centre,
  of,
  pick,
  ask,
  map = false,
  links = true,
}: {
  tags: string[];
  within?: string[];
  /** Tags that start struck through (still shown, read as nothing). */
  struck?: string[];
  /** Starts on "Only these notes". */
  alone?: boolean;
  centre?: { id: string; title: string };
  /** Starts on the notes this Brain output read. */
  of?: { id: string; title: string };
  /** Starts on the Web's trail: those notes and the notes carrying those tags. */
  pick?: Trail;
  /** Starts on Ask, this question and the filters it was typed under. */
  ask?: AskStart;
  /** Offers "Pick on the map": the Web on the tags chosen. */
  map?: boolean;
  /** False where the app's own pages are not reachable. */
  links?: boolean;
}) {
  const { lang, t } = useLang();
  const [job, setJob] = useState<Job>(ask ? "ask" : "picture");
  const [start] = useState(() => {
    const begun = startOf(ask ? ask.tags : within, { struck: struckAtStart, alone, centre: centre?.id, of: of?.id, pick });
    return ask?.from ? { ...begun, narrow: { ...begun.narrow, from: ask.from.slice(0, 10) } } : begun;
  });
  const which = useWhich(start);
  const { topics, live } = which;
  const [asked, setAsked] = useState<{ scope: Scope; target: string } | null>(null);
  const [question, setQuestion] = useState(ask?.q ?? "");
  // Search's own filters, kept until their × takes them away.
  const [language, setLanguage] = useState(ask?.language ?? null);
  const [actions, setActions] = useState(ask?.actions ?? false);
  const asking = useAsk(job === "ask");
  const q = question.replace(/\s+/g, " ").trim();

  const reading = useReading(asked?.scope ?? "overview", asked?.target ?? "", asked !== null);
  const { data: library } = useApi<{ readings: LibraryRow[] }>("/api/notes/what-next?library=1");
  const latest = (library?.readings ?? []).slice(0, LATEST);
  const choice = { kind: job === "ask" ? "picture" : job, topics, narrow: live };
  const wanted = readingOf(choice, centre?.title);
  // Priced on stand-in words: the wording never changes the price, so typing asks nothing.
  const priced = readingOf({ ...choice, topics: topics.length ? ["topic"] : [] }, "topic");
  const quote = useApi<Quote>(job === "ask" ? null : quoteUrl(priced.scope, priced.target), { keepPreviousData: true });
  // The price of what is chosen now: nothing, its slot held, while a changed choice is being priced.
  const price = answeredNow(quote);
  const why = price?.credits != null ? t("costReading", { n: price.credits, notes: price.notes ?? 0, balance: price.balance ?? 0 }) : undefined;
  const busy = reading.pressed === "read" || reading.reading?.status === "running";
  const none = price?.credits === null;

  /** What a reading was of, in a line: what was wanted, and of which notes. */
  function labelOf(scope: Scope, target: string, title = target === centre?.id ? centre.title : ""): string {
    if (scope === "subject") {
      const of = subjectOf(target);
      return of ? `${t(JOB_LABEL[of.kind])}: ${of.subject === EVERYTHING ? t("brainEverything") : of.subject}` : "";
    }
    const which = scope === "overview" ? t("brainEverything") : scope === "tags" ? target.split(",").map((tag) => `#${tag}`).join(" ") : scope === "item" ? title : "";
    return which ? `${t("jobPicture")}: ${which}` : t("jobPicture");
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("brainWant")}</h3>
        <Options label={t("brainWant")} value={job} onChange={setJob} options={(["ask", "picture", ...JOBS] as Job[]).map((kind) => ({ value: kind, label: t(JOB_LABEL[kind]), hint: t(JOB_WHAT[kind]) }))} />
      </section>

      {job === "ask" && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("brainQuestion")}</h3>
          <Input data-tip={t("tipBrainQuestion")} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("brainQuestionField")} maxLength={2000} />
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("brainWhich")}</h3>
        <WhichNotes
          which={which}
          tags={tags}
          centre={centre}
          of={of}
          ask={job === "ask"}
          map={map ? (live.only.length ? webSetHref({ live: live.only, struck: [] }) : "/web") : undefined}
          extra={
            job === "ask"
              ? [
                  language && (
                    <Pill key="language" onRemove={() => setLanguage(null)} removeLabel={t("brainRemove")} tip={t("tipBrainFromSearch")} removeTip={t("tipBrainRemove")}>
                      {t(language === "cs" ? "filterCzech" : "filterEnglish")}
                    </Pill>
                  ),
                  actions && (
                    <Pill key="actions" onRemove={() => setActions(false)} removeLabel={t("brainRemove")} tip={t("tipBrainFromSearch")} removeTip={t("tipBrainRemove")}>
                      {t("filterActions")}
                    </Pill>
                  ),
                ].filter(Boolean)
              : []
          }
        />
      </section>

      {job === "ask" ? (
        <AskPress
          asking={asking}
          question={q}
          onPress={() => void asking.press({ q, tags: live.only, from: live.from || null, to: live.to || null, language, actions })}
        />
      ) : (
      <section className="space-y-1">
        <Button
          variant="primary"
          disabled={reading.writing || !price || none}
          tip={tipOf(t("tipBrainRead"), why)}
          onClick={() => {
            setAsked(wanted);
            void reading.press("read", wanted, price?.credits, async () => (await quote.mutate()) ?? undefined);
          }}
        >
          {busy ? t("whatNextReading") : price?.notes ? t("brainRead", { n: price.notes }) : t("whatNextRead")}
          <Cost credits={price?.credits} why={why} />
        </Button>
        <p className="min-h-4 text-xs text-muted-foreground">
          {none ? t("narrowNone") : price?.credits && price.balance != null ? t("brainBalance", { n: price.balance }) : ""}
        </p>
        {reading.message && <p className="text-xs text-muted-foreground">{reading.message}</p>}
      </section>
      )}

      {job !== "ask" && asked && <ReadingBody reading={reading} label={labelOf(asked.scope, asked.target)} />}
      {job !== "ask" && asked && links && reading.done && (
        <Link href={writeFrom(reading.done.id)} data-tip={t("tipPieceFromNotes")} className="mb-4 block text-xs text-primary hover:underline">
          {t("pieceFromNotes")} →
        </Link>
      )}

      {latest.length > 0 && (
        <NoteSection id="brain-earlier" title={t("brainLibrary")}>
          <ul className="space-y-1">
            {latest.map((r) => (
              <li key={r.id}>
                <Button variant="link" size="sm" className="text-left" tip={t("tipBrainEarlier")} onClick={() => {
                    if (job === "ask") setJob(kindOf(r.scope, r.target));
                    setAsked({ scope: r.scope, target: r.target });
                  }}>
                  {r.title || labelOf(r.scope, r.target)} · {t(JOB_LABEL[kindOf(r.scope, r.target)])} · {formatDate(r.created_at, lang)}
                </Button>
              </li>
            ))}
          </ul>
        </NoteSection>
      )}
    </div>
  );
}

/**
 * Ask's press, at its price, and the answer under it once written: from the
 * notes only, quoting them. An answer stays while its question is unchanged.
 */
function AskPress({ asking, question, onPress }: { asking: ReturnType<typeof useAsk>; question: string; onPress: () => void }) {
  const { t } = useLang();
  const { price, done } = asking;
  const why = price ? t("costAsk", { n: price.credits, balance: price.balance }) : undefined;
  const ready = question.length >= 3;
  return (
    <>
      <section className="space-y-1">
        <Button variant="primary" disabled={asking.asking || !ready || !price} tip={tipOf(t("tipBrainAsk"), why)} onClick={onPress}>
          {asking.asking ? t("asking") : t("askNotes")}
          <Cost credits={price?.credits} why={why} />
        </Button>
        <p className="min-h-4 text-xs text-muted-foreground">{ready && price?.credits ? why : ""}</p>
        {asking.message && <p className="text-xs text-muted-foreground">{asking.message}</p>}
      </section>
      {done && !done.declined && asking.asked === question && (
        <div data-answer>
          <Notice tone="primary" className="mb-4">
            <Heading className="text-primary">{t("answerFrom")}</Heading>
            <p className="whitespace-pre-wrap">{done.answer ?? t("searchNoResults")}</p>
            <SpentLine spent={done.spent} />
          </Notice>
        </div>
      )}
    </>
  );
}

/** What a reading read, in a few words: its subject or all notes, then the tags it kept to. */
export function readOf(t: ReturnType<typeof useLang>["t"], scope: Scope, target: string): string {
  if (scope === "item") return t("libraryOneNote");
  const { subject, narrow } = askedOf(scope, target);
  const tags = (narrow.only ?? []).map((tag) => `#${tag}`).join(" ");
  return [subject || (tags ? "" : t("brainEverything")), tags].filter(Boolean).join(" · ");
}

/** New piece, starting on the notes a Brain output read. */
export const writeFrom = (readingId: string) => `/write/new?of=${encodeURIComponent(readingId)}`;
