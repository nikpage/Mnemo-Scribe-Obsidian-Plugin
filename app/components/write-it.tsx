"use client";

// [Writer]
import { useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/hooks/use-lang";
import { ApiError, allAnswered, answeredNow, send, useApi } from "@/lib/api";
import { busyUntilDone } from "@/lib/busy";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import type { Extract } from "@/lib/note/brain-library";
import type { Narrow } from "@/lib/note/what-next-target";
import { BUILT_IN_FORMS, type BuiltInForm, type FormRow, TEXT_MAX, backgroundWords } from "@/lib/writing/forms";
import { MARKS, type Measures, measure } from "@/lib/writing/measure";
import { DEFAULT_MODELS, OPENING_MAX, type Outline, type Step, WRITING_MODELS, type WritingModel } from "@/lib/writing/piece-shape";
import type { VoiceRow } from "@/lib/writing/voices";
import { PressButton, type Quote, ReadingProse, SpentLine } from "@/components/reading-prose";
import { NoteLink } from "@/components/note-link";
import { NoteSection } from "@/components/note-section";
import { Button, Heading, Input, Notice, Options, inputClass, selectClass } from "@/components/ui";

/**
 * Writing a piece, as the `/write` pages draw it: a new piece's type, voice,
 * words and models, and one piece read back with its outline to change and
 * approve, then the piece. Nothing here reaches past the token routes, so
 * the plugins can draw it too.
 */

export const PIECES = "/api/writing/pieces";
export const QUOTE = "/api/writing/pieces/quote";
export const VOICES = "/api/writing/voices";
export const FORMS = "/api/writing/forms";
export const SPOKEN = "/api/writing/spoken";

/** A recording New piece can shape a piece from. */
export type SpokenRow = { id: string; label: string | null; path: string | null; recorded_at: string; duration_seconds: number | null };

export type Translate = ReturnType<typeof useLang>["t"];

/** What a refused press says, by how the server refused it. */
export function refused(t: Translate, err: unknown): string {
  const status = err instanceof ApiError ? err.status : 0;
  return t(status === 402 ? "outOfCredits" : status === 409 ? "pieceBusy" : status === 400 ? "pieceNoNotes" : "pieceFailed");
}

/** How long a built-in form runs: as the person changed it, else as it came. */
export function wordsOf(form: BuiltInForm, rows: FormRow[]): number {
  return rows.find((r) => r.base_key === form.id)?.words ?? form.words;
}

/** A form's name in the person's language: a built-in one's words, else its own name. */
export function formName(t: Translate, key: string | null, name: string): string {
  const form = key ? BUILT_IN_FORMS.find((f) => f.id === key) : undefined;
  return form ? t(form.name) : name;
}

const MODEL_NAME: Record<WritingModel, "modelGeminiFlash" | "modelGeminiFlashLite"> = { "gemini-3.8-flash": "modelGeminiFlash", "gemini-3.1-flash-lite": "modelGeminiFlashLite" };
const STEP_LABEL = { outline: "pieceModelOutline", write: "pieceModelWrite", edit: "pieceModelEdit" } as const;
const STEP_TIP = { outline: "tipPieceModelOutline", write: "tipPieceModelWrite", edit: "tipPieceModelEdit" } as const;

/** Which model a step runs on: the ones there are, then the ones still to come, shown and not choosable. */
export function ModelPicker({ step, value, onChange }: { step: Step; value: WritingModel; onChange: (m: WritingModel) => void }) {
  const { t } = useLang();
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{t(STEP_LABEL[step])}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as WritingModel)} data-tip={t(STEP_TIP[step])} className={`${selectClass} block`}>
        {WRITING_MODELS.map((m) => (
          <option key={m} value={m}>
            {t(MODEL_NAME[m])}
          </option>
        ))}
        <option value="" disabled>
          {t("modelOthersSoon")}
        </option>
      </select>
    </label>
  );
}

const MARK_LABEL = { comma: "measureComma", semicolon: "measureSemicolon", colon: "measureColon", dash: "measureDash", question: "measureQuestion", exclamation: "measureExclamation" } as const;

/** Measures side by side, a column each: a voice alone, or a piece beside its voice. */
export function MeasuresTable({ columns }: { columns: { label: string; m: Measures }[] }) {
  const { lang, t } = useLang();
  const n = (x: number) => formatCount(x, lang);
  const rows: [string, (m: Measures) => string][] = [
    [t("measureSentence"), (m) => n(m.sentence.mean)],
    [t("measureSpread"), (m) => n(m.sentence.spread)],
    [t("measureParagraph"), (m) => n(m.paragraph)],
    [t("measureDialogue"), (m) => t("measurePercent", { n: n(Math.round(m.dialogue * 100)) })],
    [t("measureContractions"), (m) => n(m.contractions)],
    ...MARKS.map((k): [string, (m: Measures) => string] => [t(MARK_LABEL[k]), (m) => n(m.punctuation[k])]),
  ];
  return (
    <table className="w-full text-sm">
      {columns.length > 1 && (
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th />
            {columns.map((c) => (
              <th key={c.label} className="px-2 text-right font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-t border-border">
            <td className="py-1 pr-2 text-muted-foreground">{label}</td>
            {columns.map((c) => (
              <td key={c.label} className="px-2 py-1 text-right tabular-nums">
                {value(c.m)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * What a new piece is to be: its type, its voice ("none" no voice), whether
 * it is written from the person's notes or shaped from one of their
 * recordings, what it is about, what it must stay true to, the person's
 * opening words if they have them, and the model of each step. Until a voice
 * is picked it is the type's own, else the voice with the most examples, else
 * none; until a recording is picked, the latest.
 */
export function usePieceChoice() {
  const voices = useApi<{ voices: VoiceRow[] }>(VOICES);
  const forms = useApi<{ forms: FormRow[] }>(FORMS);
  const recordings = useApi<{ notes: SpokenRow[] }>(SPOKEN);
  const [source, setSource] = useState<"notes" | "spoken">("notes");
  const [pickedSpoken, setSpoken] = useState("");
  const [form, setForm] = useState(`key:${BUILT_IN_FORMS[0].id}`);
  const [picked, setVoice] = useState("");
  const [brief, setBrief] = useState("");
  const [background, setBackground] = useState("");
  const [opening, setOpening] = useState("");
  const [models, setModels] = useState<Record<Step, WritingModel>>(DEFAULT_MODELS);
  const rows = forms.data?.forms ?? [];
  const own = rows.filter((f) => !f.base_key);
  const at = form.indexOf(":");
  const [kind, value] = [form.slice(0, at), form.slice(at + 1)];
  const ownForm = kind === "id" ? own.find((f) => f.id === value) : undefined;
  const fiction = kind === "key" && Boolean(BUILT_IN_FORMS.find((f) => f.id === value)?.fiction);
  const list = voices.data?.voices ?? [];
  const most = list.reduce<VoiceRow | undefined>((best, v) => (v.examples > (best?.examples ?? 0) ? v : best), undefined);
  const voice = picked || ownForm?.voice_id || most?.id || "none";
  // One of the person's own types with no length set can't be priced or written.
  const unsized = kind === "id" && !ownForm?.words;
  const setModel = (step: Step) => (m: WritingModel) => setModels((all) => ({ ...all, [step]: m }));
  // Shaped from a recording: the one picked, else the latest; none when there are none.
  const spoken = source === "spoken" ? pickedSpoken || recordings.data?.notes[0]?.id || "" : null;
  return { voices, forms, recordings, rows, own, form, setForm, voice, setVoice, source, setSource, spoken, setSpoken, brief, setBrief, background, setBackground, fiction, opening, setOpening, models, setModel, kind, value, unsized };
}

export type PieceChoice = ReturnType<typeof usePieceChoice>;

/** Where a new piece's first press is priced (its outline, or its shaping): everything but its words, which never change the price. */
export function newQuoteUrl(c: PieceChoice, narrow?: Partial<Narrow>): string | null {
  if (c.unsized || c.spoken === "") return null;
  const params = new URLSearchParams({
    ...(c.kind === "id" ? { formId: c.value } : { form: c.value }),
    voice: c.voice,
    ...(c.spoken ? { spoken: c.spoken } : narrow ? { narrow: JSON.stringify(narrow) } : {}),
    ...(c.background.trim() ? { background: String(backgroundWords(c.background)) } : {}),
    models: JSON.stringify(c.spoken ? { write: c.models.write } : { outline: c.models.outline }),
  });
  return `${QUOTE}?${params}`;
}

/**
 * The press that writes a new piece's outline at `credits`, the price shown:
 * the new piece's id, or null with what went wrong in `note`. A changed price
 * is shown instead and nothing runs. Every step's model is kept on the piece.
 */
export function useStartPiece(c: PieceChoice, requote: () => Promise<Quote | undefined>) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function start(brief: string, narrow: Partial<Narrow> | undefined, credits: number | null | undefined): Promise<string | null> {
    setBusy(true);
    setNote(null);
    const releasePage = busyUntilDone();
    try {
      const { pieceId } = await send<{ pieceId: string }>(PIECES, "POST", {
        form: c.kind === "id" ? { id: c.value } : { key: c.value },
        voiceId: c.voice === "none" ? null : c.voice,
        brief,
        ...(c.background.trim() ? { background: c.background } : {}),
        ...(c.spoken ? { spoken: c.spoken } : { ...(c.opening.trim() ? { opening: c.opening } : {}), ...(narrow ? { narrow } : {}) }),
        models: c.models,
        ...(credits == null ? {} : { credits }),
      });
      return pieceId;
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        const fresh = await requote();
        setNote(t("priceChanged", { n: fresh?.credits ?? "?" }));
      } else setNote(refused(t, err));
      return null;
    } finally {
      releasePage();
      setBusy(false);
    }
  }

  return { busy, note, start };
}

/**
 * A new piece's type, each with a line on what you get, the person's own
 * first; its voice; what it is written from (the person's notes, or one of
 * their recordings shaped); and what it is about. `links` false where
 * Settings and the recorder are not at hand: no "Change types…", "Change
 * voices…" or "Record one now…".
 */
export function PieceFields({ choice: c, links = true }: { choice: PieceChoice; links?: boolean }) {
  const { lang, t } = useLang();
  const n = (words: number) => formatCount(words, lang);
  const types = [
    ...c.own.map((f) => ({ value: `id:${f.id}`, label: f.name, hint: f.words ? t("pieceTypeOwn", { n: n(f.words) }) : t("pieceTypeOwnUnsized") })),
    ...BUILT_IN_FORMS.map((f) => ({ value: `key:${f.id}`, label: t(f.name), hint: t(f.line, { n: n(wordsOf(f, c.rows)) }) })),
  ];
  const change = (href: string, label: "pieceChangeTypes" | "pieceChangeVoices", tip: "tipPieceChangeTypes" | "tipPieceChangeVoices") =>
    links && (
      <Link href={href} data-tip={t(tip)} className="inline-block text-sm text-primary hover:underline">
        {t(label)}
      </Link>
    );
  const voices = [
    ...(c.voices.data?.voices ?? []).map((v) => ({ value: v.id, label: v.name, hint: t("writingExamples", { n: v.examples }) })),
    { value: "none", label: t("writingNoVoice"), hint: t("pieceNoVoiceWhat") },
  ];
  const sources = [
    { value: "notes" as const, label: t("pieceSourceNotes"), hint: t("pieceSourceNotesWhat") },
    { value: "spoken" as const, label: t("pieceSourceSpoken"), hint: t("pieceSourceSpokenWhat") },
  ];
  const recordings = (c.recordings.data?.notes ?? []).map((r) => ({
    value: r.id,
    label: r.label || r.path?.split("/").pop() || formatDate(r.recorded_at, lang),
    hint: [formatDate(r.recorded_at, lang), r.duration_seconds ? formatDuration(r.duration_seconds) : ""].filter(Boolean).join(" · "),
  }));
  return (
    <>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("pieceType")}</h3>
        <Options label={t("pieceType")} value={c.form} onChange={c.setForm} options={types} />
        {c.unsized && <p className="text-xs text-destructive">{t("pieceTypeUnsized")}</p>}
        {change("/settings/types", "pieceChangeTypes", "tipPieceChangeTypes")}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("pieceVoice")}</h3>
        <Options label={t("pieceVoice")} value={c.voice} onChange={c.setVoice} options={voices} />
        {change("/settings/voices", "pieceChangeVoices", "tipPieceChangeVoices")}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("pieceSource")}</h3>
        <Options label={t("pieceSource")} value={c.source} onChange={c.setSource} options={sources} />
      </section>

      {c.spoken !== null && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("pieceRecording")}</h3>
          {recordings.length ? <Options label={t("pieceRecording")} value={c.spoken} onChange={c.setSpoken} options={recordings} /> : <p className="text-xs text-muted-foreground">{t("pieceRecordingNone")}</p>}
          {links && (
            <Link href="/record" data-tip={t("tipPieceRecordNow")} className="inline-block text-sm text-primary hover:underline">
              {t("pieceRecordNow")}
            </Link>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("pieceBrief")}</h3>
        <p className="text-xs text-muted-foreground">{t(c.spoken !== null ? "pieceBriefSpokenWhat" : "pieceBriefWhat")}</p>
        <textarea value={c.brief} onChange={(e) => c.setBrief(e.target.value)} maxLength={4000} rows={4} aria-label={t("pieceBrief")} data-tip={t("tipPieceBrief")} className={inputClass()} />
      </section>
    </>
  );
}

/**
 * What the piece must stay true to, kept with this piece only: folded unless
 * the type is a story or something is typed in it.
 */
export function PieceBackground({ choice: c }: { choice: PieceChoice }) {
  const { t } = useLang();
  return (
    <NoteSection key={c.fiction ? "story" : "other"} id="piece-background" title={t("pieceBackground")} hint={t("pieceBackgroundWhat")} defaultOpen={c.fiction || Boolean(c.background.trim())}>
      <textarea
        value={c.background}
        onChange={(e) => c.setBackground(e.target.value)}
        maxLength={TEXT_MAX.background}
        rows={5}
        aria-label={t("pieceBackground")}
        data-tip={t("tipPieceBackground")}
        className={inputClass()}
      />
    </NoteSection>
  );
}

/** Folded under More: the person's opening words and the model of each step; shaping a recording has one step and no opening. */
export function PieceMore({ choice: c }: { choice: PieceChoice }) {
  const { t } = useLang();
  const shaped = c.spoken !== null;
  return (
    <NoteSection id="piece-more" title={t("pieceMore")} hint={t("pieceMoreWhat")}>
      <div className="space-y-4">
        {!shaped && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("pieceOpening")}</span>
            <span className="block text-xs text-muted-foreground">{t("pieceOpeningWhat")}</span>
            <textarea value={c.opening} onChange={(e) => c.setOpening(e.target.value)} maxLength={OPENING_MAX} rows={3} data-tip={t("tipPieceOpening")} className={inputClass()} />
          </label>
        )}
        {!shaped && <ModelPicker step="outline" value={c.models.outline} onChange={c.setModel("outline")} />}
        <ModelPicker step="write" value={c.models.write} onChange={c.setModel("write")} />
        {!shaped && <ModelPicker step="edit" value={c.models.edit} onChange={c.setModel("edit")} />}
      </div>
    </NoteSection>
  );
}

/**
 * New piece's press: the notes are the pills' `narrow`, and the topics added
 * there are what the piece is about, with the words typed in its fields. One
 * press, at the price on it, writes the outline, or shapes the recording
 * picked into the whole piece; `onStarted` opens the piece.
 */
export function WriteIt({ choice, narrow, topics, onStarted }: { choice: PieceChoice; narrow: Partial<Narrow>; topics: string[]; onStarted: (id: string) => void }) {
  const { t } = useLang();
  const quote = useApi<Quote>(newQuoteUrl(choice, narrow), { keepPreviousData: true });
  // The price of what is chosen now: nothing, its slot held, while a changed choice is being priced.
  const price = answeredNow(quote);
  const { busy, note, start } = useStartPiece(choice, async () => (await quote.mutate()) ?? undefined);
  const shaped = choice.spoken !== null;
  // A shaped piece is about what was said: its words are only what the shaping should know.
  const brief = shaped ? choice.brief.trim() : [topics.join(", "), choice.brief.trim()].filter(Boolean).join("\n\n");
  const why = price?.credits != null ? (shaped ? t("pieceCostShape", { n: price.credits, balance: price.balance ?? 0 }) : t("pieceCostOutline", { n: price.credits, notes: price.notes ?? 0, balance: price.balance ?? 0 })) : undefined;
  return (
    <section className="space-y-2">
      <PressButton
        label={shaped ? t(busy ? "pieceShaping" : "pieceShape") : busy ? t("pieceOutlining") : t("pieceOutline")}
        tip={t(shaped ? "tipPieceShape" : "tipPieceOutline")}
        primary
        disabled={busy || (shaped ? !choice.spoken : !brief) || choice.unsized || !price}
        quote={price}
        why={why}
        onPress={() => void start(brief, shaped ? undefined : narrow, price?.credits).then((id) => id && onStarted(id))}
      />
      {!shaped && !brief && <p className="text-xs text-muted-foreground">{t("pieceBriefNeeded")}</p>}
      {price && price.credits === null && <p className="text-xs text-muted-foreground">{t(shaped ? "pieceNoRecording" : "pieceNoNotes")}</p>}
      {note && <Notice tone="error">{note}</Notice>}
    </section>
  );
}

export type Piece = {
  id: string;
  title: string | null;
  brief: string;
  form_key: string | null;
  form_name: string;
  words: number;
  voice_name: string | null;
  /** Once written: its voice's measures, to set the piece beside. */
  voice_measures: Measures | null;
  opening: string | null;
  /** The recording it is shaped from; null when written from an outline. */
  spoken_id: string | null;
  /** Numbers and names the shaped piece has that the recording never said, until the person checks them. */
  unkept: string[] | null;
  stage: "outline" | "piece";
  status: "running" | "done" | "failed";
  outline: Outline | null;
  piece: string | null;
  notes: number | null;
  read_ids: string[] | null;
  extracts: Extract[] | null;
  models: Record<Step, WritingModel>;
  error: string | null;
  created_at: string;
  spent?: { costUsd: number; readTokens: number; wroteTokens: number };
};

export type PieceAnswer = { piece: Piece; named: { id: string; path: string | null; recorded_at: string }[] };

/** Where one piece is read back, whole. */
export const pieceUrl = (id: string) => `${PIECES}?id=${encodeURIComponent(id)}`;

/**
 * One piece. While a stage runs it says so and asks again every 3 s. With
 * its outline written: the outline to change (kept as each field is left,
 * free), "Write it" at its price, or the outline again. Once written: the
 * piece, the passages it rested on and the notes it read. A piece shaped
 * from a recording has no outline: anything in it the recording never said
 * is listed above it to check, with "Shape it again" or "They're right",
 * and until then it is not finished. `big` heads it as a page; `written` is
 * what the page offers above a finished piece.
 */
export function PieceView({ id, big = false, written }: { id: string; big?: boolean; written?: (piece: { title: string; text: string }) => React.ReactNode }) {
  const { lang, t } = useLang();
  const page = useApi<PieceAnswer>(pieceUrl(id), {
    refreshInterval: (latest) => (latest?.piece.status === "running" ? 3000 : 0),
  });
  const piece = page.data?.piece;
  const ready = piece && piece.status !== "running";
  // Each step's model as picked here, over the piece's own; kept on the piece at the press.
  const [picked, setPicked] = useState<Partial<Record<Step, WritingModel>>>({});
  const models = { ...DEFAULT_MODELS, ...piece?.models, ...picked };
  const quoteOf = (stage: "outline" | "piece") =>
    `${QUOTE}?id=${encodeURIComponent(id)}&stage=${stage}&models=${encodeURIComponent(JSON.stringify(stage === "piece" ? { write: models.write, edit: models.edit } : { outline: models.outline }))}`;
  const writeQuote = useApi<Quote>(ready && (piece.outline || piece.spoken_id) ? quoteOf("piece") : null, { keepPreviousData: true });
  const againQuote = useApi<Quote>(ready && piece.stage === "outline" ? quoteOf("outline") : null, { keepPreviousData: true });
  const pick = (step: Step) => (m: WritingModel) => setPicked((p) => ({ ...p, [step]: m }));
  const [draft, setDraft] = useState<Outline | null>(null);
  const saving = useRef<Promise<unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!allAnswered(page)) return null;
  if (!piece) return <p className="text-sm text-muted-foreground">{t("pieceGone")}</p>;
  const outline = draft ?? piece.outline;
  const notes = new Map((page.data?.named ?? []).map((n) => [n.id, n]));
  const name = (noteId: string) => notes.get(noteId)?.path || formatDate(notes.get(noteId)!.recorded_at, lang);
  const words = outline?.sections.reduce((sum, s) => sum + s.words, 0) ?? 0;

  /** The outline as changed, kept on the server so the price is of what will be written. */
  function keep(next: Outline) {
    setDraft(next);
  }
  function save(next = draft) {
    if (!next) return Promise.resolve();
    const sent = send(PIECES, "PATCH", { id, outline: next })
      .then(() => writeQuote.mutate())
      .catch(() => setNote(t("saveFailed")));
    saving.current = sent;
    return sent;
  }

  async function press(stage: "outline" | "piece") {
    setBusy(true);
    setNote(null);
    const releasePage = busyUntilDone();
    try {
      const quote = stage === "piece" ? writeQuote : againQuote;
      const shown = quote.data?.credits;
      if (saving.current) await saving.current;
      // The outline as it stands on screen is the one priced and written.
      if (stage === "piece" && draft) await save();
      // An outline changed since its price was shown is priced again before anything runs.
      const fresh = stage === "piece" ? await quote.mutate() : quote.data;
      if (fresh?.credits !== shown) {
        setNote(t("priceChanged", { n: fresh?.credits ?? "?" }));
        return;
      }
      const chosen = stage === "piece" ? { write: models.write, edit: models.edit } : { outline: models.outline };
      await send(PIECES, "POST", { id, stage, models: chosen, ...(shown == null ? {} : { credits: shown }) });
      setDraft(null);
      setPicked({});
      await page.mutate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        const fresh = await (stage === "piece" ? writeQuote : againQuote).mutate();
        setNote(t("priceChanged", { n: fresh?.credits ?? "?" }));
      } else setNote(refused(t, err));
    } finally {
      releasePage();
      setBusy(false);
    }
  }

  const section = (i: number, change: Partial<Outline["sections"][number]>) =>
    outline && keep({ ...outline, sections: outline.sections.map((s, j) => (j === i ? { ...s, ...change } : s)) });
  const priceWhy = (q: Quote | undefined, key: "pieceCostWrite" | "pieceCostOutline") =>
    q?.credits != null ? t(key, { n: q.credits, notes: q.notes ?? 0, balance: q.balance ?? 0 }) : undefined;
  const title = outline?.title || piece.title || piece.brief;
  const shaped = Boolean(piece.spoken_id);
  const unkept = piece.unkept ?? [];

  async function checked() {
    try {
      await send(PIECES, "PATCH", { id, checked: true });
      await page.mutate();
    } catch {
      setNote(t("saveFailed"));
    }
  }

  /** Shape the recording again, at its price, on the model picked. */
  const shapeAgain = (
    <div className="mt-4 space-y-3">
      <ModelPicker step="write" value={models.write} onChange={pick("write")} />
      <PressButton label={busy ? t("pieceShaping") : t("pieceShapeAgain")} tip={t("tipPieceShapeAgain")} primary={piece.status === "failed"} disabled={busy} quote={writeQuote.data} why={writeQuote.data?.credits != null ? t("pieceCostShape", { n: writeQuote.data.credits, balance: writeQuote.data.balance ?? 0 }) : undefined} onPress={() => void press("piece")} />
    </div>
  );

  return (
    <div>
      {big ? <h1 className="mb-1 text-2xl font-bold">{title}</h1> : <h3 className="mb-1 text-sm font-semibold">{title}</h3>}
      <p className="mb-1 text-sm text-muted-foreground">
        {formName(t, piece.form_key, piece.form_name)} · {piece.voice_name ?? t("writingNoVoice")} · {formatDate(piece.created_at, lang)}
        {piece.notes ? ` · ${t("libraryNotes", { n: piece.notes })}` : ""}
      </p>
      <SpentLine spent={piece.spent} />
      <p className="mt-3 text-sm">{piece.brief}</p>

      {piece.status === "running" && <Notice className="mt-6">{t(shaped ? "pieceShapingWhat" : piece.stage === "outline" ? "pieceOutliningWhat" : "pieceWritingWhat")}</Notice>}
      {piece.status === "failed" && <Notice tone="error" className="mt-6">{t(piece.error === "declined" ? "pieceDeclined" : "pieceFailed")}</Notice>}
      {note && <Notice tone="error" className="mt-4">{note}</Notice>}

      {piece.stage === "piece" && piece.status === "done" && piece.piece && unkept.length > 0 && (
        <section className="mt-6 space-y-3">
          <Notice tone="primary">{t("pieceUnkept", { list: unkept.join(", ") })}</Notice>
          <Button size="sm" tip={t("tipPieceChecked")} disabled={busy} onClick={() => void checked()}>
            {t("pieceChecked")}
          </Button>
          {shapeAgain}
        </section>
      )}

      {shaped && piece.status === "failed" && shapeAgain}

      {piece.stage === "piece" && piece.status === "done" && piece.piece && (
        <>
          {unkept.length === 0 && written?.({ title: piece.title || piece.brief, text: piece.piece })}
          <section className="mb-6 mt-4">
            <ReadingProse text={piece.piece} />
          </section>
          {piece.voice_measures && measure([piece.piece]) && (
            <section className="mb-6 space-y-2">
              <Heading>{t("pieceMeasures")}</Heading>
              <p className="text-xs text-muted-foreground">{t("pieceMeasuresWhat")}</p>
              <MeasuresTable
                columns={[
                  { label: t("measurePiece"), m: measure([piece.piece])! },
                  { label: t("measureVoice"), m: piece.voice_measures },
                ]}
              />
            </section>
          )}
        </>
      )}

      {outline && piece.status !== "running" && !(piece.stage === "piece" && piece.status === "done") && (
        <section className="mt-6 space-y-4">
          <Heading>{t("pieceOutlineHeading")}</Heading>
          <p className="text-xs text-muted-foreground">{t("pieceOutlineWhat", { n: words, aim: piece.words })}</p>
          <Input value={outline.title} onChange={(e) => keep({ ...outline, title: e.target.value })} onBlur={() => void save()} maxLength={200} data-tip={t("tipPieceTitle")} />
          <ol className="space-y-4">
            {outline.sections.map((s, i) => (
              <li key={i} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex gap-2">
                  <Input value={s.heading} onChange={(e) => section(i, { heading: e.target.value })} onBlur={() => void save()} maxLength={300} data-tip={t("tipPieceHeading")} />
                  <Input
                    type="number"
                    min={30}
                    max={20000}
                    value={String(s.words)}
                    onChange={(e) => section(i, { words: Math.max(30, Math.min(20000, Math.round(Number(e.target.value) || 30))) })}
                    onBlur={() => void save()}
                    data-tip={t("tipPieceWords")}
                    className="w-24 shrink-0"
                  />
                </div>
                <textarea value={s.says} onChange={(e) => section(i, { says: e.target.value })} onBlur={() => void save()} maxLength={4000} rows={3} data-tip={t("tipPieceSays")} className={inputClass()} />
                {outline.sections.length > 1 && (
                  <Button
                    variant="link"
                    tip={t("tipPieceDropSection")}
                    onClick={() => {
                      const next = { ...outline, sections: outline.sections.filter((_, j) => j !== i) };
                      keep(next);
                      void save(next);
                    }}
                  >
                    {t("pieceDropSection")}
                  </Button>
                )}
              </li>
            ))}
          </ol>
          {outline.sections.length < 30 && (
            <Button size="sm" tip={t("tipPieceAddSection")} onClick={() => keep({ ...outline, sections: [...outline.sections, { heading: t("pieceNewSection"), says: t("pieceNewSectionSays"), words: 300 }] })}>
              {t("pieceAddSection")}
            </Button>
          )}
          <NoteSection id="piece-models" title={t("pieceModels")} hint={t("pieceModelsWhat")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <ModelPicker step="write" value={models.write} onChange={pick("write")} />
              <ModelPicker step="edit" value={models.edit} onChange={pick("edit")} />
              {piece.stage === "outline" && <ModelPicker step="outline" value={models.outline} onChange={pick("outline")} />}
            </div>
          </NoteSection>
          <div className="flex flex-wrap gap-3">
            <PressButton label={busy ? t("pieceWriting") : t("pieceWrite")} tip={t("tipPieceWrite")} primary disabled={busy} quote={writeQuote.data} why={priceWhy(writeQuote.data, "pieceCostWrite")} onPress={() => void press("piece")} />
            {piece.stage === "outline" && (
              <PressButton label={t("pieceOutlineAgain")} tip={t("tipPieceOutlineAgain")} primary={false} disabled={busy} quote={againQuote.data} why={priceWhy(againQuote.data, "pieceCostOutline")} onPress={() => void press("outline")} />
            )}
          </div>
        </section>
      )}

      {!outline && !shaped && piece.status === "failed" && (
        <div className="mt-4 space-y-3">
          <ModelPicker step="outline" value={models.outline} onChange={pick("outline")} />
          <PressButton label={t("pieceOutlineAgain")} tip={t("tipPieceOutlineAgain")} primary disabled={busy} quote={againQuote.data} why={priceWhy(againQuote.data, "pieceCostOutline")} onPress={() => void press("outline")} />
        </div>
      )}

      {(piece.extracts ?? []).some((e) => notes.has(e.id)) && (
        <section className="mb-6 space-y-3">
          <Heading>{t("libraryExtracts")}</Heading>
          {(piece.extracts ?? []).filter((e) => notes.has(e.id)).map((e, i) => (
            <blockquote key={i} className="border-l-2 border-primary/40 pl-3 text-sm">
              <p className="italic">“{e.quote}”</p>
              <NoteLink note={{ id: e.id, path: notes.get(e.id)!.path }} tip={t("tipLibraryNote")} className="text-xs text-primary hover:underline">
                {name(e.id)}
              </NoteLink>
            </blockquote>
          ))}
        </section>
      )}

      {(piece.read_ids ?? []).some((n) => notes.has(n)) && (
        <section className="mb-6 space-y-2">
          <Heading>{t("libraryRead")}</Heading>
          <ul className="space-y-1 text-sm">
            {(piece.read_ids ?? []).filter((n) => notes.has(n)).map((n) => (
              <li key={n}>
                <NoteLink note={{ id: n, path: notes.get(n)!.path }} tip={t("tipLibraryNote")} className="text-primary hover:underline">
                  {name(n)}
                </NoteLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
