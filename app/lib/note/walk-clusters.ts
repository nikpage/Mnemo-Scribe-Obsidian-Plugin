// [Librarian]

import type { Walk, WalkEdge } from "@/lib/note/walk";

/**
 * The groups inside one walk: notes and tags tied together more closely than
 * to the rest (Louvain's local moving, on the walk's own lines and on which
 * notes read alike). The walk's
 * centre is left out, since it touches nearly everything and would pull the
 * picture into one lump. Worked out the same way every time (nodes taken in id
 * order, ties to the lowest group), free of Next and server code.
 */

/** Two notes by id and how alike they read, 0 to 1 (`walk-meaning.ts`). */
export type Tie = [string, string, number];
export type Meaning = {
  /** The ids asked for, as asked, so a reply is only ever used for its own picture. */
  ids: string;
  ties: Tie[];
};

/** How firmly a line ties its two ends. */
const WEIGHT: Record<WalkEdge["kind"], number> = { link: 3, subject: 2, theme: 1.5, under: 2, carries: 1, read: 1.5 };
/** Fewer nodes than this are not worth grouping. */
export const CLUSTER_MIN_NODES = 6;
/** A likeness of 0.5 ties nothing; each tenth above it adds 0.8 up to 4, so close in meaning outweighs a link. */
export const meaningWeight = (score: number) => Math.max(0, Math.min(4, 8 * (score - 0.5)));
const PASSES = 20;

/** Group number per node id; nodes with no line to another get group -1 (they are gathered into one band by the caller). */
export function communities(ids: string[], lines: [string, string, number][]): Map<string, number> {
  const order = [...ids].sort();
  const index = new Map(order.map((id, i) => [id, i]));
  const near: Map<number, number>[] = order.map(() => new Map());
  const degree: number[] = order.map(() => 0);
  let total = 0;
  for (const [a, b, w] of lines) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    near[i].set(j, (near[i].get(j) ?? 0) + w);
    near[j].set(i, (near[j].get(i) ?? 0) + w);
    degree[i] += w;
    degree[j] += w;
    total += 2 * w;
  }
  const group = order.map((_, i) => i);
  const sum = [...degree];
  for (let pass = 0; pass < PASSES && total > 0; pass++) {
    let moved = false;
    for (let i = 0; i < order.length; i++) {
      if (!near[i].size) continue;
      const to = new Map<number, number>();
      for (const [j, w] of near[i]) to.set(group[j], (to.get(group[j]) ?? 0) + w);
      const own = group[i];
      sum[own] -= degree[i];
      const gain = (g: number) => (to.get(g) ?? 0) - (sum[g] * degree[i]) / total;
      let best = own;
      let bestGain = gain(own);
      for (const g of [...to.keys()].sort((x, y) => x - y)) {
        if (gain(g) > bestGain + 1e-9) {
          best = g;
          bestGain = gain(g);
        }
      }
      sum[best] += degree[i];
      if (best !== own) {
        group[i] = best;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return new Map(order.map((id, i) => [id, near[i].size ? group[i] : -1]));
}

export type Band = { lo: number; hi: number; ids: string[] };

/**
 * Splits the room from `lo` to `hi` across the time axis into one band per
 * group, each as tall as its members need, the biggest in the middle (the
 * centre stands there) and the rest alternating outward by size. Nodes that
 * touch nothing but the centre share one last band. `ties` adds notes close in meaning. Null when the walk is too
 * small or holds only one group.
 */
export function bandsOf(walk: Walk, lo: number, hi: number, ties: Tie[] = []): Band[] | null {
  if (walk.nodes.length < CLUSTER_MIN_NODES) return null;
  const ids = walk.nodes.filter((n) => n.id !== walk.centre).map((n) => n.id);
  const lines: [string, string, number][] = walk.edges.filter((e) => e.a !== walk.centre && e.b !== walk.centre).map((e) => [e.a, e.b, WEIGHT[e.kind]]);
  // Notes close in meaning are tied too, whether or not any tag or link says so.
  for (const [a, b, score] of ties) lines.push([`n:${a}`, `n:${b}`, meaningWeight(score)]);
  const found = communities(ids, lines);
  const members = new Map<number, string[]>();
  for (const [id, g] of found) members.set(g, [...(members.get(g) ?? []), id]);
  // A group of one is not a group: it joins the loose nodes.
  const loose = [...(members.get(-1) ?? [])];
  const groups: string[][] = [];
  for (const [g, list] of [...members.entries()].sort(([x], [y]) => x - y)) {
    if (g === -1) continue;
    if (list.length < 2) loose.push(...list);
    else groups.push(list.sort());
  }
  groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  if (loose.length) groups.push(loose.sort());
  if (groups.length < 2) return null;

  // Biggest in the middle, then one side and the other.
  const placed: string[][] = [];
  groups.forEach((g, k) => (k % 2 === 0 ? placed.push(g) : placed.unshift(g)));
  const weight = (g: string[]) => g.length + 1.5;
  const unit = (hi - lo) / placed.reduce((s, g) => s + weight(g), 0);
  let at = lo;
  return placed.map((g) => {
    const band = { lo: at, hi: at + unit * weight(g), ids: g };
    at = band.hi;
    return band;
  });
}
