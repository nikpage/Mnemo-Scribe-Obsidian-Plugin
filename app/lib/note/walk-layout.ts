// [Librarian]

import type { Walk, WalkNode } from "@/lib/note/walk";

/**
 * Where each thing of a walk sits. Time runs left to right, so a note's place
 * across is when it was written; how far up or down is how many steps from
 * the centre, each node leaving the one it was reached from. Nothing moves by
 * itself: the same walk always lands in the same place.
 */

const MARGIN = 56;
const STEP = 74;
/** Narrower than this, time runs down the screen instead of across it. */
export const WIDE = 640;

export type Placed = { id: string; x: number; y: number; r: number; /** Its name is written beside it. */ named: boolean; label: string };
/** `at` is the place along the time axis. */
export type Tick = { at: number; iso: string; kind: "month" | "year" };
export type Layout = { placed: Map<string, Placed>; ticks: Tick[]; along: "x" | "y"; width: number; height: number };

const hash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

const labelOf = (n: WalkNode) => (n.kind === "tag" ? `#${n.name}` : n.note.title);
const short = (text: string, max = 22) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
export const radius = (n: WalkNode) => (n.kind === "tag" ? Math.min(30, 11 + 4.2 * Math.sqrt(n.count)) : 7);

/** Month or year starts within the span, few enough to read. */
function ticksFor(from: number, to: number, place: (ms: number) => number): Tick[] {
  const days = (to - from) / 86400000;
  const out: Tick[] = [];
  const start = new Date(from);
  const stepMonths = days <= 120 ? 1 : days <= 400 ? 3 : days <= 1100 ? 6 : 12;
  let at = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  let guard = 0;
  while (at <= to && guard++ < 400) {
    const d = new Date(at);
    if (d.getUTCMonth() % stepMonths === 0) out.push({ at: place(at), iso: d.toISOString(), kind: d.getUTCMonth() === 0 ? "year" : "month" });
    at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return out;
}

export function layoutWalk(walk: Walk, width: number, height: number): Layout {
  const along: "x" | "y" = width >= WIDE ? "x" : "y";
  // u runs along time, v across it.
  const U = along === "x" ? width : height;
  const V = along === "x" ? height : width;
  const times = walk.nodes.map((n) => Date.parse(n.at)).filter((t) => Number.isFinite(t));
  const from = times.length ? Math.min(...times) : null;
  const to = times.length ? Math.max(...times) : null;
  const span = from !== null && to !== null ? to - from : 0;
  const place = (ms: number) => (span > 0 && from !== null ? MARGIN + ((ms - from) / span) * (U - 2 * MARGIN) : U / 2);
  const vLow = MARGIN * 0.6;
  const vHigh = V - MARGIN * 0.6;
  const clampV = (v: number) => Math.max(vLow, Math.min(vHigh, v));

  const byId = new Map(walk.nodes.map((n) => [n.id, n]));
  type P = { id: string; u: number; v: number; r: number; label: string };
  const at = new Map<string, P>();
  const kids = new Map<string, number>();

  // Outward from the centre: a node starts a step to one side of the one it came from.
  for (const n of [...walk.nodes].sort((a, b) => a.ring - b.ring || a.id.localeCompare(b.id))) {
    const ms = Date.parse(n.at);
    const u = place(Number.isFinite(ms) ? ms : (from ?? 0));
    let v = V / 2;
    if (n.from) {
      const parent = at.get(n.from)!;
      const k = kids.get(n.from) ?? 0;
      kids.set(n.from, k + 1);
      const away = parent.v <= V / 2 ? -1 : 1;
      const side = k % 2 === 0 ? away : -away;
      v = parent.v + side * (STEP * (0.55 + 0.45 * Math.ceil((k + 1) / 2)) + hash(n.id) * 18);
    }
    at.set(n.id, { id: n.id, u, v: clampV(v), r: radius(n), label: short(labelOf(n)) });
  }

  // Keep things apart, mostly across the time axis so that time stays true.
  const list = [...at.values()];
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const need = a.r + b.r + 16;
        const du = b.u - a.u;
        const dv = b.v - a.v;
        const d = Math.hypot(du, dv);
        if (d >= need) continue;
        moved = true;
        const push = (need - d) / 2 + 0.5;
        const sv = dv === 0 ? (hash(a.id + b.id) > 0.5 ? 1 : -1) : Math.sign(dv);
        const su = du === 0 ? 1 : Math.sign(du);
        const keep = byId.get(a.id)?.ring === 0 ? "a" : byId.get(b.id)?.ring === 0 ? "b" : null;
        const gv = push * (d === 0 ? 1 : Math.max(0.6, Math.abs(dv) / d));
        const gu = pass > 40 ? push * 0.35 * su : 0;
        if (keep !== "a") {
          a.v -= sv * gv * (keep === "b" ? 2 : 1);
          a.u -= gu;
        }
        if (keep !== "b") {
          b.v += sv * gv * (keep === "a" ? 2 : 1);
          b.u += gu;
        }
      }
    }
    for (const p of list) {
      p.v = clampV(p.v);
      p.u = Math.max(MARGIN * 0.5, Math.min(U - MARGIN * 0.5, p.u));
    }
    if (!moved) break;
  }

  const placed = new Map<string, Placed>();
  for (const p of list) {
    const [x, y] = along === "x" ? [p.u, p.v] : [p.v, p.u];
    placed.set(p.id, { id: p.id, x, y, r: p.r, named: false, label: p.label });
  }

  // Names, most important first, each only where it does not run into another thing.
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const bodies = new Map<string, Box>([...placed.values()].map((p) => [p.id, { x0: p.x - p.r, x1: p.x + p.r, y0: p.y - p.r, y1: p.y + p.r }]));
  const taken: Box[] = [];
  const order = [...walk.nodes].sort((a, b) => (a.ring === 0 ? -1 : b.ring === 0 ? 1 : 0) || (a.kind === b.kind ? a.ring - b.ring : a.kind === "tag" ? -1 : 1) || a.id.localeCompare(b.id));
  for (const n of order) {
    const p = placed.get(n.id)!;
    const w = p.label.length * 6.8 + 8;
    const box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y + p.r + 2, y1: p.y + p.r + 18 };
    const clash = taken.some((t) => hit(box, t)) || [...bodies].some(([id, t]) => id !== p.id && hit(box, t));
    // The centre and tags are always named; a note only where there is room.
    if (!clash || n.ring === 0 || n.kind === "tag") {
      p.named = true;
      taken.push(box);
    }
  }

  return { placed, ticks: from !== null && to !== null && span > 0 ? ticksFor(from, to, place) : [], along, width, height };
}
