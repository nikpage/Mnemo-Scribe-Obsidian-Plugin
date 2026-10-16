// [Librarian, Guru]

import type { Walk, WalkEdge, WalkNode } from "@/lib/note/walk";
import type { Kind } from "@/lib/note/what-next-target";

/**
 * Brain outputs in the Web: the outputs that read the walk's notes, each its
 * own mark, beside the notes it read ("with") or in place of every note, tied
 * to the tags those notes carry ("only"). An output that read more than
 * `BRAIN_READ_MAX` notes (the whole store) joins only the notes it quoted, or
 * it would join everything. Free, worked out in the browser, free of Next and
 * server code.
 */

export const BRAIN_VIEWS = ["off", "with", "only"] as const;
export type BrainView = (typeof BRAIN_VIEWS)[number];

/** One output as the Web holds it: no text, only what names it and the notes it joins. */
export type BrainRef = { id: string; title: string; job: Kind; at: string; joins: string[] };

/** Past this many notes read, an output joins only the notes it quoted. */
export const BRAIN_READ_MAX = 150;
/** The most outputs one walk shows, those touching most of its notes first. */
export const BRAIN_MAX = 12;

export const brainId = (id: string) => `b:${id}`;

/** The notes an output joins in the Web: all it read, or for a reading of everything, the notes it quoted. */
export function joinsOf(read: string[], quoted: string[]): string[] {
  return [...new Set(read.length <= BRAIN_READ_MAX ? read : quoted)];
}

type NoteNode = Extract<WalkNode, { kind: "note" }>;

/** The walk with the outputs of one function (any, when null) drawn in it, as `view` asks. */
export function withBrain(walk: Walk, outputs: BrainRef[], view: BrainView, job: Kind | null): Walk {
  if (view === "off") return walk;
  const ringOf = new Map(walk.nodes.map((n) => [n.id, n.ring]));
  const shown = new Set(walk.nodes.flatMap((n) => (n.kind === "note" ? [n.note.id] : [])));
  const hits = outputs
    .filter((o) => !job || o.job === job)
    .map((o) => ({ o, read: [...new Set(o.joins)].filter((id) => shown.has(id)).map((id) => `n:${id}`) }))
    .filter((h) => h.read.length > 0)
    .sort((a, b) => b.read.length - a.read.length || b.o.at.localeCompare(a.o.at) || a.o.id.localeCompare(b.o.id))
    .slice(0, BRAIN_MAX);
  if (!hits.length) return view === "only" ? withoutNotes(walk, []) : walk;

  // What each output is tied to: the notes it read, or (only) the tags they carry, the centre when they carry none shown.
  const tagsOf = new Map<string, string[]>();
  for (const e of walk.edges) if (e.kind === "carries") tagsOf.set(e.a, [...(tagsOf.get(e.a) ?? []), e.b]);
  const nodes: WalkNode[] = [];
  const edges: WalkEdge[] = [];
  for (const { o, read } of hits) {
    const id = brainId(o.id);
    const ends =
      view === "with"
        ? read
        : [...new Set(read.flatMap((n) => (n === walk.centre ? [n] : (tagsOf.get(n) ?? []))))].sort();
    const to = ends.length ? ends : [walk.centre];
    const nearest = [...to].sort((a, b) => (ringOf.get(a) ?? 3) - (ringOf.get(b) ?? 3) || a.localeCompare(b))[0];
    nodes.push({ id, kind: "brain", ring: Math.min(3, (ringOf.get(nearest) ?? 2) + 1), from: nearest, brain: { id: o.id, title: o.title, job: o.job }, at: o.at, read: read.length });
    for (const end of to) edges.push({ id: `r:${o.id}\n${end}`, a: id, b: end, kind: "read", why: null });
  }
  const added = { centre: walk.centre, nodes: [...walk.nodes, ...nodes], edges: [...walk.edges, ...edges] };
  return view === "with" ? added : withoutNotes(added, nodes.map((n) => n.id));
}

/** Every note gone but the centre, and whatever then no line reaches from the centre; outputs always stay. */
function withoutNotes(walk: Walk, outputs: string[]): Walk {
  const gone = new Set(walk.nodes.filter((n): n is NoteNode => n.kind === "note" && n.id !== walk.centre).map((n) => n.id));
  const edges = walk.edges.filter((e) => !gone.has(e.a) && !gone.has(e.b));
  const reached = new Set([walk.centre, ...outputs]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of edges) {
      if (reached.has(e.a) !== reached.has(e.b)) {
        reached.add(e.a).add(e.b);
        grew = true;
      }
    }
  }
  const kept = edges.filter((e) => reached.has(e.a) && reached.has(e.b));
  const nodes = walk.nodes.filter((n) => reached.has(n.id));
  // A thing reached from a note now gone is reached from what it still touches one step nearer, else the centre.
  const ringOf = new Map(nodes.map((n) => [n.id, n.ring]));
  const nearer = (n: WalkNode) =>
    kept
      .flatMap((e) => (e.a === n.id ? [e.b] : e.b === n.id ? [e.a] : []))
      .filter((id) => (ringOf.get(id) ?? Infinity) < n.ring)
      .sort((x, y) => ringOf.get(x)! - ringOf.get(y)! || x.localeCompare(y))[0];
  return {
    centre: walk.centre,
    nodes: nodes.map((n) => (n.from && gone.has(n.from) ? { ...n, from: nearer(n) ?? walk.centre } : n)),
    edges: kept,
  };
}
