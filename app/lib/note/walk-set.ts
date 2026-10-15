// [Librarian]

import type { Walk, WalkNode } from "@/lib/note/walk";

/**
 * One picture for a set of anchors: each anchor's own walk (`buildWalk`) put
 * into one drawing, every anchor a centre. A thing reached from several
 * anchors is drawn once, at its nearest step; each anchor keeps its own whole
 * walk for its list. A note in the walks of two or more anchors is `shared`,
 * a note in one is `only`. Worked out in the browser, free of Next and server code.
 */

/** The most notes the one picture shows; over it, the furthest step goes first (third, then second). */
export const PICTURE_NOTES_MAX = 40;

export type Share = "shared" | "only";
export type Picture = {
  /** What is drawn: the union, the anchors at step 0, the furthest steps cut to the limit. */
  walk: Walk;
  /** The anchors' node ids, in the order of the set. */
  anchors: string[];
  /** Each anchor's own whole walk, the same order. */
  walks: Walk[];
  /** For each node, the anchors whose walk holds it. */
  reach: Map<string, string[]>;
  /** For each note, shared or only; empty for a single anchor. */
  shares: Map<string, Share>;
};

export function mergeWalks(walks: Walk[], max = PICTURE_NOTES_MAX): Picture {
  const anchors = walks.map((w) => w.centre);
  if (walks.length === 1) return { walk: walks[0], anchors, walks, reach: new Map(walks[0].nodes.map((n) => [n.id, [walks[0].centre]])), shares: new Map() };

  const nodes = new Map<string, WalkNode>();
  const reach = new Map<string, string[]>();
  for (const w of walks) {
    for (const n of w.nodes) {
      reach.set(n.id, [...(reach.get(n.id) ?? []), w.centre]);
      const held = nodes.get(n.id);
      if (!held || n.ring < held.ring) nodes.set(n.id, n);
    }
  }
  // An anchor is a centre in the picture even where another anchor's walk reaches it.
  for (const a of anchors) nodes.set(a, { ...nodes.get(a)!, ring: 0, from: null });

  let kept = [...nodes.values()];
  const notes = () => kept.filter((n) => n.kind === "note").length;
  for (const ring of [3, 2]) {
    if (notes() <= max) break;
    kept = kept.filter((n) => n.ring < ring);
  }
  const ids = new Set(kept.map((n) => n.id));
  const edges = new Map<string, Walk["edges"][number]>();
  for (const w of walks) for (const e of w.edges) if (ids.has(e.a) && ids.has(e.b)) edges.set(e.id, e);

  const shares = new Map<string, Share>();
  // Notes and tags alike; an anchor is a centre, marked neither.
  for (const w of walks) for (const n of w.nodes) if (!anchors.includes(n.id)) shares.set(n.id, (reach.get(n.id)?.length ?? 0) >= 2 ? "shared" : "only");

  return { walk: { centre: anchors[0], nodes: kept, edges: [...edges.values()] }, anchors, walks, reach, shares };
}
