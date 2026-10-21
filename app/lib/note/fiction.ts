// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fiction as the Brain reads it. A note filed in passages (`passages.ts`)
 * knows which of its passages are fiction; whenever its text, whole or cut,
 * is handed to a model reading the store, each fiction part is wrapped in a
 * marker naming the note it comes from, so a story's economics can be an
 * idea and never a fact. A fiction passage no longer found in the text (the
 * note was edited since it was filed) marks the whole note as holding
 * fiction, parts unknown.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface Fiction {
  /** The note's name, said in each marker. */
  title: string;
  /** Where its fiction sits in the note's text, in order, never touching. */
  ranges: [number, number][];
  /** A fiction passage not found in the text: the whole note is said to hold fiction. */
  lost: boolean;
}

export const FICTION_OPEN = (title: string) => `⟦FICTION from “${title}”: invented by the author, not fact⟧`;
export const FICTION_CLOSE = "⟦end of fiction⟧";
export const FICTION_SOMEWHERE = (title: string) =>
  `⟦This note holds fiction (“${title}”), parts unknown: treat nothing in it as fact unless it plainly is.⟧`;

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

/**
 * A note's fiction found in its text: its fiction passages in the order they
 * were filed, each looked for after the last; neighbours with only white
 * space between are one. Null when it has none.
 */
export function fictionIn(text: string, passages: string[], title: string): Fiction | null {
  if (passages.length === 0) return null;
  const ranges: [number, number][] = [];
  let lost = false;
  let at = 0;
  for (const passage of passages) {
    const range = locate(text, passage, at);
    if (!range) {
      lost = true;
      continue;
    }
    const last = ranges.at(-1);
    if (last && !text.slice(last[1], range[0]).trim()) last[1] = range[1];
    else ranges.push(range);
    at = range[1];
  }
  return { title, ranges, lost };
}

/**
 * The part of a note's text from `start` to `end`, white space trimmed, as a
 * model reading the store gets it: each piece of fiction in it wrapped in
 * markers, a piece cut at either end wrapped all the same. With `lost`, one
 * line above it says the note holds fiction.
 */
export function marked(text: string, fiction: Fiction | null | undefined, start = 0, end = text.length): string {
  const lead = text.slice(start, end).search(/\S/);
  if (lead < 0) return "";
  const from = start + lead;
  const to = from + text.slice(from, end).trimEnd().length;
  if (!fiction) return text.slice(from, to);
  let out = "";
  let at = from;
  for (const [a, b] of fiction.ranges) {
    const s = Math.max(a, from);
    const e = Math.min(b, to);
    if (s >= e) continue;
    out += `${text.slice(at, s)}${FICTION_OPEN(fiction.title)} ${text.slice(s, e).trim()} ${FICTION_CLOSE}`;
    at = e;
  }
  out += text.slice(at, to);
  return fiction.lost ? `${FICTION_SOMEWHERE(fiction.title)}\n${out}` : out;
}

/**
 * Whether a sentence quoted from a note (a fact's source) is its fiction: it
 * sits in a piece of fiction, or the note holds fiction and where it, or the
 * sentence, sits is not known.
 */
export function inFiction(text: string, fiction: Fiction | null | undefined, quote: string | null | undefined): boolean {
  if (!fiction) return false;
  const at = quote ? locate(text, quote, 0) : null;
  if (fiction.lost || !at) return true;
  return fiction.ranges.some(([a, b]) => at[0] < b && at[1] > a);
}

/** Rows read a page at a time: a store's fiction is never cut short at the database's page. */
const PAGE = 1000;

/**
 * The fiction in each of these notes, by id, found in the text given for
 * it. Every fiction passage the person has is read, so none is missed
 * however many notes are asked about.
 */
export async function loadFiction(admin: Admin, userId: string, notes: { id: string; title: string; text: string }[]): Promise<Map<string, Fiction>> {
  const wanted = new Map(notes.map((n) => [n.id, n]));
  const byNote = new Map<string, string[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("passages")
      .select("recording_id, position, text")
      .eq("user_id", userId)
      .eq("truth", "fiction")
      .order("recording_id")
      .order("position")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as { recording_id: string; text: string }[];
    for (const row of rows) if (wanted.has(row.recording_id)) byNote.set(row.recording_id, [...(byNote.get(row.recording_id) ?? []), row.text]);
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
