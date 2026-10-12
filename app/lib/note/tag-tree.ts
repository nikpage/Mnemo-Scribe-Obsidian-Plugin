// [Librarian, Filer]

/**
 * Tags under tags, as Bear has them. A note keeps flat tags; each tag may sit
 * under one other tag, and opening a tag shows the notes carrying it or any
 * tag under it. Only the user puts a tag under another — the model may
 * suggest one (`tag-suggestions.ts`), never set it. Pure, so the sidebar, the notes page, search
 * and the vault all read the tree the same way.
 */

export interface TagRow {
  name: string;
  parent: string | null;
  /** What a note must be about to carry it, in the person's words. */
  meaning?: string | null;
  /** Each note whose only tag this is, to the tag a tidy-up suggests for it ("" = none). */
  moves?: Record<string, string>;
}

/** Each tag to its parent. A loop (saved by two devices at once) is cut where it closes. */
export type Parents = Map<string, string>;

export function parentsOf(rows: TagRow[]): Parents {
  const parents: Parents = new Map();
  for (const row of rows) {
    if (row.parent && row.parent !== row.name && !under(row.name, parents).has(row.parent)) {
      parents.set(row.name, row.parent);
    }
  }
  return parents;
}

/** A tag and every tag beneath it, at any depth. */
export function under(tag: string, parents: Parents): Set<string> {
  const out = new Set([tag]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [child, parent] of parents) {
      if (out.has(parent) && !out.has(child)) {
        out.add(child);
        grew = true;
      }
    }
  }
  return out;
}

/** The tags above a tag and the tag itself, top first: `["food", "recipe"]`. */
export function ancestry(tag: string, parents: Parents): string[] {
  const line = [tag];
  for (let at = parents.get(tag); at && !line.includes(at); at = parents.get(at)) line.unshift(at);
  return line;
}

/** A tag as a vault writes it: `food/recipe`. */
export function nestedTag(tag: string, parents: Parents): string {
  return ancestry(tag, parents).join("/");
}

/** Whether `parent` may hold `tag`: never itself, never a tag beneath it. */
export function canParent(tag: string, parent: string | null, parents: Parents): boolean {
  return parent === null || !under(tag, parents).has(parent);
}

/** Whether a note shows on a view of these tags: for each, it carries it or a tag under it. */
export function carriesUnder(noteTags: string[] | null | undefined, selected: string[], parents: Parents): boolean {
  return viewOf(selected, parents)(noteTags);
}

/** `carriesUnder` for many notes: each tag's branch worked out once. */
export function viewOf(selected: string[], parents: Parents): (noteTags: string[] | null | undefined) => boolean {
  const branches = selected.map((tag) => under(tag, parents));
  return (noteTags) => branches.every((branch) => (noteTags || []).some((tag) => branch.has(tag)));
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
 * one, by name at each level. A tag no note carries, at any depth, is left out.
 */
export function tagTree(rows: TagRow[], notes: { tags: string[] | null }[]): TagNode[] {
  const parents = parentsOf(rows);
  const used = new Set(notes.flatMap((note) => note.tags || []));
  const shown = new Set<string>();
  for (const tag of used) for (const at of ancestry(tag, parents)) shown.add(at);

  const build = (parent: string | null): TagNode[] =>
    [...shown]
      .filter((tag) => (parents.get(tag) ?? null) === parent)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const branch = under(name, parents);
        return {
          name,
          count: notes.filter((note) => (note.tags || []).some((tag) => branch.has(tag))).length,
          children: build(name),
        };
      });
  return build(null);
}
