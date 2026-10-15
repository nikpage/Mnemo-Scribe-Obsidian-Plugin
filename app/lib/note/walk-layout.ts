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
/** The room of an anchor's own band and of the band for the notes shared by neighbouring anchors, in the same unit. */
const ZONE_WEIGHT = 1.4;
const COMMON_WEIGHT = 1.6;
/** Narrower than this, time runs down the screen instead of across it. */
export const WIDE = 640;

export type Side = "below" | "above" | "right" | "left";
export type Placed = { id: string; x: number; y: number; r: number; /** Its name is written on this side of it, or nowhere. */ named: Side | null; label: string };
/** `at` is the place along the time axis. */
export type Tick = { at: number; iso: string; kind: "month" | "year" };
/** A long silence between two notes, drawn as a break instead of empty room. */
export type Break = { at: number; from: string; to: string };
export type Layout = { placed: Map<string, Placed>; ticks: Tick[]; breaks: Break[]; along: "x" | "y"; width: number; height: number };

const hash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

const labelOf = (n: WalkNode) => (n.kind === "tag" ? `#${n.name}` : n.note.title);
const short = (text: string, max = 22) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
export const radius = (n: WalkNode) => (n.kind === "tag" ? Math.min(30, 11 + 4.2 * Math.sqrt(n.count)) : 7);

const DAY = 86400000;
/** A silence this long, and this many times the usual gap, is shown as a break. */
const BREAK_MIN_DAYS = 90;
const BREAK_TIMES = 8;

/**
 * Notes are spaced by their order, not by the days between them: most notes
 * are recent, and on a calendar scale they pile up in the last tenth. Each
 * distinct moment gets one slot, a long silence gets one more, and dates are
 * marked where they fall among the slots.
 */
function slots(times: number[]): { at: number; slot: number }[] {
  const distinct = [...new Set(times)].sort((a, b) => a - b);
  const gaps = distinct.slice(1).map((t, i) => t - distinct[i]).sort((a, b) => a - b);
  const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const long = Math.max(BREAK_MIN_DAYS * DAY, BREAK_TIMES * usual);
  let slot = 0;
  return distinct.map((at, i) => {
    if (i > 0) slot += at - distinct[i - 1] > long ? 2 : 1;
    return { at, slot };
  });
}

/** Month or year starts, few enough to read, placed among the slots. */
function ticksFor(from: number, to: number, place: (ms: number) => number, spare: number): Tick[] {
  const days = (to - from) / DAY;
  const out: Tick[] = [];
  const start = new Date(from);
  const stepMonths = days <= 120 ? 1 : days <= 400 ? 3 : days <= 1100 ? 6 : 12;
  let at = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  let guard = 0;
  let last = -Infinity;
  while (at <= to && guard++ < 400) {
    const d = new Date(at);
    const x = place(at);
    if (d.getUTCMonth() % stepMonths === 0 && Number.isFinite(x) && x - last >= spare) {
      out.push({ at: x, iso: d.toISOString(), kind: d.getUTCMonth() === 0 ? "year" : "month" });
      last = x;
    }
    at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return out;
}

/** Several anchors in one picture: their node ids and, for each node, the anchors whose walk holds it. */
export type Anchoring = { ids: string[]; reach: Map<string, string[]> };

export function layoutWalk(walk: Walk, width: number, height: number, anchoring?: Anchoring): Layout {
  const multi = !!anchoring && anchoring.ids.length > 1;
  // Several anchors are always bands one above the other (the first anchor on top), so time runs across at any width.
  const along: "x" | "y" = width >= WIDE || multi ? "x" : "y";
  // u runs along time, v across it.
  const U = along === "x" ? width : height;
  const V = along === "x" ? height : width;
  // Only notes have a date; a tag is placed from the notes it holds, below.
  const times = walk.nodes.filter((n) => n.kind === "note").map((n) => Date.parse(n.at)).filter((t) => Number.isFinite(t));
  const from = times.length ? Math.min(...times) : null;
  const to = times.length ? Math.max(...times) : null;
  const span = from !== null && to !== null ? to - from : 0;
  const moments = slots(times);
  const last = moments.length ? moments[moments.length - 1].slot : 0;
  // Every slot is the same step from the next, the whole width used: the picture is as wide as the
  // notes need, whatever dates the oldest and the newest happen to have.
  const slotAt = (slot: number) => (last > 0 ? MARGIN + (slot / last) * (U - 2 * MARGIN) : U / 2);
  const exact = new Map(moments.map((o) => [o.at, slotAt(o.slot)]));
  /** Where a moment falls: on its note's slot, or between the slots either side of it. */
  const place = (ms: number): number => {
    const hit = exact.get(ms);
    if (hit !== undefined) return hit;
    if (!moments.length) return U / 2;
    if (ms <= moments[0].at) return slotAt(moments[0].slot);
    for (let i = 1; i < moments.length; i++) {
      if (ms <= moments[i].at) {
        const a = moments[i - 1];
        const b = moments[i];
        // Inside a break there is no place for a date; the break names its two ends.
        if (b.slot - a.slot > 1) return Number.NaN;
        return slotAt(a.slot) + ((ms - a.at) / (b.at - a.at)) * (slotAt(b.slot) - slotAt(a.slot));
      }
    }
    return slotAt(last);
  };
  const vLow = MARGIN * 0.6;
  const vHigh = V - MARGIN * 0.6;
  const clampV = (v: number) => Math.max(vLow, Math.min(vHigh, v));

  const byId = new Map(walk.nodes.map((n) => [n.id, n]));
  type P = { id: string; u: number; v: number; r: number; label: string };
  const at = new Map<string, P>();
  const kids = new Map<string, number>();

  // Several anchors: the picture is cut across the time axis into bands in the order of the set: an
  // anchor's own band, then a band for what its neighbours share, and so on. The first anchor stands at
  // the inner edge of the top band and the last at the inner edge of the bottom one, so the notes only
  // one of them reaches lie beyond it, away from the other, and the notes both reach lie between the two.
  type Zone = { lo: number; hi: number; row: number; r: number };
  const zones = new Map<string, Zone>();
  const bounds = new Map<string, [number, number]>();
  if (multi) {
    const ids = anchoring!.ids;
    const unit = (vHigh - vLow) / (ids.length * ZONE_WEIGHT + (ids.length - 1) * COMMON_WEIGHT);
    ids.forEach((id, k) => {
      const lo = vLow + unit * k * (ZONE_WEIGHT + COMMON_WEIGHT);
      const hi = lo + unit * ZONE_WEIGHT;
      const r = radius(byId.get(id)!) + 8;
      const row = k === 0 ? hi - r : k === ids.length - 1 ? lo + r : (lo + hi) / 2;
      zones.set(id, { lo, hi, row, r });
    });
  }

  // A tag stands where the notes it holds stand (else where its neighbouring tags do, else in the middle).
  const uOf = new Map<string, number>();
  for (const n of walk.nodes) {
    const ms = Date.parse(n.at);
    if (n.kind === "note" && Number.isFinite(ms)) uOf.set(n.id, place(ms));
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const n of walk.nodes) {
      if (n.kind !== "tag" || uOf.has(n.id)) continue;
      const near = walk.edges.flatMap((e) => (e.a === n.id ? [e.b] : e.b === n.id ? [e.a] : [])).filter((id) => uOf.has(id) && (pass > 0 || byId.get(id)?.kind === "note"));
      if (near.length) uOf.set(n.id, near.reduce((sum, id) => sum + uOf.get(id)!, 0) / near.length);
    }
  }

  // Outward from the centre: a node starts a step to one side of the one it came from.
  for (const n of [...walk.nodes].sort((a, b) => a.ring - b.ring || a.id.localeCompare(b.id))) {
    const u = uOf.get(n.id) ?? U / 2;
    let v = V / 2;
    if (multi) {
      const own = zones.get(n.id);
      const ids = anchoring!.ids;
      const held = (anchoring!.reach.get(n.id) ?? []).filter((a) => zones.has(a));
      if (own) {
        v = own.row;
        bounds.set(n.id, [own.row, own.row]);
      } else if (held.length >= 2) {
        const order = held.map((a) => ids.indexOf(a)).sort((x, y) => x - y);
        const first = zones.get(ids[order[0]])!;
        const lastZ = zones.get(ids[order[order.length - 1]])!;
        const lo = first.row + first.r;
        const hi = lastZ.row - lastZ.r;
        v = (lo + hi) / 2 + (hash(n.id) - 0.5) * (hi - lo) * 0.8;
        bounds.set(n.id, [lo, hi]);
      } else if (held.length === 1) {
        const z = zones.get(held[0])!;
        const k = kids.get(held[0]) ?? 0;
        kids.set(held[0], k + 1);
        const idx = ids.indexOf(held[0]);
        // Beyond the anchor, away from the others: above the first, below the last.
        const lo = idx === 0 ? z.lo + 3 : z.row + z.r;
        const hi = idx === 0 ? z.row - z.r : z.hi - 3;
        const far = Math.min(1, ((n.ring - 1) / 2) * 0.6 + hash(n.id) * 0.4);
        v = idx === 0 ? hi - (hi - lo) * far : lo + (hi - lo) * far;
        bounds.set(n.id, idx === 0 || idx === ids.length - 1 ? [lo, hi] : [z.lo + 3, z.hi - 3]);
        if (idx !== 0 && idx !== ids.length - 1) v = z.row + (k % 2 === 0 ? 1 : -1) * Math.min((z.hi - z.lo) / 2 - 6, STEP * (0.35 + 0.25 * n.ring));
      }
    } else if (n.from) {
      const parent = at.get(n.from)!;
      const k = kids.get(n.from) ?? 0;
      kids.set(n.from, k + 1);
      const away = parent.v <= V / 2 ? -1 : 1;
      const side = k % 2 === 0 ? away : -away;
      v = parent.v + side * (STEP * (0.55 + 0.45 * Math.ceil((k + 1) / 2)) + hash(n.id) * 18);
    }
    at.set(n.id, { id: n.id, u, v: clampV(v), r: radius(n), label: short(labelOf(n), along === "x" ? 22 : 15) });
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
      const b = bounds.get(p.id);
      p.v = clampV(b ? Math.max(b[0], Math.min(b[1], p.v)) : p.v);
      p.u = Math.max(MARGIN * 0.5, Math.min(U - MARGIN * 0.5, p.u));
    }
    if (!moved) break;
  }

  const placed = new Map<string, Placed>();
  for (const p of list) {
    const [x, y] = along === "x" ? [p.u, p.v] : [p.v, p.u];
    placed.set(p.id, { id: p.id, x, y, r: p.r, named: null, label: p.label });
  }

  // Names, most important first, each beside its bubble where it does not run into anything:
  // below, else above, else to the right, else to the left.
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const bodies = new Map<string, Box>([...placed.values()].map((p) => [p.id, { x0: p.x - p.r - 2, x1: p.x + p.r + 2, y0: p.y - p.r - 2, y1: p.y + p.r + 2 }]));
  const taken: Box[] = [];
  const inside = (b: Box) => b.x0 >= 2 && b.x1 <= width - 2 && b.y0 >= 2 && b.y1 <= height - 28;
  const boxAt = (p: Placed, side: Side): Box => {
    const w = p.label.length * 6.8 + 8;
    if (side === "below") return { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y + p.r + 2, y1: p.y + p.r + 18 };
    if (side === "above") return { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - p.r - 18, y1: p.y - p.r - 2 };
    if (side === "right") return { x0: p.x + p.r + 4, x1: p.x + p.r + 4 + w, y0: p.y - 9, y1: p.y + 9 };
    return { x0: p.x - p.r - 4 - w, x1: p.x - p.r - 4, y0: p.y - 9, y1: p.y + 9 };
  };
  const priority = [...walk.nodes].sort((a, b) => (a.ring === 0 ? -1 : b.ring === 0 ? 1 : 0) || (a.kind === b.kind ? a.ring - b.ring : a.kind === "tag" ? -1 : 1) || a.id.localeCompare(b.id));
  for (const n of priority) {
    const p = placed.get(n.id)!;
    const free = (box: Box) => inside(box) && !taken.some((t) => hit(box, t)) && ![...bodies].some(([id, t]) => id !== p.id && hit(box, t));
    const side = (["below", "above", "right", "left"] as Side[]).find((s) => free(boxAt(p, s)));
    // The centre and tags are always named, even over something; a note only where there is room.
    const chosen = side ?? (n.ring === 0 || n.kind === "tag" ? "below" : null);
    if (chosen) {
      p.named = chosen;
      taken.push(boxAt(p, chosen));
    }
  }

  const breaks: Break[] = [];
  for (let i = 1; i < moments.length; i++) {
    if (moments[i].slot - moments[i - 1].slot > 1) breaks.push({ at: (slotAt(moments[i].slot) + slotAt(moments[i - 1].slot)) / 2, from: new Date(moments[i - 1].at).toISOString(), to: new Date(moments[i].at).toISOString() });
  }
  const ticks = from !== null && to !== null && span > 0 ? ticksFor(from, to, place, 64) : [];
  return { placed, ticks, breaks, along, width, height };
}
