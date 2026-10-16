// [Guru]

import { quoteFound } from "@/lib/note/angle-filter";
import { readingSections } from "@/lib/note/reading-sections";
import { EVERYTHING, type Kind, type Narrow, type Scope, subjectOf } from "@/lib/note/what-next-target";

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
