// [Librarian, Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostContext } from "@/lib/ai/cost";
import { type Chunk, noteSections } from "@/lib/note/chunk";
import { embedQuery } from "@/lib/note/embed";
import type { StoreNote } from "@/lib/note/angles";
import { renderStore } from "@/lib/note/render-store";

/**
 * Which notes one subject's reading reads. A store under budget goes whole;
 * above it, the notes closest to the subject and least like each other
 * (maximal marginal relevance, as LangChain's
 * `max_marginal_relevance_search`), newer weighing more. Chosen notes go
 * whole, never summarised — except one too big to, which sends the passages
 * nearest the subject, cut from its own text.
 *
 * `selectNotes()` is pure: the vectors come in, so the live test holds them
 * in memory; `selectForSubject()` reads them from pgvector for the app.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/** The reading aims at this many tokens of notes. */
export const AIM_TOKENS = 100_000;
/** And never passes this much of the aim (150k at the default). */
const CEILING_SHARE = 1.5;
/** How many of the closest chunks MMR chooses among. Starting value, to tune. */
export const FETCH_K = 2000;
/** 1 = closeness alone, 0 = difference alone. Starting value, to tune. */
export const LAMBDA = 0.5;
/** A note this old counts half as close. Starting value, to tune. */
export const HALF_LIFE_DAYS = 365;
/** A note bigger than this share of the aim sends passages, not its whole text. */
const BIG_NOTE_SHARE = 0.2;
/** A section goes whole when more than this share of its chunks is picked (LlamaIndex auto-merging's default). */
const MERGE_RATIO = 0.5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A chunk with its vector, as stored for search. */
export interface StoreChunk extends Chunk {
  noteId: string;
  index: number;
  vector: number[];
}

export interface Picked {
  id: string;
  label: string;
  tokens: number;
  /** The cosine of the subject and the chunk that brought the note in, before age is weighed. */
  closeness?: number;
  /** Absent: sent whole. Otherwise how many passages were cut from it. */
  passages?: number;
}

export interface Selection {
  /** The notes to send, oldest first; an excerpted note carries its passages as its text. */
  notes: StoreNote[];
  /** In the order they were chosen. */
  picked: Picked[];
  /** True when the store was under budget and went whole. */
  whole: boolean;
  tokens: number;
}

/** Counted as `storeBudgetChars()` counts: four characters a token. */
function tokensOf(notes: StoreNote[], tags: Map<string, string[]>): number {
  return Math.ceil(renderStore(notes, tags).text.length / 4);
}

/** Vectors arrive unit length, so this is their cosine. */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/**
 * Maximal marginal relevance: each pick the best mix of close to the subject
 * and unlike what is already picked. `skip` drops a candidate before it is
 * weighed; `take` is told each pick and returns false to stop.
 */
function mmr<T extends { vector: number[] }>(
  candidates: { item: T; closeness: number }[],
  skip: (item: T) => boolean,
  take: (item: T) => boolean
) {
  const likePicked = candidates.map(() => -Infinity);
  const open = new Set(candidates.map((_, i) => i));
  while (open.size > 0) {
    let best = -1;
    let bestScore = -Infinity;
    for (const i of open) {
      if (skip(candidates[i].item)) {
        open.delete(i);
        continue;
      }
      const unlike = likePicked[i] === -Infinity ? 0 : likePicked[i];
      const score = LAMBDA * candidates[i].closeness - (1 - LAMBDA) * unlike;
      if (score > bestScore) [best, bestScore] = [i, score];
    }
    if (best < 0 || !take(candidates[best].item)) return;
    open.delete(best);
    const vector = candidates[best].item.vector;
    for (const i of open) likePicked[i] = Math.max(likePicked[i], dot(candidates[i].item.vector, vector));
  }
}

/**
 * The passages of a big note to send, given which of its chunks were picked.
 * A section goes whole when more than half its units — its own chunks and its
 * subsections — are in, moving up a heading level the same way; any other
 * picked chunk goes with the chunk before and after it. Cut from the note's
 * own text, in its order.
 */
export function excerpt(note: StoreNote, chunks: StoreChunk[], picked: Set<number>): string[] {
  const sections = noteSections(note.text);
  const key = (path: string[]) => JSON.stringify(path);
  // A section's reach includes its subsections: up to the next heading at its level or above.
  const nodes = sections
    .filter((s) => s.path.length > 0)
    .map((s, _, all) => {
      const after = all.find((o) => o.start > s.start && o.path.length <= s.path.length);
      return { path: s.path, start: s.start, end: after ? after.start : note.text.length, merged: false };
    });
  const byPath = new Map(nodes.map((n) => [key(n.path), n]));

  // Deepest first, so a merged subsection counts toward its parent.
  for (const node of [...nodes].sort((a, b) => b.path.length - a.path.length)) {
    const own = chunks.filter((c) => key(c.headings) === key(node.path));
    const subsections = nodes.filter((n) => n.path.length === node.path.length + 1 && key(n.path.slice(0, -1)) === key(node.path));
    const units = own.length + subsections.length;
    const inside = own.filter((c) => picked.has(c.index)).length + subsections.filter((n) => n.merged).length;
    node.merged = units > 0 && inside / units > MERGE_RATIO;
  }
  // Only the outermost merged sections: a merged parent already holds its subsections.
  const merged = nodes.filter((n) => n.merged && !byPath.get(key(n.path.slice(0, -1)))?.merged);

  const spans: [number, number][] = merged.map((n) => [n.start, n.end]);
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  ordered.forEach((chunk, i) => {
    if (!picked.has(chunk.index) || merged.some((n) => chunk.start >= n.start && chunk.end <= n.end)) return;
    const from = ordered[Math.max(0, i - 1)];
    const to = ordered[Math.min(ordered.length - 1, i + 1)];
    spans.push([from.start, to.end]);
  });

  // Overlapping or touching spans become one passage.
  const joined: [number, number][] = [];
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    const last = joined[joined.length - 1];
    if (last && !note.text.slice(last[1], start).trim()) last[1] = Math.max(last[1], end);
    else joined.push([start, end]);
  }
  return joined.map(([start, end]) => note.text.slice(start, end).trim()).filter(Boolean);
}

/** A big note's passages, marked so the reading knows it holds only part of the note. */
function excerptNote(note: StoreNote, passages: string[]): StoreNote {
  return { ...note, text: `(Excerpts from this note, in its order.)\n\n${passages.join("\n\n[…]\n\n")}` };
}

/** A big note's passages nearest the subject, by MMR inside its chunks, until its share is filled. */
function cutToShare(note: StoreNote, chunks: StoreChunk[], subject: number[], tags: Map<string, string[]>, share: number) {
  const picked = new Set<number>();
  let best: StoreNote | null = null;
  let passages = 0;
  mmr(
    chunks.map((item) => ({ item, closeness: dot(subject, item.vector) })),
    () => false,
    (chunk) => {
      picked.add(chunk.index);
      const cut = excerpt(note, chunks, picked);
      const candidate = excerptNote(note, cut);
      if (tokensOf([candidate], tags) > share) {
        picked.delete(chunk.index);
        return false;
      }
      [best, passages] = [candidate, cut.length];
      return true;
    }
  );
  return best ? { note: best as StoreNote, passages } : null;
}

/** The notes one subject's reading reads, and why. */
export function selectNotes(opts: {
  store: StoreNote[];
  tags: Map<string, string[]>;
  chunks: StoreChunk[];
  subject: number[];
  aimTokens?: number;
  now?: number;
}): Selection {
  const { store, tags, chunks, subject } = opts;
  const aim = opts.aimTokens ?? AIM_TOKENS;
  const ceiling = aim * CEILING_SHARE;
  const now = opts.now ?? Date.now();

  const total = tokensOf(store, tags);
  if (total <= aim) {
    return { notes: store, whole: true, tokens: total, picked: store.map((n) => ({ id: n.id, label: n.label, tokens: tokensOf([n], tags) })) };
  }

  const notes = new Map(store.map((n) => [n.id, n]));
  const decay = (note: StoreNote) => Math.pow(0.5, Math.max(0, now - Date.parse(note.recordedAt)) / DAY_MS / HALF_LIFE_DAYS);
  const nearest = chunks
    .filter((c) => notes.has(c.noteId))
    .map((item) => ({ item, raw: dot(subject, item.vector) }))
    .map(({ item, raw }) => ({ item, raw, closeness: raw * decay(notes.get(item.noteId)!) }))
    .sort((a, b) => b.closeness - a.closeness)
    .slice(0, FETCH_K);

  const chosen = new Map<string, StoreNote>();
  const seen = new Set<string>();
  const picked: Picked[] = [];
  let tokens = 0;
  mmr(
    nearest,
    (chunk) => seen.has(chunk.noteId),
    (chunk) => {
      if (tokens >= aim) return false;
      const note = notes.get(chunk.noteId)!;
      seen.add(note.id);
      const share = aim * BIG_NOTE_SHARE;
      const whole = tokensOf([note], tags);
      const cut = whole > share ? cutToShare(note, chunks.filter((c) => c.noteId === note.id), subject, tags, share) : null;
      const sent = cut ? cut.note : note;
      const cost = cut ? tokensOf([sent], tags) : whole;
      // A big note none of whose passages fits its share is passed over.
      if (whole > share && !cut) return true;
      // Stop at the first note that would pass the ceiling, rather than hunt
      // for smaller ones further from the subject.
      if (tokens + cost > ceiling) return false;
      chosen.set(note.id, sent);
      const closeness = Math.round(nearest.find((c) => c.item === chunk)!.raw * 1000) / 1000;
      picked.push({ id: note.id, label: note.label, tokens: cost, closeness, ...(cut ? { passages: cut.passages } : {}) });
      tokens += cost;
      return true;
    }
  );

  const sent = store.filter((n) => chosen.has(n.id)).map((n) => chosen.get(n.id)!);
  return { notes: sent, picked, whole: false, tokens: tokensOf(sent, tags) };
}

type ChunkRow = { recording_id: string; chunk_index: number; headings: string[]; span_start: number; span_end: number; embedding: string };

const chunkOf = (row: ChunkRow): StoreChunk => ({
  noteId: row.recording_id,
  index: row.chunk_index,
  headings: row.headings,
  start: row.span_start,
  end: row.span_end,
  content: "",
  vector: JSON.parse(row.embedding),
});

/**
 * The notes a subject's reading reads, from the chunks as indexed (`058`). A
 * store under budget goes whole with no call at all; above it, the subject is
 * embedded once, the nearest chunks read, and every chunk of each note too big
 * to go whole, so its passages are chosen among all of its own.
 */
export async function selectForSubject(admin: Admin, userId: string, subject: string, store: StoreNote[], tags: Map<string, string[]>, ctx: CostContext): Promise<Selection> {
  if (tokensOf(store, tags) <= AIM_TOKENS) return selectNotes({ store, tags, chunks: [], subject: [] });

  const vector = await embedQuery(subject, ctx);
  const { data: near, error } = await admin.rpc("what_next_chunks", { query_embedding: vector, match_user_id: userId, match_count: FETCH_K });
  if (error) throw new Error(`Nearest chunks: ${error.message}`);
  const big = store.filter((n) => tokensOf([n], tags) > AIM_TOKENS * BIG_NOTE_SHARE).map((n) => n.id);
  const { data: whole, error: wholeError } = big.length
    ? await admin.rpc("what_next_note_chunks", { match_user_id: userId, note_ids: big })
    : { data: [], error: null };
  if (wholeError) throw new Error(`Big notes' chunks: ${wholeError.message}`);

  const seen = new Set<string>();
  const chunks = [...((near || []) as ChunkRow[]), ...((whole || []) as ChunkRow[])]
    .filter((row) => !seen.has(`${row.recording_id}:${row.chunk_index}`) && seen.add(`${row.recording_id}:${row.chunk_index}`))
    .map(chunkOf);
  return selectNotes({ store, tags, chunks, subject: vector });
}
