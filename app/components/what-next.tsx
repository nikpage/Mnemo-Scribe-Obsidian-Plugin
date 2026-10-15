"use client";

// [Guru]
import { useMemo, useState } from "react";
import { ApiError, allAnswered, answeredNow, send, useApi } from "@/lib/api";
import { useCounts } from "@/hooks/use-notes-page";
import { tagsByUse } from "@/lib/note/notes-page";
import { busyUntilDone } from "@/lib/busy";
import { useLang } from "@/hooks/use-lang";
import { formatDate, formatFactDate, formatUsd } from "@/lib/format";
import { inlineMarks, readingSections } from "@/lib/note/reading-sections";
import { EVERYTHING, type Kind, type Narrow, type Scope, dropTag, flipTag, liveNarrow, monthsBefore, readingOf, subjectOf } from "@/lib/note/what-next-target";
import { Plus } from "lucide-react";
import { tipOf } from "@/lib/tooltip";
import { Button, Chip, Cost, Input, Options, Pill } from "@/components/ui";
import { NoteSection } from "@/components/note-section";

type Status = "running" | "done" | "failed";
/** `spent` comes back for the owner's account alone: what the call really cost. */
type Spent = { costUsd: number; readTokens: number; wroteTokens: number };
type Row = { id: string; target: string; part: string | null; status: Status; reading: string | null; created_at: string; spent?: Spent };
type Answer = { reading: Row | null; failed: "failed" | "declined" | null; more: Row[] };
type Quote = { credits: number | null; balance: number | null; notes?: number };
type Suggestion = { label: string; subject: string; jobs: Kind[] };

/** The jobs in the order they are offered, each named by what the person is about to do. */
const JOBS: Kind[] = ["inspiration", "next-best", "study", "log"];
export const JOB_LABEL = { picture: "jobPicture", inspiration: "jobInspiration", "next-best": "jobNextBest", study: "jobStudy", log: "jobLog" } as const;
/** What each job hands back, in a line under its name: said from what its prompt asks for. */
const JOB_WHAT = { picture: "jobPictureWhat", inspiration: "jobInspirationWhat", "next-best": "jobNextBestWhat", study: "jobStudyWhat", log: "jobLogWhat" } as const;

/** How far back the notes go: a few spans, or dates picked. */
const WHENS = ["any", "month", "3m", "year", "pick"] as const;
type When = (typeof WHENS)[number];
const WHEN_LABEL = { any: "brainAnyTime", month: "brainLastMonth", "3m": "brainLast3", year: "brainLastYear", pick: "brainPickDates" } as const;
const WHEN_TIP = { any: "tipWhenAny", month: "tipWhenMonth", "3m": "tipWhen3m", year: "tipWhenYear", pick: "tipWhenPick" } as const;
const WHEN_MONTHS = { any: 0, month: 1, "3m": 3, year: 12, pick: 0 } as const;

const quoteUrl = (scope: Scope, target: string, parentId?: string) =>
  `/api/notes/what-next/quote?scope=${scope}&target=${encodeURIComponent(target)}${parentId ? `&parentId=${parentId}` : ""}`;

/** What a reading really cost, under it; only the owner's account is ever sent one. */
export function SpentLine({ spent }: { spent?: Spent }) {
  const { t } = useLang();
  if (!spent) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t("spentLine", { usd: formatUsd(spent.costUsd, 4), read: spent.readTokens, wrote: spent.wroteTokens })}
    </p>
  );
}

/** One block of written text: a paragraph per blank line, bold, italics and code drawn. */
function Prose({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm">
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {inlineMarks(p.trim()).map((run, j) =>
            run.mark === "strong" ? (
              <strong key={j}>{run.text}</strong>
            ) : run.mark === "em" ? (
              <em key={j}>{run.text}</em>
            ) : run.mark === "code" ? (
              <code key={j} className="rounded bg-muted px-1 text-xs">
                {run.text}
              </code>
            ) : (
              run.text
            )
          )}
        </p>
      ))}
    </div>
  );
}

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
        setNote(t(status === 402 ? "outOfCredits" : status === 429 ? "whatNextUsedUp" : status === 409 ? "whatNextBusy" : "whatNextFailed"));
      }
    } finally {
      releasePage();
      setPressed(null);
    }
  }

  return { data, reading, done, writing, pressed, press, elaborateQuote, message: note ?? failed };
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
      {readingSections(text).map((section, i) => (
        <section key={i}>
          {section.heading && <h3 className="mb-1 text-sm font-semibold">{section.heading}</h3>}
          {section.body && <Prose text={section.body} />}
        </section>
      ))}
    </div>
  );
}

/** The press, its price inside it, and in words under it so a phone sees why. */
function PressButton({ label, tip, primary, disabled, onPress, quote, why }: { label: string; tip: string; primary: boolean; disabled: boolean; onPress: () => void; quote?: Quote; why?: string }) {
  return (
    <div>
      <Button size="sm" variant={primary ? "primary" : "secondary"} onClick={onPress} disabled={disabled || quote?.credits === null} tip={tipOf(tip, why)}>
        {label}
        <Cost credits={quote?.credits} why={why} />
      </Button>
      <p className="mt-1 min-h-4 text-xs text-muted-foreground">{quote?.credits ? why : ""}</p>
    </div>
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
 * on `centreId` when a note is open. The app's Brain panel and the plugins'
 * Brain tab are both this. Drawn once both are in.
 */
export function BrainOf({ within, centreId }: { within?: string[]; centreId?: string }) {
  const counts = useCounts();
  const centre = useApi<{ recordings: { id: string; path: string }[] }>(centreId ? `/api/recordings?ids=${centreId}` : null);
  const tags = useMemo(() => tagsByUse(counts.data?.sets ?? []), [counts.data]);
  if (!allAnswered(counts, centreId ? centre : { data: null })) return null;
  const here = centre.data?.recordings[0];
  return <BrainReading tags={tags} within={within} centre={here ? { id: here.id, title: here.path } : undefined} />;
}

/**
 * The Brain, read top to bottom as one sentence: what the person wants, from
 * which notes, at what price. The notes start as all of them (or the tags of
 * the view it was opened on, or centred on the note open then) and each thing
 * added shows as a pill with its ×. Every choice is a reading, so the press
 * always carries its price and how many notes it reads. Nothing from before
 * is shown until asked for; earlier readings sit folded at the bottom.
 */
export function BrainReading({
  tags,
  within = [],
  centre,
}: {
  tags: string[];
  within?: string[];
  centre?: { id: string; title: string };
}) {
  const { lang, t } = useLang();
  const [job, setJob] = useState<Kind>("picture");
  const [topics, setTopics] = useState<string[]>([]);
  const [narrow, setNarrow] = useState<Narrow>({ only: within, not: [], from: "", to: "", ...(centre ? { centre: centre.id } : {}) });
  // Tags struck through: still shown, narrowing nothing, until they are tapped back or removed.
  const [struck, setStruck] = useState<string[]>([]);
  const [when, setWhen] = useState<When>("any");
  const [open, setOpen] = useState<"add" | "when" | null>(null);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<{ scope: Scope; target: string } | null>(null);

  const reading = useReading(asked?.scope ?? "overview", asked?.target ?? "", asked !== null);
  const { data: suggested } = useApi<{ suggestions: Suggestion[] }>("/api/notes/what-next/suggest");
  // A reading of one note comes with that note's title.
  const { data: earlier } = useApi<{ readings: { id: string; scope: Scope; target: string; created_at: string; title?: string }[] }>("/api/notes/what-next?history=1");
  const live = liveNarrow(narrow, struck);
  const choice = { kind: job, topics, narrow: live };
  const wanted = readingOf(choice, centre?.title);
  // Priced on stand-in words: the wording never changes the price, so typing asks nothing.
  const priced = readingOf({ ...choice, topics: topics.length ? ["topic"] : [] }, "topic");
  const quote = useApi<Quote>(quoteUrl(priced.scope, priced.target), { keepPreviousData: true });
  // The price of what is chosen now: nothing, its slot held, while a changed choice is being priced.
  const price = answeredNow(quote);
  const why = price?.credits != null ? t("costReading", { n: price.credits, notes: price.notes ?? 0, balance: price.balance ?? 0 }) : undefined;
  const busy = reading.pressed === "read" || reading.reading?.status === "running";
  const none = price?.credits === null;

  const q = query.trim().toLowerCase();
  const chosen = new Set([...narrow.only, ...narrow.not]);
  const offeredTopics = (suggested?.suggestions ?? []).filter((s) => !topics.includes(s.subject) && s.label.toLowerCase().includes(q));
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

  /** What a reading was of, in a line: what was wanted, and of which notes. */
  function labelOf(scope: Scope, target: string, title = target === centre?.id ? centre.title : ""): string {
    if (scope === "subject") {
      const of = subjectOf(target);
      return of ? `${t(JOB_LABEL[of.kind])}: ${of.subject === EVERYTHING ? t("brainEverything") : of.subject}` : "";
    }
    const which = scope === "overview" ? t("brainEverything") : scope === "tags" ? target.split(",").map((tag) => `#${tag}`).join(" ") : scope === "item" ? title : "";
    return which ? `${t("jobPicture")}: ${which}` : t("jobPicture");
  }

  const whenLabel =
    when === "pick" ? [narrow.from && formatFactDate(narrow.from, lang), narrow.to && formatFactDate(narrow.to, lang)].filter(Boolean).join(" – ") || t("brainPickDates") : t(WHEN_LABEL[when]);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("brainWant")}</h3>
        <Options
          label={t("brainWant")}
          value={job}
          onChange={setJob}
          options={(["picture", ...JOBS] as Kind[]).map((kind) => ({ value: kind, label: t(JOB_LABEL[kind]), hint: t(JOB_WHAT[kind]) }))}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("brainWhich")}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {centre && narrow.centre && (
            <Pill onRemove={() => setNarrow({ ...narrow, centre: undefined })} removeLabel={t("brainRemove")} tip={t("tipBrainCentre")} removeTip={t("tipBrainRemove")}>
              {t("brainCentre", { name: centre.title })}
            </Pill>
          )}
          {topics.map((topic) => (
            <Pill key={topic} onRemove={() => setTopics(topics.filter((x) => x !== topic))} removeLabel={t("brainRemove")} tip={t("tipBrainTopic")} removeTip={t("tipBrainRemove")}>
              {t("brainAbout", { name: topic })}
            </Pill>
          ))}
          {[...narrow.only, ...narrow.not].map((tag) => (
            struck.includes(tag) ? (
              <Pill key={tag} onClick={() => setStruck(struck.filter((x) => x !== tag))} onRemove={() => { setStruck(struck.filter((x) => x !== tag)); setNarrow(dropTag(narrow, tag)); }} removeLabel={t("brainRemove")} tip={t("tipBrainStruck")} removeTip={t("tipBrainRemove")}>
                <s>{t(narrow.only.includes(tag) ? "brainWith" : "brainWithout", { tag })}</s>
              </Pill>
            ) : (
              <Pill key={tag} onClick={() => setNarrow(flipTag(narrow, tag))} onRemove={() => setStruck([...struck, tag])} removeLabel={t("brainStrike")} tip={t("tipBrainFlip")} removeTip={t("tipBrainStrike")}>
                {t(narrow.only.includes(tag) ? "brainWith" : "brainWithout", { tag })}
              </Pill>
            )
          ))}
          {topics.length === 0 && live.only.length + live.not.length === 0 && <span className="text-xs">{t("brainEverything")}</span>}
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
          <Chip on={!!narrow.alone} aria-pressed={!!narrow.alone} tip={t("tipBrainAlone")} onClick={() => setNarrow({ ...narrow, alone: !narrow.alone })}>
            {t("brainAlone")}
          </Chip>
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
                if (e.key === "Enter" && query.trim()) about(query.replace(/\s+/g, " ").trim());
                if (e.key === "Escape") setOpen(null);
              }}
              placeholder={t("brainAddField")}
              maxLength={200}
            />
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {query.trim() && <Chip tip={t("tipBrainTyped")} onClick={() => about(query.replace(/\s+/g, " ").trim())}>{t("brainAboutTyped", { q: query.trim() })}</Chip>}
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
      </section>

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

      {asked && <ReadingBody reading={reading} label={labelOf(asked.scope, asked.target)} />}

      {(earlier?.readings.length ?? 0) > 0 && (
        <NoteSection id="brain-earlier" title={t("brainEarlier")}>
          <ul className="space-y-1">
            {earlier!.readings.map((r) => (
              <li key={r.id}>
                <Button variant="link" size="sm" className="text-left" tip={t("tipBrainEarlier")} onClick={() => setAsked({ scope: r.scope, target: r.target })}>
                  {labelOf(r.scope, r.target, r.title)} · {formatDate(r.created_at, lang)}
                </Button>
              </li>
            ))}
          </ul>
        </NoteSection>
      )}
    </div>
  );
}
