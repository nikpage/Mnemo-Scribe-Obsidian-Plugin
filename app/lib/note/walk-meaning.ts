// [Librarian]

import type { Meaning, Tie } from "@/lib/note/walk-clusters";

/**
 * Which of a walk's notes are close in meaning, from the pairs kept for each
 * note (`neighbour-table.ts`): arithmetic only, no model call, no server in
 * the browser. The Web uses it beside its lines to group notes (`walk-clusters.ts`).
 */

/** As close as a vault link candidate needs to be to be worth a look (`links.ts`). */
export const MEANING_FLOOR = 0.55;
/** Each note keeps its nearest few, so a picture of forty notes is not forty-by-forty ties. */
export const MEANING_PER_NOTE = 3;
export const MEANING_MAX_NOTES = 60;

/** Every pair at or above the floor, each note keeping only its nearest few (a pair kept by either end stays). */
export function tiesFrom(ids: string[], like: (a: string, b: string) => number, floor = MEANING_FLOOR, per = MEANING_PER_NOTE): Tie[] {
  const sorted = [...new Set(ids)].sort();
  const all: Tie[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const score = like(sorted[i], sorted[j]);
      if (score >= floor) all.push([sorted[i], sorted[j], score]);
    }
  }
  const kept = new Set<string>();
  for (const id of sorted) {
    all
      .filter(([a, b]) => a === id || b === id)
      .sort((x, y) => y[2] - x[2] || x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]))
      .slice(0, per)
      .forEach(([a, b]) => kept.add(`${a}\n${b}`));
  }
  return all.filter(([a, b]) => kept.has(`${a}\n${b}`));
}

/** The ties among the notes named, from the kept pairs; at most `MEANING_MAX_NOTES` notes, as a reply. */
export function meaningFrom(pairs: Tie[], ids: string[]): Meaning {
  const asked = [...new Set(ids)].sort().slice(0, MEANING_MAX_NOTES);
  if (asked.length < 2) return { ids: asked.join(","), ties: [] };
  const score = new Map(pairs.map(([a, b, s]) => [`${a}\n${b}`, s]));
  return { ids: asked.join(","), ties: tiesFrom(asked, (x, y) => score.get(`${x}\n${y}`) ?? score.get(`${y}\n${x}`) ?? 0) };
}
