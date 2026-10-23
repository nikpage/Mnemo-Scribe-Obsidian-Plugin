// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { readingSections } from "@/lib/note/reading-sections";
import { EVERYTHING, type Kind, type Narrow, type Scope, subjectOf } from "@/lib/note/what-next-target";
import { type BrainRef, joinsOf } from "@/lib/note/walk-brain";
import { type Drew, outNotes, outputOut } from "@/lib/note/switches";

/**
 * The Brain library: every reading the person has had, by what it is called
 * and what it was for. A day's topic suggestions (`suggest`) share the table
 * and are not readings: every read here leaves them out. Free to read and worked out here, on rows the route
 * already holds, so the list and each reading's page are one request each.
 */

/** One reading as the library lists it: no text, only what names and sorts it; `fresh` the notes come in since it last read. */
export type LibraryRow = { id: string; scope: Scope; target: string; created_at: string; title: string; notes: number; fresh?: number };

/** A row of the library: a reading, or (with `week`) one week's report, `headlines` its insights' headlines. */
export type ShelfRow = LibraryRow & { week?: string; headlines?: string[] };

/** What the library can be kept to: one Brain function, or the weekly reports. */
export type ShelfKind = Kind | "report";

/** A week's report as its own page names it. */
export const reportHref = (week: string) => `/brain/report/${week}`;

/**
 * Everything the library lists: the readings, then each week's report as one
 * row, dated its Monday, counting the notes its insights rest on. The reports
 * are listed here only; Search and the Web reach a report as the note it is
 * saved as.
 */
export function libraryRows(readings: LibraryRow[], insights: { week_start: string; headline: string; evidence: string[] | null }[]): ShelfRow[] {
  const weeks = new Map<string, { headlines: string[]; notes: Set<string> }>();
  for (const i of insights) {
    const week = weeks.get(i.week_start) ?? { headlines: [], notes: new Set<string>() };
    week.headlines.push(i.headline);
    for (const id of i.evidence ?? []) week.notes.add(id);
    weeks.set(i.week_start, week);
  }
  const reports: ShelfRow[] = [...weeks].map(([week, { headlines, notes }]) => ({
    id: `report-${week}`,
    scope: "overview",
    target: "",
    created_at: `${week}T07:00:00.000Z`,
    title: "",
    notes: notes.size,
    week,
    headlines,
  }));
  return [...readings, ...reports];
}

/** The function a library row was: a report, else its reading's. */
export function shelfKindOf(row: ShelfRow): ShelfKind {
  return row.week ? "report" : kindOf(row.scope, row.target);
}

/**
 * Text as a quote is compared: case, curly quotes, dashes and runs of
 * whitespace are how a faithful copy still differs from its source, so they
 * are levelled; words are not.
 */
function levelled(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** A shorter "quote" is a phrase any note could contain, not a source. */
const QUOTE_MIN = 12;

/** The quote appears in the note, word for word. */
export function quoteFound(quote: string, text: string): boolean {
  const q = levelled(quote).replace(/^["']+|["']+$/g, "").trim();
  return q.length >= QUOTE_MIN && levelled(text).includes(q);
}

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
export function arrange(rows: ShelfRow[], sort: Sort, kind: ShelfKind | null): ShelfRow[] {
  const shown = kind ? rows.filter((r) => shelfKindOf(r) === kind) : rows;
  const newest = (a: ShelfRow, b: ShelfRow) => b.created_at.localeCompare(a.created_at);
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

/**
 * Whether new notes can be added to a reading. One note read against the notes
 * before it cannot: what comes after it was never its question.
 */
export function addable(scope: Scope): boolean {
  return scope !== "item";
}

/** An addition to a Brain output: a row under it with no part (an Elaborate names the part it writes out). */
export type Addition = { parent_id: string; created_at: string; reading: string | null; notes: number | null; read_ids: string[] | null; extracts: Extract[] | null };

/** The written additions to the caller's outputs (`ids`, else every output), oldest first. */
export async function additionsOf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  ids?: string[]
): Promise<Addition[]> {
  const query = admin
    .from("what_next_readings")
    .select("parent_id, created_at, reading, notes, read_ids, extracts")
    .eq("user_id", userId)
    .is("part", null)
    .eq("status", "done");
  const { data, error } = await (ids ? query.in("parent_id", ids) : query.not("parent_id", "is", null)).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as Addition[];
}

/** A reading row as far as what it drew on goes. */
type DrewRow = { id: string; scope: Scope; target: string; read_ids?: string[] | null; elsewhere_ids?: string[] | null; extracts?: Extract[] | null };

/**
 * What a reading drew on, its additions with it: it shows the notes it quotes
 * (and the one note it is of), and read every note sent to it.
 */
export function drewOf(row: DrewRow, additions: Addition[]): Drew {
  const more = additions.filter((a) => a.parent_id === row.id);
  const shows = [...new Set([...[row, ...more].flatMap((x) => (x.extracts ?? []) as Extract[]).map((e) => e.id), ...(row.scope === "item" ? [row.target] : [])])];
  const read = row.read_ids ? [...row.read_ids, ...(row.elsewhere_ids ?? []), ...more.flatMap((a) => a.read_ids ?? [])] : null;
  return { shows, read };
}

/**
 * The readings a switch now puts out (`lib/note/switches.ts`): those quoting a
 * hidden note, or drawn from one kept out of the Brain. Free.
 */
export async function outReadings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  rows: DrewRow[]
): Promise<Set<string>> {
  if (!rows.length) return new Set();
  const out = await outNotes(admin, userId);
  if (!out.hidden.size && !out.brainOff.size) return new Set();
  const added = await additionsOf(admin, userId, rows.map((r) => r.id));
  return new Set(rows.filter((r) => outputOut(drewOf(r, added), out)).map((r) => r.id));
}

/** When an output last read its notes: its own writing, or its newest addition. */
export function readUntil(output: { id: string; created_at: string }, additions: Addition[]): string {
  return additions.filter((a) => a.parent_id === output.id).reduce((at, a) => (Date.parse(a.created_at) > Date.parse(at) ? a.created_at : at), output.created_at);
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
      .select("id, scope, target, created_at, title, notes, reading, read_ids, elsewhere_ids, extracts")
      .eq("user_id", userId)
      .eq("status", "done")
      .neq("scope", "suggest")
      .is("parent_id", null)
      .ilike(column, pattern)
      .order("created_at", { ascending: false })
      .limit(SEARCH_MAX);
  const [byTitle, byText] = await Promise.all([ask("title"), ask("reading")]);
  const found = [...(byTitle.data || []), ...(byText.data || [])];
  const seen = await outReadings(admin, userId, found);
  const rows: LibraryRow[] = [];
  for (const r of found) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push({ id: r.id, scope: r.scope, target: r.target, created_at: r.created_at, title: readingTitle(r), notes: r.notes ?? 0 });
  }
  return rows.slice(0, SEARCH_MAX);
}

/** The most outputs the Web is sent: far past a year of the monthly limit. */
export const WEB_BRAIN_MAX = 1000;

/** Titles shorter than this are too common a word to say a reading named the note. */
const TITLE_MIN = 6;

/** The notes a reading's text names by title, whole title, any case: how a reading rests on a note (`RULES`). */
export function namedIn(text: string, notes: { id: string; title: string }[]): string[] {
  const flat = text.toLowerCase();
  return notes.filter((n) => n.title.trim().length >= TITLE_MIN && flat.includes(n.title.trim().toLowerCase())).map((n) => n.id);
}

/**
 * Every output the Web can draw, newest first, each with the notes it joins:
 * those it read (from `075`, `joinsOf()`), else those its text names by title.
 * Quoted: its extracts' notes and the notes it names. Free.
 */
export async function brainRefs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  notes: { id: string; title: string }[] = []
): Promise<BrainRef[]> {
  const { data, error } = await admin
    .from("what_next_readings")
    .select("id, scope, target, created_at, title, reading, read_ids, elsewhere_ids, extracts")
    .eq("user_id", userId)
    .eq("status", "done")
    .neq("scope", "suggest")
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(WEB_BRAIN_MAX);
  if (error) throw new Error(error.message);
  // What an addition read and quoted joins the output it was added to.
  const [added, out] = await Promise.all([additionsOf(admin, userId), outNotes(admin, userId)]);
  // One a switch now puts out is not drawn (`lib/note/switches.ts`).
  return (data || []).filter((r) => !outputOut(drewOf(r, added), out)).map((r) => {
    const more = added.filter((a) => a.parent_id === r.id);
    const named = namedIn([r.reading ?? "", ...more.map((a) => a.reading ?? "")].join("\n"), notes);
    const quoted = [...new Set([...[r, ...more].flatMap((x) => (x.extracts ?? []) as Extract[]).map((e) => e.id), ...named])];
    const read = more.flatMap((a) => a.read_ids ?? []);
    return {
      id: r.id,
      title: readingTitle(r),
      job: kindOf(r.scope, r.target),
      at: r.created_at,
      joins: r.read_ids ? joinsOf([...r.read_ids, ...(r.elsewhere_ids ?? []), ...read], quoted) : [...new Set([...named, ...read])],
      quoted,
    };
  });
}
