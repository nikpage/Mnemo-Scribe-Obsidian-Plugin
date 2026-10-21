// [Librarian, Filer]

/**
 * The person's tags, flat: no tag sits under another, and a tag opens the
 * notes carrying it, nothing more. Pure, so the sidebar and the Tags screen
 * count them the same way.
 */

export interface TagRow {
  name: string;
  /** What a note must be about to carry it, in the person's words. */
  meaning?: string | null;
  /** Each note whose only tag this is, to the tag a tidy-up suggests for it ("" = none). */
  moves?: Record<string, string>;
  /** Whether a fiction passage may carry it; off for history (`passages.ts`). */
  fictionCounts?: boolean;
}

export interface TagCount {
  name: string;
  /** Notes carrying it. */
  count: number;
}

/**
 * Every tag a note carries, by name, with how many notes carry it; a tag no
 * note carries is left out unless in `always` (the Tags screen lists every
 * tag the person has). `n`: how many notes carry exactly those tags
 * (`noteCounts()`), one when absent.
 */
export function tagList(notes: { tags: string[] | null; n?: number }[], always: string[] = []): TagCount[] {
  const counts = new Map(always.map((name) => [name, 0]));
  for (const note of notes) for (const tag of new Set(note.tags || [])) counts.set(tag, (counts.get(tag) ?? 0) + (note.n ?? 1));
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}
