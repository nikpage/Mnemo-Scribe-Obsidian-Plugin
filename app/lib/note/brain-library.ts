// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { quoteFound } from "@/lib/note/angle-filter";
import { readingSections } from "@/lib/note/reading-sections";
import { EVERYTHING, type Kind, type Narrow, type Scope, subjectOf } from "@/lib/note/what-next-target";
import { type BrainRef, joinsOf } from "@/lib/note/walk-brain";

/**
 * The Brain library: every reading the person has had, by what it is called
 * and what it was for. Free to read and worked out here, on rows the route
 * already holds, so the list and each reading's page are one request each.
 */

/** One reading as the library lists it: no text, only what names and sorts it. */
export type LibraryRow = { id: string; scope: Scope; target: string; created_at: string; title: string; notes: number };

/** A passage a reading rested on, in the note it came from. */
export type Extract = { id: string; quote: string };

/** Extracts a reading names at most. */
export const EXTRACTS_MAX = 6;

export const SORTS = ["newest", "oldest", "notes"] as const;
export type Sort = (typeof SORTS)[number];

/** The Brain function a reading was: a subject reading's job, else the big picture. */
export function kindOf(scope: Scope, target: string): Kind {
  return scope === "subject" ? (subjectOf(target)?.kind ?? "picture") : "picture";
}

/** What a reading read, as asked: its subject (none for all notes) and its narrowing. */
export function askedOf(scope: Scope, target: string): { subject: string; narrow: Partial<Narrow> } {
  if (scope === "subject") {
    const asked = subjectOf(target);
    return asked ? { subject: asked.subject === EVERYTHING ? "" : asked.subject, narrow: asked.narrow } : { subject: "", narrow: {} };
  }
  return { subject: "", narrow: scope === "tags" ? { only: target.split(",").filter(Boolean) } : scope === "item" ? { centre: target } : {} };
}

/**
 * What a reading is called: the title its call wrote, else (a reading from
 * before titles) its first heading, else nothing for the screen to fill.
 */
export function readingTitle(row: { title: string | null; reading: string | null }): string {
  const own = row.title?.replace(/\s+/g, " ").trim();
  if (own) return own;
  return (row.reading ? readingSections(row.reading).find((s) => s.heading)?.heading : null) ?? "";
}

/** The library in the order asked for, only the function asked for when one is. */
export function arrange(rows: LibraryRow[], sort: Sort, kind: Kind | null): LibraryRow[] {
  const shown = kind ? rows.filter((r) => kindOf(r.scope, r.target) === kind) : rows;
  const newest = (a: LibraryRow, b: LibraryRow) => b.created_at.localeCompare(a.created_at);
  return [...shown].sort(sort === "oldest" ? (a, b) => newest(b, a) : sort === "notes" ? (a, b) => b.notes - a.notes || newest(a, b) : newest);
}

/**
 * The extracts kept: each in a note the reading read, found there word for
 * word, never twice, at most `EXTRACTS_MAX`. A model's quote that is not in
 * the note is not an extract of it.
 */
export function keptExtracts(extracts: Extract[], read: { id: string; text: string }[]): Extract[] {
  const texts = new Map(read.map((n) => [n.id, n.text]));
  const seen = new Set<string>();
  const kept: Extract[] = [];
  for (const e of extracts) {
    const text = texts.get(e.id);
    const quote = e.quote.replace(/\s+/g, " ").trim();
    const key = `${e.id}\n${quote.toLowerCase()}`;
    if (!text || seen.has(key) || !quoteFound(quote, text)) continue;
    seen.add(key);
    kept.push({ id: e.id, quote });
    if (kept.length === EXTRACTS_MAX) break;
  }
  return kept;
}

/** Brain outputs a search shows at most, in their own group under the notes. */
export const SEARCH_MAX = 8;

/** A typed query as a `like` pattern: its own `%`, `_` and `\\` matched as written. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The Brain outputs whose title or text holds the query, newest first. Free,
 * and never part of an answer: a search lists them for the person to open,
 * apart from the notes, because they are the Brain's words, not theirs.
 */
export async function findReadings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  query: string
): Promise<LibraryRow[]> {
  const pattern = likePattern(query.trim());
  const ask = (column: "title" | "reading") =>
    admin
      .from("what_next_readings")
      .select("id, scope, target, created_at, title, notes, reading")
      .eq("user_id", userId)
      .eq("status", "done")
      .is("parent_id", null)
      .ilike(column, pattern)
      .order("created_at", { ascending: false })
      .limit(SEARCH_MAX);
  const [byTitle, byText] = await Promise.all([ask("title"), ask("reading")]);
  const seen = new Set<string>();
  const rows: LibraryRow[] = [];
  for (const r of [...(byTitle.data || []), ...(byText.data || [])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push({ id: r.id, scope: r.scope, target: r.target, created_at: r.created_at, title: readingTitle(r), notes: r.notes ?? 0 });
  }
  return rows.slice(0, SEARCH_MAX);
}

/** The most outputs the Web is sent: far past a year of the monthly limit. */
export const WEB_BRAIN_MAX = 1000;

/**
 * Every output the Web can draw, newest first: those that stored the notes
 * they read (from `075`), each with the notes it joins (`joinsOf()`). Free.
 */
export async function brainRefs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string
): Promise<BrainRef[]> {
  const { data, error } = await admin
    .from("what_next_readings")
    .select("id, scope, target, created_at, title, reading, read_ids, elsewhere_ids, extracts")
    .eq("user_id", userId)
    .eq("status", "done")
    .is("parent_id", null)
    .not("read_ids", "is", null)
    .order("created_at", { ascending: false })
    .limit(WEB_BRAIN_MAX);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id,
    title: readingTitle(r),
    job: kindOf(r.scope, r.target),
    at: r.created_at,
    joins: joinsOf([...(r.read_ids ?? []), ...(r.elsewhere_ids ?? [])], ((r.extracts ?? []) as Extract[]).map((e) => e.id)),
  }));
}
