// [Guru]

import type { StoreNote } from "@/lib/note/angles";

/** How a note stands, as a line the AI reads beside it. Empty for an ordinary note. */
export function standing(n: { published?: boolean; supersededBy?: string | null }): string {
  if (n.supersededBy) return ` — REPLACED by published note [${n.supersededBy}]: background only, never weighed against it`;
  if (n.published) return " — PUBLISHED: the final word on what it says";
  return "";
}

/** The number a note's title opens with (`2-The-Universe-Becomes` → 2), or none. */
export function partOf(label: string): number | null {
  const found = /^(\d{1,2})-/.exec(label);
  return found ? Number(found[1]) : null;
}

/**
 * The store as one text, oldest first, with a work's parts together and in
 * order. Sent loose, a three-part essay was read as three notes agreeing
 * with each other. Parts are one work when they carry the same tags. A
 * published note says it is the final word; a note it replaces, that it is
 * background.
 */
export function renderStore(store: StoreNote[], tags: Map<string, string[]>) {
  const works = new Map<string, StoreNote[]>();
  for (const n of store) {
    const key = partOf(n.label) === null ? n.id : `work:${[...(tags.get(n.id) || [])].sort().join(",")}`;
    works.set(key, [...(works.get(key) || []), n]);
  }
  const text = [...works.values()]
    .flatMap((notes) => [...notes].sort((a, b) => (partOf(a.label) ?? 99) - (partOf(b.label) ?? 99)))
    .map((n) => {
      const part = partOf(n.label);
      const noteTags = tags.get(n.id) || [];
      const stands = standing({ published: n.workStatus === "published", supersededBy: n.supersededBy });
      return `[${n.id}] ${n.label}${part === null ? "" : ` — part ${part}`}${noteTags.length ? ` — tags: ${noteTags.join(", ")}` : ""} (recorded ${n.recordedAt.slice(0, 10)})${stands}\n${n.text}`;
    })
    .join("\n\n");
  return { text };
}
