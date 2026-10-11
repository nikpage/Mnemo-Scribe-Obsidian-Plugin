// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Lang, LANGUAGE_NAMES } from "@/lib/i18n";
import { generate, readJson } from "@/lib/ai/call";
import { z } from "zod";
import { type CostContext } from "@/lib/ai/cost";
import { nearestByVector } from "@/lib/note/neighbours";
import { spokenDate } from "@/lib/note/facts";
import { READ } from "@/lib/note/shelf";

const MODEL = "gemini-3.1-flash-lite";

export const LINK_TYPES = ["outcome-of", "same-event", "contradicts", "revisits", "continues"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/**
 * Below this a judgement is not worth a row. Between this and `SURE` the
 * link is written but left unconfirmed, which is what step 4 turns into a
 * single question.
 */
export const FLOOR = 0.35;
export const SURE = 0.8;

/** How far apart two notes can be and still be read as one piece. */
export const SERIES_WINDOW_MS = 3 * 60 * 60 * 1000;

/** How many notes are put in front of the model at once. */
const CANDIDATES = 24;

/**
 * Below this many notes, every note is a candidate.
 *
 * The three-way gather exists because a large store cannot be read whole in
 * one prompt. A small one can, and while it fits, narrowing it only loses
 * links: a pair that shares neither vocabulary, a fact subject, nor a tag
 * is exactly the connection a person cannot make on their own, and the
 * gather is what hides it. One call either way — the cost is the prompt, and
 * at this size the prompt is small.
 */
const WHOLE_STORE_BELOW = 60;

/**
 * Where a link candidate comes from.
 *
 * Meaning alone is not enough, and this is the one place it visibly fails: a
 * batch note ("two litres, ginger, started today") and its tasting note
 * three weeks later ("too sharp, drinking it anyway") share almost no
 * vocabulary, so their vectors sit well apart — exactly the pair this
 * feature exists to find. What they *do* share is a subject in the facts
 * table and a tag.
 *
 * So candidates come from three directions at once, and the vector floor is
 * deliberately lower than the one the vault uses: a candidate only has to be
 * worth looking at, not worth writing into someone's front matter.
 */
async function candidates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  note: { id: string; tags: string[]; recordedAt: string }
): Promise<string[]> {
  const found = new Set<string>();

  // A store that fits in one prompt is read whole.
  const { count } = await admin
    .from("recordings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "done");

  if ((count || 0) <= WHOLE_STORE_BELOW) {
    const { data: all } = await admin
      .from("recordings")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "done")
      .neq("id", note.id);

    return (all || []).map((row) => row.id as string);
  }

  const near = await nearestByVector(admin, userId, note.id, { floor: 0.55, limit: 12 });
  near.forEach((n) => found.add(n.id));

  // Every note that has ever stated something about the same subject. Not
  // grouped and not deduplicated by property: a tasting on the 22nd has to
  // be able to see a batch started on the 18th, which is the whole loop.
  const { data: own } = await admin
    .from("note_facts")
    .select("subject")
    .eq("user_id", userId)
    .eq("recording_id", note.id);

  const subjects = [...new Set((own || []).map((f) => f.subject))].filter(Boolean);

  if (subjects.length > 0) {
    const { data: sharing } = await admin
      .from("note_facts")
      .select("recording_id")
      .eq("user_id", userId)
      .in("subject", subjects)
      .neq("recording_id", note.id)
      .limit(200);

    for (const row of sharing || []) found.add(row.recording_id);
  }

  // Notes sharing a tag. A run and its outcome are usually tagged alike —
  // the same batch, the same project — however differently they are worded.
  if (note.tags.length > 0) {
    const { data: siblings } = await admin
      .from("recordings")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "done")
      .neq("id", note.id)
      .overlaps("tags", note.tags)
      .order("recorded_at", { ascending: false })
      .limit(20);

    for (const row of siblings || []) found.add(row.id);
  }

  // Notes said just before or after this one. Back-to-back notes are often
  // one thought in two goes, filed apart and sharing few words.
  if (note.recordedAt) {
    const at = new Date(note.recordedAt).getTime();
    const since = new Date(at - SERIES_WINDOW_MS).toISOString();
    const until = new Date(at + SERIES_WINDOW_MS).toISOString();
    const { data: recent } = await admin
      .from("recordings")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "done")
      .neq("id", note.id)
      .gte("recorded_at", since)
      .lte("recorded_at", until)
      .limit(10);

    for (const row of recent || []) found.add(row.id);
  }

  return [...found];
}

/** A candidate as the model sees it: enough to judge, no more. */
interface Sketch {
  id: string;
  label: string;
  tags: string[];
  recordedAt: string;
  recordedOn: string;
  summary: string;
  facts: string[];
}

async function sketch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  ids: string[]
): Promise<Sketch[]> {
  if (ids.length === 0) return [];

  const { data: notes } = await admin
    .from("recordings")
    .select("id, label, tags, recorded_at, analysis")
    .eq("user_id", userId)
    .eq("status", "done")
    // Every candidate passes here: none from Cold storage or Trash.
    .in("shelf", READ)
    .in("id", ids);

  const { data: facts } = await admin
    .from("note_facts")
    .select("recording_id, subject, variable, value_text, happened_on, happened_precision")
    .eq("user_id", userId)
    .in("recording_id", ids)
    .gte("confidence", 0.5)
    .limit(400);

  const byNote = new Map<string, string[]>();
  for (const f of facts || []) {
    const line = `${f.subject} ${f.variable}: ${f.value_text}${
      f.happened_on ? ` (${spokenDate(f.happened_on, f.happened_precision)})` : ""
    }`;
    byNote.set(f.recording_id, [...(byNote.get(f.recording_id) || []), line]);
  }

  return (notes || []).map((n) => ({
    id: n.id,
    label: n.label || "",
    tags: n.tags || [],
    recordedAt: n.recorded_at || "",
    recordedOn: (n.recorded_at || "").slice(0, 10),
    summary: n.analysis?.summary || "",
    facts: (byNote.get(n.id) || []).slice(0, 12),
  }));
}

function render(s: Sketch, index?: number, side?: "earlier" | "later"): string {
  const head = index === undefined ? "THIS NOTE" : `[${index}] (${side})`;
  return [
    `${head} ${s.label}${s.tags.length ? ` — tags: ${s.tags.join(", ")}` : ""} (recorded ${s.recordedOn})`,
    s.summary && `  ${s.summary}`,
    ...s.facts.map((f) => `  · ${f}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export interface ProposedLink {
  /** Always the later note of the two; `to` the earlier. */
  from: string;
  to: string;
  type: LinkType;
  confidence: number;
  reason: string;
}

/**
 * The five kinds, as every prompt that judges a link states them: one note
 * check here, and the What next readings, which note links on the way.
 */
export const LINK_KINDS = `Every kind describes the LATER note of the pair against the EARLIER one. The five kinds, and nothing else:
- "outcome-of": the later note reports how the earlier thing turned out. A tasting is the outcome of the batch it tastes; a follow-up appointment is the outcome of the symptom recorded before it.
- "same-event": both notes are about one occasion, recorded separately — before and after the same meeting.
- "contradicts": the later note states something incompatible with the earlier note. Both cannot be true.
- "continues": the later note is the next part of the same piece of work — the next chapter, lecture or numbered part. The writer carried straight on; they did not come back to an old subject.
- "revisits": the later note returns to the earlier subject with something new, without being any of the above.

Being about the same topic is NOT a link. Two separate batches of the same drink are two runs, not one event, and neither is the outcome of the other.`;

/** One note's check: every note it was compared with, and the links found. */
export interface Judgement {
  noteId: string;
  judged: string[];
  links: ProposedLink[];
}

/** Whether `a` was recorded after `b`; on a tie, the id decides, so it is stable. */
function isLater(a: { id: string; recordedAt: string }, b: { id: string; recordedAt: string }): boolean {
  return a.recordedAt === b.recordedAt ? a.id > b.id : a.recordedAt > b.recordedAt;
}

/**
 * What this note has to do with the notes around it, earlier and later.
 *
 * One model call. The candidates are found without a model and the facts are
 * already extracted, so the only thing being paid for is the judgement
 * itself — how two notes relate, and why.
 *
 * Date does not decide what is compared: a note imported out of order, or
 * looked at again, is set against every note, before and after it. Date only
 * decides which way a link is stored — from the later note to the earlier —
 * because "the outcome of" reads one way round only, and that is not the
 * model's to guess.
 */
export async function judgeLinks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  noteId: string,
  labelLang: Lang,
  ctx: CostContext
): Promise<Judgement> {
  const none: Judgement = { noteId, judged: [], links: [] };

  const { data: note } = await admin
    .from("recordings")
    .select("id, label, tags, recorded_at, analysis")
    .eq("user_id", userId)
    .eq("id", noteId)
    .in("shelf", READ)
    .maybeSingle();

  if (!note) return none;

  const ids = await candidates(admin, userId, {
    id: noteId,
    tags: note.tags || [],
    recordedAt: note.recorded_at || "",
  });
  if (ids.length === 0) return none;

  const [self] = await sketch(admin, userId, [noteId]);
  if (!self) return none;

  // The nearest in time first: a follow-up is usually close to what it follows.
  const at = new Date(self.recordedAt || 0).getTime();
  const distance = (s: Sketch) => Math.abs(new Date(s.recordedAt || 0).getTime() - at);
  const others = (await sketch(admin, userId, ids))
    .filter((s) => s.id !== noteId)
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, CANDIDATES);

  if (others.length === 0) return none;

  // A pair the user has already rejected is not judged again, whichever end
  // it was judged from. Asking the same wrong question twice is worse than
  // not asking.
  const { data: rejected } = await admin
    .from("note_links")
    .select("from_recording, to_recording, link_type")
    .eq("user_id", userId)
    .or(`from_recording.eq.${noteId},to_recording.eq.${noteId}`)
    .eq("confirmed", false);

  const refused = new Set(
    (rejected || []).map((r) => `${r.from_recording === noteId ? r.to_recording : r.from_recording}|${r.link_type}`)
  );

  const parts = [
    `Decide what this note has to do with each other note listed. Each is marked (earlier) or (later) than this note. Most pairs have nothing to do with each other — returning nothing is the normal answer, and a link nobody would agree with is worse than no link.

${LINK_KINDS}

Return a JSON array, one object per link you are willing to defend:
{"note": <the [number]>, "type": one of the five, "confidence": 0 to 1, "reason": one short sentence}

- "confidence": how sure you are that this exact relation holds. Below 0.4 when it is a guess from topic alone; above 0.8 only when the notes say it themselves — a date lining up, a run named, an explicit "the batch I started".
- "reason": one sentence, in ${LANGUAGE_NAMES[labelLang]}, naming the evidence rather than restating the type. "Tastes the batch started on the 18th", not "this is the outcome".

Return ONLY the JSON array, no fences. An empty array when nothing genuinely links.`,
    `\n\n${render(self)}\n\nOTHER NOTES:\n${others
      .map((o, i) => render(o, i, isLater(self, o) ? "earlier" : "later"))
      .join("\n\n")}`,
  ];

  const answer = await generate({ model: MODEL, operation: "links", ctx, parts, json: true });
  const judged = others.map((o) => o.id);

  const parsed = readJson(answer, z.array(z.record(z.string(), z.unknown())));
  if (!parsed) return { noteId, judged, links: [] };

  const seen = new Set<string>();

  const links = parsed.flatMap((entry) => {
    const link = entry as Record<string, unknown>;
    const index = typeof link.note === "number" ? link.note : -1;
    const target = others[index];
    const type = String(link.type || "") as LinkType;
    if (!target || !LINK_TYPES.includes(type)) return [];

    const confidence =
      typeof link.confidence === "number" && link.confidence >= 0 && link.confidence <= 1
        ? link.confidence
        : 0.5;
    if (confidence < FLOOR) return [];

    const key = `${target.id}|${type}`;
    if (seen.has(key) || refused.has(key)) return [];
    seen.add(key);

    const later = isLater(self, target);
    return [
      {
        from: later ? noteId : target.id,
        to: later ? target.id : noteId,
        type,
        confidence,
        reason: String(link.reason || "").trim(),
      },
    ];
  });

  return { noteId, judged, links };
}

/**
 * Writes what was judged, leaving anything the user has settled alone, and
 * marks the note looked at.
 *
 * A link the user confirmed or rejected is theirs: re-judging a note
 * rewrites only what a model put there, and only between this note and the
 * notes it was compared with — a link another note's check found stays until
 * a check that saw both says otherwise. That is what makes it safe to
 * re-index a note after an edit without undoing an answered question.
 */
export async function saveLinks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  { noteId, judged, links }: Judgement
): Promise<void> {
  try {
    if (judged.length > 0) {
      await admin
        .from("note_links")
        .delete()
        .eq("user_id", userId)
        .eq("from_recording", noteId)
        .in("to_recording", judged)
        .is("confirmed", null);
      await admin
        .from("note_links")
        .delete()
        .eq("user_id", userId)
        .eq("to_recording", noteId)
        .in("from_recording", judged)
        .is("confirmed", null);
    }

    if (links.length > 0) {
      await admin.from("note_links").upsert(
        links.map((l) => ({
          user_id: userId,
          from_recording: l.from,
          to_recording: l.to,
          link_type: l.type,
          confidence: l.confidence,
          reason: l.reason,
        })),
        { onConflict: "from_recording,to_recording,link_type", ignoreDuplicates: true }
      );
    }

    await admin
      .from("recordings")
      .update({ links_read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", noteId);
  } catch (err) {
    console.error("Saving links failed (non-fatal):", err);
  }
}

/**
 * Links a What next reading noticed, and every note it read marked looked
 * at. Only adds: a sweep of the whole store is less careful than one note's
 * check, so it never clears what a check found, and a pair settled either
 * way is left as it is (`ignoreDuplicates`). `later` and `earlier` are the
 * model's; which way round they are stored is the dates', not its.
 */
export async function addLinks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  read: { id: string; recordedAt: string }[],
  found: { later: string; earlier: string; type: string; confidence: number; reason: string }[]
): Promise<void> {
  try {
    const byId = new Map(read.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const rows = found.flatMap((link) => {
      const a = byId.get(link.later);
      const b = byId.get(link.earlier);
      const type = link.type as LinkType;
      if (!a || !b || a.id === b.id || !LINK_TYPES.includes(type) || link.confidence < FLOOR) return [];
      const [from, to] = isLater(a, b) ? [a.id, b.id] : [b.id, a.id];
      const key = `${from}|${to}|${type}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ user_id: userId, from_recording: from, to_recording: to, link_type: type, confidence: link.confidence, reason: link.reason.trim() }];
    });

    if (rows.length > 0) {
      await admin.from("note_links").upsert(rows, { onConflict: "from_recording,to_recording,link_type", ignoreDuplicates: true });
    }
    if (read.length > 0) {
      await admin
        .from("recordings")
        .update({ links_read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .in("id", read.map((n) => n.id));
    }
  } catch (err) {
    console.error("Saving a reading's links failed (non-fatal):", err);
  }
}
