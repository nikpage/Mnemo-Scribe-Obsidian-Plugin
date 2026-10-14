// [Librarian, Filer]

/**
 * Tags under tags. A note keeps flat tags; each tag may sit under any number
 * of other tags ("Israel-Palestine war" under war, Israel and Palestine), and
 * opening a tag shows the notes carrying it or any tag beneath it, by any
 * route. Only the user puts a tag under another — the model may suggest one
 * (`tag-suggestions.ts`), never set it. Pure, so the sidebar, the notes page,
 * search and the Brain read the tree the same way. Other apps get flat tags.
 */

export interface TagRow {
  name: string;
  /** Every tag it sits under (`tag_parents`), by name. */
  parents: string[];
  /** What a note must be about to carry it, in the person's words. */
  meaning?: string | null;
  /** Each note whose only tag this is, to the tag a tidy-up suggests for it ("" = none). */
  moves?: Record<string, string>;
}

/** Each tag to the tags it sits under. A loop (saved by two devices at once) is cut where it closes. */
export type Parents = Map<string, Set<string>>;

export function parentsOf(rows: TagRow[]): Parents {
  const parents: Parents = new Map();
  const pairs = rows
    .flatMap((row) => (row.parents || []).map((parent) => [row.name, parent] as const))
    .sort(([a, p], [b, q]) => a.localeCompare(b) || p.localeCompare(q));
  for (const [tag, parent] of pairs) {
    if (parent && parent !== tag && !under(tag, parents).has(parent)) {
      parents.set(tag, new Set([...(parents.get(tag) ?? []), parent]));
    }
  }
  return parents;
}

/** A tag and every tag beneath it, at any depth, by every route. */
export function under(tag: string, parents: Parents): Set<string> {
  const out = new Set([tag]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [child, above] of parents) {
      if (!out.has(child) && [...above].some((p) => out.has(p))) {
        out.add(child);
        grew = true;
      }
    }
  }
  return out;
}

/** A tag and every tag above it, at any depth, by every route. */
export function above(tag: string, parents: Parents): Set<string> {
  const out = new Set([tag]);
  for (const at of out) for (const parent of parents.get(at) ?? []) out.add(parent);
  return out;
}

/** The tags a tag sits under, by name. */
export function parentsList(tag: string, parents: Parents): string[] {
  return [...(parents.get(tag) ?? [])].sort((a, b) => a.localeCompare(b));
}

/**
 * One line of tags above a tag and the tag itself, top first: `["food",
 * "recipe"]`; through the first parent by name at each level.
 */
export function ancestry(tag: string, parents: Parents): string[] {
  const line = [tag];
  for (let at = parentsList(tag, parents)[0]; at && !line.includes(at); at = parentsList(at, parents)[0]) line.unshift(at);
  return line;
}

/** Every line from the top down to a tag, one per route, each top first. */
export function ancestries(tag: string, parents: Parents): string[][] {
  const walk = (at: string, seen: Set<string>): string[][] => {
    const up = parentsList(at, parents).filter((p) => !seen.has(p));
    if (up.length === 0) return [[at]];
    return up.flatMap((p) => walk(p, new Set([...seen, p])).map((line) => [...line, at]));
  };
  return walk(tag, new Set([tag]));
}

/** Whether `parent` may hold `tag`: never itself, never a tag beneath it. Null (the top) always. */
export function canParent(tag: string, parent: string | null, parents: Parents): boolean {
  return parent === null || !under(tag, parents).has(parent);
}

/** The note's tag deepest in the tree; equal depths, the first by name. Null for no tags. */
export function deepest(tags: string[], parents: Parents): string | null {
  let best: string | null = null;
  for (const tag of [...tags].sort()) {
    if (best === null || ancestry(tag, parents).length > ancestry(best, parents).length) best = tag;
  }
  return best;
}

export interface TagNode {
  name: string;
  /** Notes carrying it or any tag under it. */
  count: number;
  children: TagNode[];
}

/**
 * The tree the sidebar draws: every tag a note carries, and every tag above
 * one, by name at each level; a tag under two tags shows under each. A tag no
 * note carries, at any depth, is left out. `n`: how many notes carry exactly
 * those tags (`noteCounts()`), one when absent.
 */
export function tagTree(rows: TagRow[], notes: { tags: string[] | null; n?: number }[]): TagNode[] {
  const parents = parentsOf(rows);
  const used = new Set(notes.flatMap((note) => note.tags || []));
  const shown = new Set<string>();
  for (const tag of used) for (const line of ancestries(tag, parents)) for (const at of line) shown.add(at);

  const build = (parent: string | null): TagNode[] =>
    [...shown]
      .filter((tag) => (parent === null ? !parents.has(tag) : parents.get(tag)?.has(parent)))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const branch = under(name, parents);
        return {
          name,
          count: notes.filter((note) => (note.tags || []).some((tag) => branch.has(tag))).reduce((sum, note) => sum + (note.n ?? 1), 0),
          children: build(name),
        };
      });
  return build(null);
}
