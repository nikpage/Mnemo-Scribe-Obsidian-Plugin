// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { type Lang, LANGUAGE_NAMES } from "@/lib/i18n";
import { type Usage, generateWithUsage, readJson, resolveModel } from "@/lib/ai/call";
import { getAppSettings } from "@/lib/settings";
import { type CostContext, type TextModel, contextTokens, tokenCost } from "@/lib/ai/cost";
import { noteText } from "@/lib/note/build";
import { noteName } from "@/lib/note/filing";
import { nearestByVector } from "@/lib/note/neighbours";
import { embedQueries } from "@/lib/note/embed";
import { type LinkType } from "@/lib/note/links";
import {
  ANGLE_TYPES,
  type AngleType,
  type DraftAngle,
  type FilterNote,
  cosine,
  echoFault,
  evidenceFault,
} from "@/lib/note/angle-filter";
import { READ } from "@/lib/note/shelf";

/**
 * Angles: from one note, two or three ideas for new work, each resting on
 * two or more notes and each born of tension — a contradiction, a change of
 * mind, the same pattern in unrelated subjects, a question kept circling.
 * Never of likeness: two notes that agree are search's job, not this.
 *
 * One call over the whole store. An angle is only as good as what the model
 * could see, and the connection worth writing about is the one between a
 * note from last week and one from three years ago that share no words — so
 * no retrieval narrows it while the store fits. What comes back is then
 * checked without a model (`angle-filter.ts`) before anyone sees it.
 */

/** The synthesis tier: this is output a person judges the app by. */
const MODEL = "gemini-3.8-flash";

export const ANGLE_MODES = ["challenge", "continue", "far"] as const;
export type AngleMode = (typeof ANGLE_MODES)[number];

/** Never more than this; fewer is normal. */
export const MOST = 3;

/** Ranked ideas kept beyond those shown: two presses of "More", each written out like the first three. */
export const SPARES = 6;

/**
 * The most one press may cost cold. The store goes in whole up to this or
 * to the model's context, whichever is smaller; past it, notes are chosen
 * for the seed. $0.50 is ~660k tokens on the synthesis model — a store of
 * well over two million characters.
 */
const MAX_COLD_USD = 0.5;

/** Room left in the context for the instructions and the reply. */
const CONTEXT_SHARE = 0.8;

/**
 * How long Gemini holds the store after a press: long enough for "More"
 * and the other two modes, short enough that storage stays under a cent.
 */
export const CACHE_TTL_SECONDS = 15 * 60;

/** Below this a cache saves less than it costs to set up; Gemini also refuses tiny ones. */
const MIN_CACHE_TOKENS = 4096;

/** Kept and dismissed angles shown as taste, each. */
const EXAMPLES = 10;

/** How a kept angle becomes a link. Null: no link type fits, so none is written. */
export const ANGLE_LINK: Record<AngleType, LinkType | null> = {
  contradiction: "contradicts",
  // The later note returns to the earlier subject with a new position.
  "change-of-mind": "revisits",
  // The later note returns to the same unsettled question.
  "open-question": "revisits",
  // Notes on unrelated subjects are none of the five: not the same event, not
  // a return to a subject. Flagged, not forced; a type for it is a later call.
  "cross-domain": null,
};

export interface StoreNote {
  id: string;
  label: string;
  path: string;
  recordedAt: string;
  text: string;
  workStatus: "draft" | "done" | "published";
  publishedWhere: string | null;
  publishedOn: string | null;
  /** The published note that replaces this one: background only (`lib/note/publish.ts`). */
  supersededBy?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/** Every note the call may read: processed, on a shelf the AI reads, not a report. */
export async function loadStore(admin: Admin, userId: string): Promise<StoreNote[]> {
  const { data } = await admin
    .from("recordings")
    .select("id, label, path, recorded_at, body_md, transcript, analysis, work_status, published_where, published_on, superseded_by")
    .eq("user_id", userId)
    .eq("status", "done")
    .in("shelf", READ)
    // Refused by Google once, refused again: one such note would sink the
    // whole call.
    .eq("ai_declined", false)
    // A weekly report is written back as a note; an angle drawn from one is
    // the app quoting itself.
    .eq("report", false)
    .order("recorded_at", { ascending: true });

  return (data || []).flatMap((n) => {
    const path = n.path || "";
    const text = noteText(n);
    if (!text) return [];
    return [
      {
        id: n.id,
        label: noteName(path, n.label || "").replace(/\.md$/, ""),
        path,
        recordedAt: n.recorded_at,
        text,
        workStatus: n.work_status || "draft",
        publishedWhere: n.published_where ?? null,
        publishedOn: n.published_on ?? null,
        supersededBy: n.superseded_by ?? null,
      },
    ];
  });
}

/** How many characters of notes one call may carry on this model. */
export function storeBudgetChars(model: TextModel = MODEL): number {
  const affordable = (MAX_COLD_USD / tokenCost(model, 1_000_000, 0)) * 1_000_000;
  return Math.floor(Math.min(contextTokens(model) * CONTEXT_SHARE, affordable) * 4);
}

export function renderNote(n: StoreNote): string {
  return `[${n.id}] ${n.label} (recorded ${n.recordedAt.slice(0, 10)})\n${n.text}`;
}

/**
 * What is close to the seed for free: the notes it is linked to (any link
 * not turned down) and its nearest neighbours by meaning, passage by passage.
 */
export async function seedNeighbours(admin: Admin, userId: string, seedId: string) {
  const { data: links } = await admin
    .from("note_links")
    .select("from_recording, to_recording")
    .eq("user_id", userId)
    .or(`from_recording.eq.${seedId},to_recording.eq.${seedId}`)
    .neq("confirmed", false);
  const linked: string[] = (links || []).map((l) => (l.from_recording === seedId ? l.to_recording : l.from_recording));
  const near = (await nearestByVector(admin, userId, seedId, { floor: 0.3, limit: 60 })).map((n) => n.id);
  return { linked, near };
}

/**
 * The notes sent when the whole store does not fit: whole notes, never
 * snippets, in this order — the seed, what it is linked to, then its nearest
 * neighbours by meaning taken turn about with the oldest notes that are not
 * near it, so the model still has something distant to bridge to.
 */
async function chooseForSeed(admin: Admin, userId: string, seed: StoreNote, store: StoreNote[], budget: number) {
  const byId = new Map(store.map((n) => [n.id, n]));
  const { linked, near } = await seedNeighbours(admin, userId, seed.id);
  const nearSet = new Set(near);
  const distant = store.filter((n) => !nearSet.has(n.id)).map((n) => n.id);

  const order = [seed.id, ...linked];
  for (let i = 0; i < Math.max(near.length, distant.length); i++) {
    if (near[i]) order.push(near[i]);
    if (distant[i]) order.push(distant[i]);
  }

  const chosen = new Set<string>();
  let size = 0;
  for (const id of order) {
    const note = byId.get(id);
    if (!note || chosen.has(id)) continue;
    const length = renderNote(note).length;
    if (size + length > budget) continue;
    size += length;
    chosen.add(id);
  }
  return store.filter((n) => chosen.has(n.id));
}

export interface ShownAngle {
  claim: string;
  angle_type: string;
  status: string;
  claim_hv: string | number[] | null;
}

/** A stored halfvec comes back as its text form. */
export function vectorOf(value: string | number[] | null): number[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export const MODE_TASK: Record<AngleMode, string> = {
  challenge:
    "CHALLENGE the seed. Find where it is in tension with the rest of the store: a note that states the opposite, an earlier or later note where the writer thought otherwise, evidence elsewhere that the seed's position does not survive.",
  continue:
    "CONTINUE the seed. Find where its line of thought leads that the writer has not yet written: a later note that moved it on or reversed it, a question it leaves open that other notes keep circling, a tension it creates with what the writer said before.",
  far:
    "Go FAR from the seed. Find a note on an unrelated subject — different folder, different time, different vocabulary — that shares a mechanism, a tension or an unanswered question with it, so that putting the two together says something neither says alone.",
};

/** The instructions, the seed and what not to repeat: everything but the store. */
export function anglePrompt(input: { seed: StoreNote; mode: AngleMode } & AngleContext): string {
  return `Above is everything one person has written or said into their notes, oldest first. Each note starts with its id in square brackets.

The SEED is [${input.seed.id}] ${input.seed.label}.

Your job: at most ${MOST} ANGLES from the seed — ideas for a new piece of work (an essay, a post, a decision, a project) that this person could make out of their own notes. ${MODE_TASK[input.mode]}

${angleRules(input, MOST)}`;
}

/** What every angle prompt is told besides its notes and its task. */
export interface AngleContext {
  more: boolean;
  finished: StoreNote[];
  shown: { claim: string; type: string }[];
  kept: { claim: string; type: string }[];
  dismissed: { claim: string; type: string }[];
  lang: Lang;
}

/** What an angle is, what was already said, and the reply's shape: the part of the prompt every caller shares. */
export function angleRules(input: AngleContext, most: number): string {
  const line = (a: { claim: string; type: string }) => `- (${a.type}) ${a.claim}`;
  const finished = input.finished.map(
    (n) =>
      `- [${n.id}] ${n.label} (${n.workStatus}${n.publishedOn ? ` ${n.publishedOn}` : ""}${n.publishedWhere ? `, ${n.publishedWhere}` : ""})`
  );

  return `An angle comes from TENSION, never from likeness. Exactly one of:
- "contradiction": two notes state things that cannot both hold.
- "change-of-mind": the writer held one position and later another. Cite the earlier and the later.
- "cross-domain": the same mechanism, pattern or problem turns up in notes on unrelated subjects.
- "open-question": a question the writer keeps returning to across notes without settling it.
Two notes on the same topic that agree are NOT an angle. A summary of the seed is NOT an angle.

Every angle rests on at least two different notes, one of them normally the seed. For each note, copy ONE sentence from it exactly as written — character for character, no paraphrase, no "...", no joining two sentences. An angle whose quote is not in the note is thrown away.

New means new relative to what this person has already said: everything under ALREADY SAID is finished work or ideas they have already been shown. An angle that restates one of them, in any wording, is worthless. Coming back to a core topic of theirs is fine when the angle itself is new.

Their taste: the KEPT angles below are the kind they found worth pursuing; the DISMISSED ones they did not. Lean towards the first and away from the second.

Return fewer than ${most} rather than pad; an empty list when nothing genuinely holds.${
    input.more ? "\n\nThey have seen the angles under ALREADY SAID and asked for more: go past them, not around them." : ""
  }

Write each "claim" in ${LANGUAGE_NAMES[input.lang]}: one line, at most 25 words, naming the tension and the piece of work it could become. Quotes stay in the note's own language.

Return JSON only:
{"angles": [{"type": one of the four, "claim": "...", "notes": [{"id": "<id from the square brackets>", "quote": "<one sentence copied from that note>"}]}]}

ALREADY SAID — finished notes:
${finished.join("\n") || "(none)"}

ALREADY SAID — angles already shown for this seed:
${input.shown.map(line).join("\n") || "(none)"}

KEPT:
${input.kept.map(line).join("\n") || "(none yet)"}

DISMISSED:
${input.dismissed.map(line).join("\n") || "(none yet)"}`;
}

/** One angle as the model must return it; anything else is dropped, not guessed at. */
export const AngleReply = z.object({
  type: z.enum(ANGLE_TYPES),
  claim: z.string().trim().min(1).max(400),
  notes: z.array(z.object({ id: z.string().min(1), quote: z.string().min(1) })).min(1).max(6),
});

/** The reply: a list, read angle by angle, so one malformed entry costs only itself. */
export function readAngles(reply: string, most = MOST): { angles: DraftAngle[]; unreadable: number } {
  const whole = readJson(reply, z.object({ angles: z.array(z.unknown()) }));
  if (!whole) return { angles: [], unreadable: 1 };
  let unreadable = 0;
  const angles = whole.angles.flatMap((raw) => {
    const one = AngleReply.safeParse(raw);
    if (!one.success) {
      unreadable++;
      return [];
    }
    return [{ type: one.data.type, claim: one.data.claim, cites: one.data.notes }];
  });
  return { angles: angles.slice(0, most), unreadable };
}

/** The best chunk-to-chunk likeness between each pair of the given notes. */
export async function likeness(admin: Admin, userId: string, ids: string[]) {
  const { data } = await admin
    .from("note_chunks")
    .select("recording_id, embedding_hv")
    .eq("user_id", userId)
    .in("recording_id", ids)
    .not("embedding_hv", "is", null);

  const chunks = new Map<string, number[][]>();
  for (const row of data || []) {
    const v = vectorOf(row.embedding_hv);
    if (v) chunks.set(row.recording_id, [...(chunks.get(row.recording_id) || []), v]);
  }
  return (a: string, b: string) => {
    let best = 0;
    for (const x of chunks.get(a) || []) for (const y of chunks.get(b) || []) best = Math.max(best, cosine(x, y));
    return best;
  };
}

export interface ShownCite {
  id: string;
  quote: string;
  title: string;
  path: string;
  recordedAt: string;
}

export interface Angle {
  id: string;
  seedId: string;
  mode: AngleMode;
  type: AngleType;
  claim: string;
  /** The idea written out (`angle-brief.ts`); null when it has only its claim. */
  brief: string | null;
  cites: ShownCite[];
  status: "shown" | "kept" | "dismissed";
  createdAt: string;
}

export interface AngleRun {
  angles: Angle[];
  dropped: { claim: string; reason: string }[];
  usage: Usage;
  /** How much of the store went in: all of it, or notes chosen for the seed. */
  sent: { notes: number; of: number; chars: number; whole: boolean };
}

/**
 * One press: the call, the filter, and the survivors saved as shown.
 * Throws when the seed is not a note the call may read.
 */
export async function findAngles(
  admin: Admin,
  userId: string,
  input: { seedId: string; mode: AngleMode; more?: boolean; lang: Lang },
  ctx: CostContext
): Promise<AngleRun> {
  const store = await loadStore(admin, userId);
  const seed = store.find((n) => n.id === input.seedId);
  if (!seed) throw new Error("Seed note not found");

  // Sized for the model the tier runs on today: /admin may have put it on Pro.
  const budget = storeBudgetChars(resolveModel(MODEL, await getAppSettings()));
  const total = store.reduce((sum, n) => sum + renderNote(n).length, 0);
  const sent = total <= budget ? store : await chooseForSeed(admin, userId, seed, store, budget);
  const storeText = sent.map(renderNote).join("\n\n");

  const { forSeed, kept, dismissed } = await loadTaste(admin, userId, seed.id);
  const finished = store.filter((n) => n.workStatus !== "draft");
  const prompt = anglePrompt({
    seed,
    mode: input.mode,
    more: Boolean(input.more),
    finished,
    shown: forSeed.map((a) => ({ claim: a.claim, type: a.angle_type })),
    kept,
    dismissed,
    lang: input.lang,
  });

  const cacheable = storeText.length / 4 >= MIN_CACHE_TOKENS;
  const { text, usage } = await generateWithUsage({
    model: MODEL,
    operation: "angles",
    ctx,
    json: true,
    ...(cacheable
      ? { cache: { parts: [storeText], ttlSeconds: CACHE_TTL_SECONDS }, parts: [prompt] }
      : { parts: [storeText, "\n\n", prompt] }),
  });

  const { angles: drafts, unreadable } = readAngles(text);
  const dropped: { claim: string; reason: string }[] = [];
  if (unreadable) dropped.push({ claim: "(unreadable)", reason: `${unreadable} angle(s) not in the reply's shape` });

  // Evidence first: free, and it spares an embedding for every angle it drops.
  const notes = new Map<string, FilterNote>(sent.map((n) => [n.id, n]));
  const similar = await likeness(admin, userId, [...new Set(drafts.flatMap((d) => d.cites.map((c) => c.id)))]);
  const sound = drafts.filter((d) => {
    const fault = evidenceFault(d, notes, similar);
    if (fault) dropped.push({ claim: d.claim, reason: fault });
    return !fault;
  });

  const fresh = await newOnly(admin, userId, { sound, finished, forSeed }, ctx, dropped);
  const angles = await saveAngles(admin, userId, { seed, mode: input.mode, store }, fresh.slice(0, MOST), []);

  return {
    angles,
    dropped,
    usage,
    sent: { notes: sent.length, of: store.length, chars: storeText.length, whole: sent.length === store.length },
  };
}

/**
 * The seed's angles already shown, with their vectors — what a new claim is
 * compared against — and the latest kept and dismissed anywhere, as taste,
 * which needs their words and nothing else.
 */
export async function loadTaste(admin: Admin, userId: string, seedId: string) {
  const { data: past } = await admin
    .from("note_angles")
    .select("claim, angle_type, status, claim_hv")
    .eq("user_id", userId)
    .eq("seed_id", seedId)
    // A spare was never seen: it is not "already said".
    .neq("status", "spare")
    .order("created_at", { ascending: true });
  const taste = async (status: "kept" | "dismissed") => {
    const { data } = await admin
      .from("note_angles")
      .select("claim, angle_type")
      .eq("user_id", userId)
      .eq("status", status)
      .order("decided_at", { ascending: false })
      .limit(EXAMPLES);
    return (data || []).map((a) => ({ claim: a.claim as string, type: a.angle_type as string }));
  };
  return { forSeed: (past || []) as ShownAngle[], kept: await taste("kept"), dismissed: await taste("dismissed") };
}

/** An angle that may be shown, with its claim's vector and, once written, its brief. */
export interface FreshAngle {
  draft: DraftAngle;
  vector: number[];
  brief?: string | null;
}

/**
 * Angles whose evidence held, every one checked for repetition — against
 * finished notes, every angle already shown and each other — in the order
 * given. An idea two readers both offer survives once, as the earlier.
 * Drops go into `dropped` and the log.
 */
export async function newOnly(
  admin: Admin,
  userId: string,
  input: { sound: DraftAngle[]; finished: StoreNote[]; forSeed: ShownAngle[] },
  ctx: CostContext,
  dropped: { claim: string; reason: string }[]
): Promise<FreshAngle[]> {
  const { sound, finished, forSeed } = input;
  const vectors = await embedQueries(sound.map((d) => d.claim), ctx, "angles");
  const finishedIds = new Set(finished.map((n) => n.id));
  const said = await Promise.all(
    sound.map(async (_, i) => {
      if (finishedIds.size === 0) return 0;
      const { data: hits } = await admin.rpc("match_note_chunks_hv", {
        query_embedding: vectors[i],
        match_user_id: userId,
        match_count: 20,
        min_similarity: 0.5,
      });
      let best = 0;
      for (const hit of (hits || []) as { recording_id: string; similarity: number }[]) {
        if (finishedIds.has(hit.recording_id)) best = Math.max(best, hit.similarity);
      }
      return best;
    })
  );

  const before = forSeed.map((a) => vectorOf(a.claim_hv)).filter((v): v is number[] => v !== null);
  const fresh: FreshAngle[] = [];
  for (let i = 0; i < sound.length; i++) {
    const fault = echoFault(vectors[i], [...before, ...fresh.map((k) => k.vector)], said[i]);
    if (fault) dropped.push({ claim: sound[i].claim, reason: fault });
    else fresh.push({ draft: sound[i], vector: vectors[i] });
  }

  // Never shown, only logged: the thresholds are tuned from these lines.
  for (const d of dropped) console.info(`Angle dropped (${d.reason}): ${d.claim}`);
  return fresh;
}

/**
 * Saves `shown` as shown, best first, and `spare` — what the press ranked
 * below them — for "More" to show later without another paid read
 * (`showSpare()`). A press replaces the spares its seed and mode had. A
 * spare that cannot be saved (`supabase/051` not run) costs only itself,
 * and so does a brief (`supabase/052`): it is written onto its row after
 * the row is saved, so a missing column never costs the angle.
 */
export async function saveAngles(
  admin: Admin,
  userId: string,
  input: { seed: StoreNote; mode: AngleMode; store: StoreNote[] },
  shown: FreshAngle[],
  spare: FreshAngle[]
): Promise<Angle[]> {
  const { seed, mode, store } = input;
  const now = Date.now();
  const row = ({ draft, vector }: FreshAngle) => ({
    user_id: userId,
    seed_id: seed.id,
    mode,
    angle_type: draft.type,
    claim: draft.claim,
    cites: draft.cites,
    claim_hv: vector,
  });

  const angles: Angle[] = [];
  if (shown.length > 0) {
    const { data: rows } = await admin
      .from("note_angles")
      // The list is read newest first: the best gets the latest moment.
      .insert(shown.map((a, i) => ({ ...row(a), created_at: new Date(now - i).toISOString() })))
      .select("id, seed_id, mode, angle_type, claim, cites, status, created_at");
    const saved = (rows || []) as AngleRow[];
    await saveBriefs(saved, shown);
    angles.push(...withNotes(saved.map((r, i) => ({ ...r, brief: shown[i]?.brief ?? null })), new Map(store.map((n) => [n.id, n]))));
  }

  if (spare.length > 0) {
    await admin.from("note_angles").delete().eq("user_id", userId).eq("seed_id", seed.id).eq("mode", mode).eq("status", "spare");
    const { data: kept, error } = await admin
      .from("note_angles")
      .insert(spare.map((a, i) => ({ ...row(a), status: "spare", rank: i })))
      .select("id");
    if (error) console.error("Spare angles not kept:", error);
    else await saveBriefs((kept || []) as { id: string }[], spare);
  }
  return angles;

  /** Rows come back in the order they were sent, so the nth row is the nth angle. */
  async function saveBriefs(rows: { id: string }[], from: FreshAngle[]) {
    for (const [i, r] of rows.entries()) {
      const brief = from[i]?.brief;
      if (!brief) continue;
      const { error } = await admin.from("note_angles").update({ brief }).eq("user_id", userId).eq("id", r.id);
      if (error) console.error("Angle brief not saved:", error);
    }
  }
}

/**
 * "More" without a model: the seed's best spares in this mode become shown,
 * up to three. A spare that now rewords an angle shown, kept or dismissed
 * since is deleted instead. Returns how many were shown; 0 means a press
 * has to read again.
 */
export async function showSpare(admin: Admin, userId: string, seedId: string, mode: AngleMode): Promise<number> {
  const { data: spares } = await admin
    .from("note_angles")
    .select("id, claim_hv")
    .eq("user_id", userId)
    .eq("seed_id", seedId)
    .eq("mode", mode)
    .eq("status", "spare")
    .order("rank", { ascending: true });
  if (!spares || spares.length === 0) return 0;

  const { data: seen } = await admin
    .from("note_angles")
    .select("claim_hv")
    .eq("user_id", userId)
    .eq("seed_id", seedId)
    .neq("status", "spare");
  const before = (seen || []).map((a) => vectorOf(a.claim_hv)).filter((v): v is number[] => v !== null);

  const show: string[] = [];
  const stale: string[] = [];
  for (const s of spares as { id: string; claim_hv: string | number[] | null }[]) {
    if (show.length >= MOST) break;
    const vector = vectorOf(s.claim_hv);
    if (vector && echoFault(vector, before, 0)) {
      stale.push(s.id);
      continue;
    }
    show.push(s.id);
    if (vector) before.push(vector);
  }

  if (stale.length > 0) await admin.from("note_angles").delete().eq("user_id", userId).in("id", stale);
  const now = Date.now();
  for (const [i, id] of show.entries()) {
    await admin
      .from("note_angles")
      .update({ status: "shown", created_at: new Date(now - i).toISOString() })
      .eq("user_id", userId)
      .eq("id", id);
  }
  return show.length;
}

export interface AngleRow {
  id: string;
  seed_id: string;
  mode: AngleMode;
  angle_type: AngleType;
  claim: string;
  cites: { id: string; quote: string }[];
  status: Angle["status"];
  created_at: string;
  brief?: string | null;
}

/** Rows as the screen shows them: each cited note with its title and date. */
export function withNotes(
  rows: AngleRow[],
  notes: Map<string, { label: string; path: string; recordedAt: string }>
): Angle[] {
  return rows.map((r) => ({
    id: r.id,
    seedId: r.seed_id,
    mode: r.mode,
    type: r.angle_type,
    claim: r.claim,
    brief: r.brief ?? null,
    status: r.status,
    createdAt: r.created_at,
    cites: (r.cites || []).flatMap((c) => {
      const n = notes.get(c.id);
      return n ? [{ id: c.id, quote: c.quote, title: n.label, path: n.path, recordedAt: n.recordedAt }] : [];
    }),
  }));
}

/**
 * The links a kept angle stands for: each cited note to the one before it
 * in time, later → earlier as every link is, confirmed because the user
 * kept it. None when no link type fits the angle.
 */
export function linksForAngle(
  angle: { type: AngleType; claim: string; cites: { id: string }[] },
  recordedAt: Map<string, string>
): { from: string; to: string; type: LinkType; reason: string }[] {
  const type = ANGLE_LINK[angle.type];
  if (!type) return [];
  const ids = [...new Set(angle.cites.map((c) => c.id))]
    .filter((id) => recordedAt.has(id))
    .sort((a, b) => recordedAt.get(a)!.localeCompare(recordedAt.get(b)!));
  return ids.slice(1).map((id, i) => ({ from: id, to: ids[i], type, reason: angle.claim }));
}

/**
 * Keep or dismiss. A kept angle writes its links (confirmed, full
 * confidence); `unlinked` names an angle type that has none.
 */
export async function decideAngle(
  admin: Admin,
  userId: string,
  angleId: string,
  status: "kept" | "dismissed"
): Promise<{ linked: number; unlinked: AngleType | null } | null> {
  const { data: angle } = await admin
    .from("note_angles")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("id", angleId)
    .eq("user_id", userId)
    .select("angle_type, claim, cites")
    .maybeSingle();
  if (!angle) return null;
  if (status !== "kept") return { linked: 0, unlinked: null };

  const cites = (angle.cites || []) as { id: string }[];
  const { data: notes } = await admin
    .from("recordings")
    .select("id, recorded_at")
    .eq("user_id", userId)
    .in("id", cites.map((c) => c.id));
  const links = linksForAngle(
    { type: angle.angle_type, claim: angle.claim, cites },
    new Map((notes || []).map((n) => [n.id as string, n.recorded_at as string]))
  );
  if (links.length > 0) {
    const { error } = await admin.from("note_links").upsert(
      links.map((l) => ({
        user_id: userId,
        from_recording: l.from,
        to_recording: l.to,
        link_type: l.type,
        confidence: 1,
        confirmed: true,
        reason: l.reason,
      })),
      { onConflict: "from_recording,to_recording,link_type" }
    );
    if (error) console.error("Links from a kept angle not written:", error);
  }
  return { linked: links.length, unlinked: ANGLE_LINK[angle.angle_type as AngleType] ? null : angle.angle_type };
}
