// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What is not the author's own and real, as the Brain reads it. A note filed
 * in passages (`passages.ts`) knows which of its passages are a story, a
 * quote, someone else's story retold, or the author's take on an idea from
 * elsewhere; whenever its text, whole or cut, is handed to a model reading
 * the store, each such part is wrapped in its own marker naming the note it
 * comes from, so a story's economics can be an idea and never a fact, and a
 * quote stays someone else's words. A reader may also leave some parts out
 * (`keep`): an essay never reads the stories. A fiction passage no longer
 * found in the text (the note was edited since it was filed) marks the
 * whole note as holding fiction, parts unknown; any other lost is unmarked.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/** A part that is not the author's own and real: a story, or someone else's words. A story quoting someone is the story's. */
export type Other = "fiction" | "quote" | "borrowed" | "inspired";

export interface Fiction {
  /** The note's name, said in each marker. */
  title: string;
  /** Where each part sits in the note's text and what it is, in order, never touching one of its own kind. */
  ranges: [number, number, Other][];
  /** A fiction passage not found in the text: the whole note is said to hold fiction. */
  lost: boolean;
  /** Which parts a reader reads, null being the author's own and real; unset, all of them. */
  keep?: (as: Other | null) => boolean;
}

export const FICTION_OPEN = (title: string) => `⟦FICTION from “${title}”: invented by the author, not fact⟧`;
export const FICTION_CLOSE = "⟦end of fiction⟧";
export const FICTION_SOMEWHERE = (title: string) =>
  `⟦This note holds fiction (“${title}”), parts unknown: treat nothing in it as fact unless it plainly is.⟧`;

/** Each part's markers, worded from the rules the story bank's tags carried. */
export const MARKERS: Record<Other, { open: (title: string) => string; close: string }> = {
  fiction: { open: FICTION_OPEN, close: FICTION_CLOSE },
  quote: {
    open: (title) => `⟦QUOTE in “${title}”: someone's exact words, with who said them; quoted word for word and credited, never reworded⟧`,
    close: "⟦end of quote⟧",
  },
  borrowed: {
    open: (title) => `⟦RETOLD in “${title}”: someone else's true story, with where it came from; told as theirs, saying where it came from, never as the author's⟧`,
    close: "⟦end of retold⟧",
  },
  inspired: {
    open: (title) => `⟦TAKE in “${title}”: the author arguing from an idea from elsewhere; the idea used in the author's own words, never quoted or credited⟧`,
    close: "⟦end of take⟧",
  },
};

/** Where a part was left out by a reader that does not read it. */
export const LEFT_OUT = "[…]";

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `passage` sits in `text` at or after `from`, any run of white space matching any other. */
function locate(text: string, passage: string, from: number): [number, number] | null {
  const words = passage.trim().split(/\s+/).filter(Boolean).map(escape);
  if (words.length === 0) return null;
  const found = new RegExp(words.join("\\s+"), "g");
  found.lastIndex = from;
  const hit = found.exec(text);
  return hit ? [hit.index, hit.index + hit[0].length] : null;
}

/** What a passage is, by its labels; null when it is the author's own and real. */
export function otherOf(p: { truth: string; words: string }): Other | null {
  if (p.truth === "fiction") return "fiction";
  return p.words === "quote" || p.words === "borrowed" || p.words === "inspired" ? p.words : null;
}

/**
 * A note's parts found in its text: its passages that are not its own and
 * real, in the order they were filed, each looked for after the last;
 * neighbours of one kind with only white space between are one. Null when
 * it has none.
 */
export function fictionIn(text: string, passages: { text: string; as: Other }[], title: string): Fiction | null {
  if (passages.length === 0) return null;
  const ranges: [number, number, Other][] = [];
  let lost = false;
  let at = 0;
  for (const passage of passages) {
    const range = locate(text, passage.text, at);
    if (!range) {
      if (passage.as === "fiction") lost = true;
      continue;
    }
    const last = ranges.at(-1);
    if (last && last[2] === passage.as && !text.slice(last[1], range[0]).trim()) last[1] = range[1];
    else ranges.push([range[0], range[1], passage.as]);
    at = range[1];
  }
  return { title, ranges, lost };
}

/**
 * The part of a note's text from `start` to `end`, white space trimmed, as a
 * model reading the store gets it: each part not the author's own and real
 * wrapped in its markers, a part cut at either end wrapped all the same; a
 * part its reader does not read (`keep`) left out, said once where it was.
 * With `lost`, one line above it says the note holds fiction.
 */
export function marked(text: string, fiction: Fiction | null | undefined, start = 0, end = text.length): string {
  const lead = text.slice(start, end).search(/\S/);
  if (lead < 0) return "";
  const from = start + lead;
  const to = from + text.slice(from, end).trimEnd().length;
  if (!fiction) return text.slice(from, to);
  const keep = fiction.keep ?? (() => true);
  const parts: { s: number; e: number; as: Other | null }[] = [];
  let at = from;
  for (const [a, b, as] of fiction.ranges) {
    const s = Math.max(a, from);
    const e = Math.min(b, to);
    if (s >= e) continue;
    if (s > at) parts.push({ s: at, e: s, as: null });
    parts.push({ s, e, as });
    at = e;
  }
  if (to > at) parts.push({ s: at, e: to, as: null });
  let out = "";
  let gap = false;
  for (const { s, e, as } of parts) {
    const words = text.slice(s, e);
    if (!words.trim()) {
      if (keep(null)) out += words;
      continue;
    }
    if (!keep(as)) {
      if (!gap) out = `${out.trimEnd()}${out.trim() ? " " : ""}${LEFT_OUT} `;
      gap = true;
      continue;
    }
    out += as ? `${MARKERS[as].open(fiction.title)} ${words.trim()} ${MARKERS[as].close}` : gap ? words.trimStart() : words;
    gap = false;
  }
  out = out.trim();
  if (out === LEFT_OUT) out = "";
  return fiction.lost && out ? `${FICTION_SOMEWHERE(fiction.title)}\n${out}` : out;
}

/**
 * Whether a sentence quoted from a note (a fact's source) is its fiction: it
 * sits in a piece of fiction, or the note holds fiction and where it, or the
 * sentence, sits is not known.
 */
export function inFiction(text: string, fiction: Fiction | null | undefined, quote: string | null | undefined): boolean {
  const story = fiction?.ranges.filter((r) => r[2] === "fiction") ?? [];
  if (!fiction || (!fiction.lost && story.length === 0)) return false;
  const at = quote ? locate(text, quote, 0) : null;
  if (fiction.lost || !at) return true;
  return story.some(([a, b]) => at[0] < b && at[1] > a);
}

/** Whether a note holds fiction: a story found in it, or one no longer found. */
export const holdsFiction = (fiction: Fiction | null | undefined) => Boolean(fiction && (fiction.lost || fiction.ranges.some((r) => r[2] === "fiction")));

/** Rows read a page at a time: a store's fiction is never cut short at the database's page. */
const PAGE = 1000;

/**
 * The parts not their own and real in each of these notes, by id, found in
 * the text given for it. Every such passage the person has is read, so none
 * is missed however many notes are asked about.
 */
export async function loadFiction(admin: Admin, userId: string, notes: { id: string; title: string; text: string }[]): Promise<Map<string, Fiction>> {
  const wanted = new Map(notes.map((n) => [n.id, n]));
  const byNote = new Map<string, { text: string; as: Other }[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("passages")
      .select("recording_id, position, text, truth, words")
      .eq("user_id", userId)
      .or("truth.eq.fiction,words.neq.mine")
      .order("recording_id")
      .order("position")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as { recording_id: string; text: string; truth: string; words: string }[];
    for (const row of rows) {
      const as = otherOf(row);
      if (as && wanted.has(row.recording_id)) byNote.set(row.recording_id, [...(byNote.get(row.recording_id) ?? []), { text: row.text, as }]);
    }
    if (rows.length < PAGE) break;
  }
  const out = new Map<string, Fiction>();
  for (const [id, passages] of byNote) {
    const note = wanted.get(id)!;
    const found = fictionIn(note.text, passages, note.title);
    if (found) out.set(id, found);
  }
  return out;
}
