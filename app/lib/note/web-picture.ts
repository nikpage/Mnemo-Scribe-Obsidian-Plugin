// [Librarian]

/**
 * Which tags the Web's pictures show, and how near each is to its walk's
 * centre (0 the anchor itself, then one more per step), so the left tag list
 * can wear the walk's colours. Each walk reports its own; a tag in several is
 * as near as its nearest.
 */
const pictures = new Map<string, Map<string, number>>();
const listeners = new Set<() => void>();
const NONE: ReadonlyMap<string, number> = new Map();
let merged: ReadonlyMap<string, number> = NONE;

export function showPicture(walk: string, tags: Map<string, number> | null): void {
  if (tags) pictures.set(walk, tags);
  else pictures.delete(walk);
  const next = new Map<string, number>();
  for (const held of pictures.values()) for (const [tag, ring] of held) next.set(tag, Math.min(ring, next.get(tag) ?? ring));
  merged = next.size ? next : NONE;
  listeners.forEach((l) => l());
}

export function subscribePicture(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const pictureNow = (): ReadonlyMap<string, number> => merged;
export const noPicture = (): ReadonlyMap<string, number> => NONE;
