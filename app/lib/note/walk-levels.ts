// [Librarian]

import type { Walk, WalkEdge, WalkNode } from "@/lib/note/walk";

/**
 * How the walk is told apart at a glance: three levels, each its own colour
 * and line weight. 1 is the thing walked from, 2 what touches it, 3 what is
 * two or three steps out. A line takes the level of the end nearer the centre,
 * so what radiates from the centre is the heaviest thing in the picture.
 */
export type Level = 1 | 2 | 3;

export const levelOfRing = (ring: number): Level => (ring <= 0 ? 1 : ring === 1 ? 2 : 3);
export const LEVEL_WIDTH: Record<Level, number> = { 1: 4.4, 2: 2.4, 3: 1.5 };
/** The colour of a level: CSS variables, drawn in the app (`globals.css`) and in the panel (`panel/style.ts`). */
export const levelColour = (level: Level) => `var(--walk-${level})`;

export function edgeLevel(edge: WalkEdge, ringOf: Map<string, number>): Level {
  return levelOfRing(Math.min(ringOf.get(edge.a) ?? 3, ringOf.get(edge.b) ?? 3));
}

/** Lines furthest first, so what leaves the centre is drawn last, on top of everything. */
export function drawOrder<T extends { edge: WalkEdge }>(held: T[], ringOf: Map<string, number>): (T & { level: Level })[] {
  return held.map((h) => ({ ...h, level: edgeLevel(h.edge, ringOf) })).sort((x, y) => y.level - x.level);
}

/** The strongest reasons first: a note link, a shared subject or thread, a tag's parent, a note's tag. */
const REASON_ORDER: Record<WalkEdge["kind"], number> = { link: 0, subject: 1, theme: 1, under: 2, carries: 3 };

/** Every line of the picture that touches one node, the strongest reason first. */
export function connectionsOf(walk: Walk, id: string): WalkEdge[] {
  return walk.edges.filter((x) => x.a === id || x.b === id).sort((x, y) => REASON_ORDER[x.kind] - REASON_ORDER[y.kind] || x.id.localeCompare(y.id));
}

/** One line of the list beside the picture. */
export type Row = {
  node: WalkNode;
  level: Level;
  /** 0 for the centre, one more for each step out. */
  depth: number;
  /** Shown again under another node it also touches; not opened out a second time. */
  again: boolean;
  /** On the first appearance: how many other nodes one step nearer it also touches. */
  alsoUnder: { id: string; name: string }[];
};

export const nameOf = (n: WalkNode) => (n.kind === "tag" ? `#${n.name}` : n.note.title);

/**
 * The walk as a tree from the centre, in the order a person reads it: tags
 * before notes, tags by size, notes newest first. A node touching several
 * nodes one step nearer sits under the first and is shown again, shut, under
 * each of the others, so a thing reached two ways is seen to be.
 */
export function listOf(walk: Walk): Row[] {
  const byId = new Map(walk.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, WalkNode[]>();
  const nearer = new Map<string, WalkNode[]>();
  for (const e of walk.edges) {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b || a.ring === b.ring || Math.abs(a.ring - b.ring) !== 1) continue;
    const [from, to] = a.ring < b.ring ? [a, b] : [b, a];
    if (!kids.get(from.id)?.some((n) => n.id === to.id)) kids.set(from.id, [...(kids.get(from.id) ?? []), to]);
    if (!nearer.get(to.id)?.some((n) => n.id === from.id)) nearer.set(to.id, [...(nearer.get(to.id) ?? []), from]);
  }
  const order = (x: WalkNode, y: WalkNode) =>
    (x.kind === y.kind ? 0 : x.kind === "tag" ? -1 : 1) ||
    (x.kind === "tag" && y.kind === "tag" ? y.count - x.count || x.name.localeCompare(y.name) : 0) ||
    (x.at < y.at ? 1 : x.at > y.at ? -1 : 0) ||
    x.id.localeCompare(y.id);
  // The parent a node is opened under: the one it was reached from if it still touches it, else the first by order.
  const home = (n: WalkNode): string | undefined => {
    const ups = [...(nearer.get(n.id) ?? [])].sort(order);
    return (ups.find((u) => u.id === n.from) ?? ups[0])?.id;
  };

  const out: Row[] = [];
  const walkDown = (n: WalkNode, depth: number, again: boolean) => {
    const others = again ? [] : (nearer.get(n.id) ?? []).filter((u) => u.id !== home(n)).sort(order).map((u) => ({ id: u.id, name: nameOf(u) }));
    out.push({ node: n, level: levelOfRing(n.ring), depth, again, alsoUnder: others });
    if (again) return;
    for (const child of [...(kids.get(n.id) ?? [])].sort(order)) walkDown(child, depth + 1, home(child) !== n.id);
  };
  const centre = byId.get(walk.centre);
  if (centre) walkDown(centre, 0, false);
  // Whatever no line reaches is still listed, so the list never shows less than the picture.
  const listed = new Set(out.map((r) => r.node.id));
  for (const n of [...walk.nodes].sort(order)) if (!listed.has(n.id)) out.push({ node: n, level: levelOfRing(n.ring), depth: Math.max(1, n.ring), again: false, alsoUnder: [] });
  return out;
}
