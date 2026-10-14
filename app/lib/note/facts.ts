// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Lang, LANGUAGE_NAMES } from "@/lib/i18n";
import { generate, readJson } from "@/lib/ai/call";
import { z } from "zod";
import { weekdayOf } from "@/lib/format";
import { type CostContext } from "@/lib/ai/cost";
import type { Utterance } from "@/lib/transcription/types";
import type { WatchItem } from "@/lib/packs";
import type { FactHit } from "@/lib/note/fact-line";
import { READ } from "@/lib/note/shelf";

export type { FactHit };

const MODEL = "gemini-3.1-flash-lite";

/**
 * A fact's date cut to what was said: "1967", "1967-03" or "1967-03-10".
 * Facts read before the precision was kept have none; for those a first of
 * January is taken as a year and a first of the month as a month, since that
 * is how a year or month was stored.
 */
export function spokenDate(day: string | null, precision: string | null): string | null {
  if (!day) return null;
  const p = precision ?? (day.endsWith("-01-01") ? "year" : day.endsWith("-01") ? "month" : "day");
  return p === "year" ? day.slice(0, 4) : p === "month" ? day.slice(0, 7) : day.slice(0, 10);
}

export interface NoteFact {
  subject: string;
  variable: string;
  valueText: string;
  valueNum: number | null;
  unit: string | null;
  /** The day the fact is about — what the speaker meant, not when they spoke. */
  happenedOn: string | null;
  /** How much of `happenedOn` was said: a year, a month, or the day itself. */
  happenedPrecision: "year" | "month" | "day" | null;
  /** The day it was said: the recording's own date, and the only measured one. */
  saidOn: string;
  saidAt: number | null;
  utteranceIndex: number | null;
  quote: string;
  confidence: number;
}

/**
 * Reading a note for everything it states.
 *
 * Greedy on purpose. What matters in a note is not knowable while it is
 * being recorded — the sourness reading that explains a batch three weeks
 * later looked like small talk at the time — and a fact never extracted is
 * one no question can reach. So everything measured, named, dated or
 * decided comes out, and relevance is decided when something is asked, not
 * now.
 *
 * Two things keep that from becoming noise. Every fact carries the sentence
 * it came from, so it can be checked rather than believed; and every fact
 * carries a confidence, so a guess can be filtered without being discarded.
 */
export async function extractFacts(
  utterances: Utterance[],
  speakers: Record<string, string>,
  recordedOn: string,
  labelLang: Lang,
  ctx: CostContext,
  watch: WatchItem[] = []
): Promise<NoteFact[]> {
  if (utterances.length === 0) return [];

  // Numbered, so the model can point at the line a fact came from and the
  // timing can be looked up here rather than invented there.
  const transcript = utterances
    .map((u, i) => {
      const name = speakers[u.speaker] || `Speaker ${u.speaker}`;
      return `[${i}] ${name}: ${u.text}`;
    })
    .join("\n");

  // Which weekday the recording fell on. Without it "last Friday" cannot be
  // resolved at all — the model would be counting back from a date whose day
  // of the week it does not know, and a fact would file on the wrong day.
  const weekday = weekdayOf(recordedOn);

  const parts = [
    `Extract every fact stated in this note. Be exhaustive rather than selective: include anything measured, counted, dated, named, decided, paid, felt or observed, whether or not it seems important. A note about brewing that mentions a headache gives both. Every fact must read on its own, weeks later, without the note.

Return a JSON array of objects with these fields:
- "subject": what the fact is about, as few words as possible — "kombucha", "back pain", "jan". The thing itself, never a sentence. When it is about the speaker, the word for "me".
- "variable": what was said about it — "sourness", "dose", "paid", "started", "age", "poverty rate". The property, in words that make sense without the note, so two notes about the same thing line up as one series. Never a kind of measurement ("count", "percentage", "number", "value"). When the value only means something beside an event, the variable names that event: "age when moved to Prague", never just "age". Reuse the same word for the same property.
- "valueText": the value exactly as the speaker gave it, including the unit and any words that qualify it.
- "valueNum": the numeric part as a number, or null when the value is not a number.
- "unit": the unit alone ("days", "ml", "kc", "degrees"), or null.
- "happenedOn": when this fact is about, exactly as precisely as the speaker said it and never more: "YYYY" for a year ("in 1967"), "YYYY-MM" for a month ("last March"), "YYYY-MM-DD" for a day ("10 January 1967", "yesterday"). This note was recorded on ${recordedOn}, which was a ${weekday}. Resolve every relative phrase against that: "yesterday" is the day before it, "last Friday" is the most recent Friday strictly before it, "three days ago" counts back from it. A fact spoken on a Monday about last Friday belongs to that Friday, never to the Monday. "Today" or "now" is ${recordedOn}. Null when the speaker says nothing about when — never invent a day or month that was not said.
- "utteranceIndex": the [number] of the line it came from.
- "quote": the sentence it was read from, copied exactly as it appears.
- "confidence": 0 to 1. Below 0.5 when you are inferring rather than reading.

"subject" and "variable" must be written in ${LANGUAGE_NAMES[labelLang]}, whatever language the note is in, so the same thing has one name across the store. "valueText" and "quote" stay in the language the note was spoken in.

Return ONLY valid JSON, no markdown fences and no other text. An empty array when the note states nothing.`,
    // Only with a pack on. Without one the prompt is exactly what it was
    // before packs existed, which a test holds it to.
    ...(watch.length ? [watchBlock(watch, labelLang)] : []),
    `\n\nTRANSCRIPT:\n${transcript}`,
  ];

  const answer = await generate({ model: MODEL, operation: "facts", ctx, parts, json: true });

  const parsed = readJson(answer, z.array(z.record(z.string(), z.unknown())));
  if (!parsed) return [];

  return applyWatchList(parsed.flatMap((raw) => {
    const fact = raw as Record<string, unknown>;
    const subject = String(fact.subject || "").trim().toLowerCase();
    const variable = String(fact.variable || "").trim().toLowerCase();
    const valueText = String(fact.valueText ?? "").trim();
    // A fact missing any of its three halves is not a fact, and neither is
    // one whose value only repeats what it is about ("israel and palestine:
    // Israel and Palestine").
    if (!subject || !variable || !valueText) return [];
    if (valueText.toLowerCase() === subject || valueText.toLowerCase() === variable) return [];

    // The line number is the model's; the timing is ours, read off the
    // utterance it points at. A model never invents a timestamp here.
    const index =
      typeof fact.utteranceIndex === "number" &&
      fact.utteranceIndex >= 0 &&
      fact.utteranceIndex < utterances.length
        ? fact.utteranceIndex
        : null;

    const num = typeof fact.valueNum === "number" && Number.isFinite(fact.valueNum)
      ? fact.valueNum
      : null;

    // Stored as a whole day, with how much of it was said beside it.
    const said = typeof fact.happenedOn === "string" ? fact.happenedOn.trim() : "";
    const [day, precision] = /^\d{4}-\d{2}-\d{2}$/.test(said)
      ? [said, "day" as const]
      : /^\d{4}-\d{2}$/.test(said)
        ? [`${said}-01`, "month" as const]
        : /^\d{4}$/.test(said)
          ? [`${said}-01-01`, "year" as const]
          : [null, null];

    return [
      {
        subject,
        variable,
        valueText,
        valueNum: num,
        unit: fact.unit ? String(fact.unit).trim().toLowerCase() : null,
        happenedOn: day,
        happenedPrecision: precision,
        // Never the model's to decide: this is the recording's own date.
        saidOn: recordedOn,
        saidAt: index !== null ? (utterances[index].start ?? null) : null,
        utteranceIndex: index,
        quote: String(fact.quote ?? "").trim() || valueText,
        confidence:
          typeof fact.confidence === "number" && fact.confidence >= 0 && fact.confidence <= 1
            ? fact.confidence
            : 1,
      },
    ];
  }), watch);
}

function watchBlock(watch: WatchItem[], lang: Lang): string {
  const lines = watch.map((w) => {
    const subject = w.subject ? `"${w.subject[lang]}"` : "the thing named (e.g. the drug or exercise)";
    return `- subject ${subject}, variable "${w.variable[lang]}", unit "${w.unit}"`;
  });
  return `\n\nThis user tracks these numbers. When the note gives one, use exactly these subject, variable and unit names, converting the value to the unit:\n${lines.join("\n")}`;
}

/**
 * A unit written any other way becomes the pack's own, so one series never
 * splits into "mg" and "milligrams". Free and deterministic: the model is
 * asked for the unit, and this makes sure of it.
 */
export function applyWatchList(facts: NoteFact[], watch: WatchItem[]): NoteFact[] {
  if (watch.length === 0) return facts;
  const canon = new Map<string, string>();
  for (const w of watch) {
    canon.set(w.unit.toLowerCase(), w.unit);
    for (const a of w.unitAliases) canon.set(a.toLowerCase(), w.unit);
  }
  return facts.map((f) => {
    const unit = f.unit ? canon.get(f.unit.trim().toLowerCase()) : undefined;
    return unit ? { ...f, unit } : f;
  });
}

/**
 * Replaces a note's facts with what was just read from it.
 *
 * Facts are derived, so re-reading a note is always allowed to overwrite
 * them — there is nothing of the user's here to lose. Like indexing, a
 * failure costs a question that cannot be answered, never the note itself.
 */
export async function saveFacts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  recordingId: string,
  facts: NoteFact[]
): Promise<void> {
  try {
    // Read, whatever it yielded. Not the same as "has facts": a note can
    // genuinely state nothing, and using the presence of a fact row to mean
    // "already read" left such a note at the head of the backfill queue for
    // ever — two model calls per pass, for as long as the caller kept asking.
    await admin
      .from("recordings")
      .update({ facts_read_at: new Date().toISOString() })
      .eq("id", recordingId);

    await admin.from("note_facts").delete().eq("recording_id", recordingId);
    if (facts.length === 0) return;

    await admin.from("note_facts").insert(
      facts.map((f) => ({
        user_id: userId,
        recording_id: recordingId,
        subject: f.subject,
        variable: f.variable,
        value_text: f.valueText,
        value_num: f.valueNum,
        unit: f.unit,
        happened_on: f.happenedOn,
        happened_precision: f.happenedPrecision,
        said_on: f.saidOn,
        said_at: f.saidAt,
        utterance_index: f.utteranceIndex,
        quote: f.quote,
        confidence: f.confidence,
      }))
    );
  } catch (err) {
    console.error("Saving facts failed (non-fatal):", err);
  }
}

/** The row as it is read back, with the note it came from. */

/**
 * Question words, which are never the thing being asked about. "When did the
 * kombucha last go sour" is a question about kombucha and sourness; matching
 * on "when" or "did" would return the whole store.
 *
 * Both languages, because the user asks in whichever they think in.
 */
const STOP = new Set([
  "when", "did", "does", "do", "was", "were", "is", "are", "the", "a", "an",
  "last", "happen", "happened", "what", "have", "has", "had", "i", "my", "me",
  "about", "said", "say", "how", "much", "many", "on", "in", "at", "of", "for",
  "kdy", "naposledy", "co", "jsem", "rekl", "řekl", "bylo", "byl", "jak",
  "moc", "se", "na", "o", "to", "je", "jsou",
]);

/**
 * What the store already knows about the words in a question.
 *
 * This is a database lookup and nothing else — no embedding, no model, no
 * cost row. That is the whole point: "when did I last brew" is a question
 * the facts table answers outright, and paying a model to re-read prose for
 * something already stored as a date is the cost this table exists to
 * remove.
 *
 * One row per subject-and-property, the most recent kept, so asking about
 * kombucha returns the last sourness reading rather than twelve of them.
 */
export async function lookupFacts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  query: string,
  limit = 5
): Promise<FactHit[]> {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));

  if (words.length === 0) return [];

  // A subject or a property matching any word in the question. Postgres does
  // the filtering; nothing is scored here, because recency is the ranking a
  // question like this wants.
  const filter = words
    .flatMap((w) => [`subject.ilike.%${w}%`, `variable.ilike.%${w}%`])
    .join(",");

  const { data } = await admin
    .from("note_facts")
    .select(
      "id, recording_id, subject, variable, value_text, unit, happened_on, happened_precision, said_on, said_at, quote, recordings!inner(label, path)"
    )
    .eq("user_id", userId)
    // Only from notes the AI may read: none from Cold storage or Trash.
    .in("recordings.shelf", READ)
    .or(filter)
    .gte("confidence", 0.5)
    .order("happened_on", { ascending: false, nullsFirst: false })
    .limit(limit * 6);

  const seen = new Set<string>();
  const hits: FactHit[] = [];

  for (const row of (data || []) as unknown as Array<Record<string, any>>) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const key = `${row.subject}|${row.variable}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      id: row.id,
      recordingId: row.recording_id,
      noteLabel: row.recordings?.label || "",
      notePath: row.recordings?.path || "",
      subject: row.subject,
      variable: row.variable,
      valueText: row.value_text,
      unit: row.unit,
      happenedOn: spokenDate(row.happened_on, row.happened_precision),
      saidOn: row.said_on,
      saidAt: row.said_at,
      quote: row.quote,
    });
    if (hits.length >= limit) break;
  }

  return hits;
}
