"use client";

// [Librarian, Guru]
import { useEffect, useMemo, useRef, useState } from "react";
import { preload } from "swr";
import type ForceGraph from "force-graph";
import type { LinkObject, NodeObject } from "force-graph";
import { forceCollide, forceX, forceY } from "d3-force";
import { allAnswered, api, useApi } from "@/lib/api";
import { useLang } from "@/hooks/use-lang";
import { formatDate } from "@/lib/format";
import type { Evidence, NoteRef, TagWeb, Web, WebEdge } from "@/lib/note/web";
import { NoteLink } from "@/components/note-link";
import { PHRASE } from "@/components/note-links";
import { Button, Notice } from "@/components/ui";

/**
 * The web (`lib/note/web.ts`): every tag in use as a glowing bubble sized by
 * its notes, with the tags it sits under and the bridges between areas that
 * share no tag. Tap a tag: it grows open with its notes, their links and the
 * tags its bridges reach; tap one of those to cross the bridge. Tap a line or
 * a note: why it is there. Hover or hold one thing and what it touches lights
 * up while the rest dims. Bubbles can be dragged and spring back; note links
 * carry a flowing light from the later note to the earlier. Drawn on a canvas
 * by `force-graph`, live physics. Free of Next and server code: the plugins
 * draw it too.
 */

const webUrl = (tag: string) => `/api/notes/web?tag=${encodeURIComponent(tag)}`;

type Link = Extract<Evidence, { kind: "link" }>;

/** Why a line is drawn, as its explanation says it. */
type Why =
  | { kind: "parent"; edge: WebEdge; meaning: string | null }
  | { kind: "bridge"; a: string; b: string; n: number; evidence: Evidence[]; follow: string[] }
  | { kind: "link"; link: Link }
  | { kind: "carries"; note: NoteRef; tags: string[] };

type Dot = { id: string; kind: "tag" | "centre" | "note"; label: string; r: number; note?: NoteRef; noteTags?: string[]; tag?: string; count?: number };
type Line = { id: string; a: string; b: string; look: "kept" | "asked" | "bridge" | "link" | "carries"; length: number; pull: number; why: Why };

type GNode = NodeObject & { id: string; dot: Dot; born: number };
type GLink = LinkObject<GNode> & { id: string; line: Line };
type Graph = ForceGraph<GNode, GLink>;
type T = ReturnType<typeof useLang>["t"];

/** A start for each dot from its name alone, so a new tag leaves the others where they were. */
function seed(name: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const angle = (((h >>> 0) % 3600) / 3600) * 2 * Math.PI;
  const radius = 40 + ((h >>> 12) % 240);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

const short = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const tagRadius = (count: number) => Math.min(48, 6 + 5 * Math.sqrt(count));

/** The whole web as dots and lines. */
function wholeShape(web: Web): { dots: Dot[]; lines: Line[] } {
  const meaning = new Map(web.tags.map((tag) => [tag.name, tag.meaning]));
  const dots: Dot[] = web.tags.map((tag) => ({ id: `t:${tag.name}`, kind: "tag", label: `#${tag.name}`, r: tagRadius(tag.count), tag: tag.name, count: tag.count }));
  const lines: Line[] = [
    ...web.edges.map((edge): Line => ({
      id: `p:${edge.tag}\n${edge.parent}`,
      a: `t:${edge.tag}`,
      b: `t:${edge.parent}`,
      look: edge.kept ? "kept" : "asked",
      length: 70,
      pull: edge.kept ? 0.6 : 0.2,
      why: { kind: "parent", edge, meaning: meaning.get(edge.tag) ?? null },
    })),
    ...web.bridges.map((bridge): Line => ({
      id: `b:${bridge.a}\n${bridge.b}`,
      a: `t:${bridge.a}`,
      b: `t:${bridge.b}`,
      look: "bridge",
      length: 180,
      pull: 0.05,
      why: { kind: "bridge", a: bridge.a, b: bridge.b, n: bridge.n, evidence: bridge.evidence, follow: [bridge.a, bridge.b] },
    })),
  ];
  return { dots, lines };
}

/** One tag at the centre, its notes around it, and the tags its bridges reach. */
function centreShape(web: TagWeb): { dots: Dot[]; lines: Line[] } {
  const centre = `t:${web.tag}`;
  const inside = new Set(web.notes.map((note) => note.id));
  const dots: Dot[] = [
    { id: centre, kind: "centre", label: `#${web.tag}`, r: tagRadius(web.notes.length), tag: web.tag, count: web.notes.length },
    ...web.notes.map((note): Dot => ({ id: `n:${note.id}`, kind: "note", label: short(note.title), r: 6, note, noteTags: note.tags })),
    ...web.bridges.map((bridge): Dot => ({ id: `t:${bridge.tag}`, kind: "tag", label: `#${bridge.tag}`, r: 9, tag: bridge.tag })),
  ];
  const lines: Line[] = [
    ...web.notes.map((note): Line => ({
      id: `c:${note.id}`,
      a: centre,
      b: `n:${note.id}`,
      look: "carries",
      length: 110,
      pull: 0.3,
      why: { kind: "carries", note, tags: note.tags },
    })),
    ...web.links.map((link): Line => ({
      id: `l:${link.from.id}\n${link.to.id}\n${link.type}`,
      a: `n:${link.from.id}`,
      b: `n:${link.to.id}`,
      look: "link",
      length: 50,
      pull: 0.5,
      why: { kind: "link", link },
    })),
  ];
  // A bridge leaves from each note inside that its evidence names.
  for (const bridge of web.bridges) {
    const byNote = new Map<string, Evidence[]>();
    for (const e of bridge.evidence) {
      const ends = e.kind === "link" ? [e.from, e.to] : e.notes;
      const own = ends.find((note) => inside.has(note.id));
      if (own) byNote.set(own.id, [...(byNote.get(own.id) ?? []), e]);
    }
    for (const [id, evidence] of byNote)
      lines.push({
        id: `b:${id}\n${bridge.tag}`,
        a: `n:${id}`,
        b: `t:${bridge.tag}`,
        look: "bridge",
        length: 140,
        pull: 0.15,
        why: { kind: "bridge", a: web.tag, b: bridge.tag, n: evidence.length, evidence, follow: [bridge.tag] },
      });
  }
  return { dots, lines };
}

/** The page's own colours, read from probes so the canvas follows the theme in the app and in a plugin's panel. */
type Palette = { text: string; muted: string; primary: string; danger: string; card: string; line: string; font: string };

function readPalette(probes: HTMLElement): Palette {
  const [primary, muted, danger, card, line] = Array.from(probes.children) as HTMLElement[];
  const root = getComputedStyle(probes);
  return {
    text: root.color,
    font: root.fontFamily,
    primary: getComputedStyle(primary).color,
    muted: getComputedStyle(muted).color,
    danger: getComputedStyle(danger).color,
    card: getComputedStyle(card).backgroundColor,
    line: getComputedStyle(line).borderTopColor,
  };
}

/** What stays lit: the thing held or hovered and what touches it. */
type Focus = { nodes: Set<string>; links: Set<string>; lit: string | null };

/** What the canvas callbacks read; changed only by handlers and effects. */
type Live = {
  palette: Palette;
  t: T;
  animate: boolean;
  shape: unknown;
  nodes: Map<string, GNode>;
  lines: Map<string, Line>;
  adj: Map<string, [string, string][]>;
  hot: string | null;
  hoverLink: string | null;
  selNode: string | null;
  selLine: string | null;
  focus: Focus | null;
  touched: boolean;
  fitUntil: number;
  openedAt: number;
};

function focusOf(L: Live): Focus | null {
  const f: Focus = { nodes: new Set(), links: new Set(), lit: null };
  const node = L.hot ?? L.selNode;
  if (node) {
    f.lit = node;
    f.nodes.add(node);
    for (const [line, other] of L.adj.get(node) ?? []) {
      f.links.add(line);
      f.nodes.add(other);
    }
    return f;
  }
  const line = L.hoverLink ?? L.selLine;
  const l = line ? L.lines.get(line) : undefined;
  if (!l) return null;
  f.links.add(l.id);
  f.nodes.add(l.a).add(l.b);
  return f;
}

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const DIM = 0.14;

/** Motion is for people who have not asked for less of it. */
function wantsStill(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const KEY: { look: Line["look"]; text: "webKeyKept" | "webKeyAsked" | "webKeyBridge" | "webKeyLink"; stroke: string; dash?: string }[] = [
  { look: "kept", text: "webKeyKept", stroke: "stroke-muted-foreground" },
  { look: "asked", text: "webKeyAsked", stroke: "stroke-muted-foreground", dash: "5 4" },
  { look: "bridge", text: "webKeyBridge", stroke: "stroke-destructive", dash: "2 3" },
  { look: "link", text: "webKeyLink", stroke: "stroke-primary" },
];

export function WebView() {
  const { t, lang } = useLang();
  const [centre, setCentre] = useState<string | null>(null);
  const [engine, setEngine] = useState<Graph | null>(null);
  const [sel, setSel] = useState<{ of: unknown; why: Why } | null>(null);
  const whole = useApi<Web>("/api/notes/web");
  // The tag last opened stays drawn until the next one has answered.
  const around = useApi<TagWeb>(centre ? webUrl(centre) : null, { keepPreviousData: true });
  const centred = centre ? around.data ?? null : null;

  const shape = useMemo(() => (centred ? centreShape(centred) : whole.data ? wholeShape(whole.data) : null), [centred, whole.data]);
  const stageOn = allAnswered(whole) && !!shape && shape.dots.length > 0;

  const stage = useRef<HTMLDivElement>(null);
  const probes = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);

  // The canvas: made once the picture has something to show.
  useEffect(() => {
    if (!stageOn || !stage.current || !probes.current) return;
    const el = stage.current;
    const probe = probes.current;
    const L: Live = {
      palette: readPalette(probe),
      t,
      animate: !wantsStill(),
      shape: null,
      nodes: new Map(),
      lines: new Map(),
      adj: new Map(),
      hot: null,
      hoverLink: null,
      selNode: null,
      selLine: null,
      focus: null,
      touched: false,
      fitUntil: 0,
      openedAt: 0,
    };
    live.current = L;
    let dead = false;
    let g: Graph | null = null;
    const watchers: (() => void)[] = [];

    void import("force-graph").then(({ default: ForceGraphClass }) => {
      if (dead) return;
      const pick = (why: Why | null, ids: { node?: string; line?: string }) => {
        L.selNode = ids.node ?? null;
        L.selLine = ids.line ?? null;
        L.focus = focusOf(L);
        setSel(why ? { of: L.shape, why } : null);
      };
      const graph: Graph = new ForceGraphClass<GNode, GLink>(el);
      g = graph;
      const sized = () => graph.width(el.clientWidth).height(el.clientHeight);
      sized();
      const ro = new ResizeObserver(sized);
      ro.observe(el);
      watchers.push(() => ro.disconnect());
      const retheme = () => {
        L.palette = readPalette(probe);
        graph.resumeAnimation();
      };
      const mo = new MutationObserver(retheme);
      for (const target of [document.documentElement, document.body]) mo.observe(target, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
      const dark = window.matchMedia("(prefers-color-scheme: dark)");
      dark.addEventListener("change", retheme);
      watchers.push(() => {
        mo.disconnect();
        dark.removeEventListener("change", retheme);
      });

      graph
        .nodeRelSize(1)
        .nodeVal((n) => n.dot.r * n.dot.r)
        .nodeLabel((n) => {
          const d = n.dot;
          if (d.kind === "note") return esc(d.note?.title ?? d.label);
          return `<b>#${esc(d.tag ?? "")}</b>${d.count !== undefined ? ` · ${esc(L.t("webNotes", { n: d.count }))}` : ""}<br/>${esc(L.t("tipWebTag"))}`;
        })
        .linkLabel((l) => {
          const w = l.line.why;
          const what =
            w.kind === "parent"
              ? L.t(w.edge.kept ? "webParentKept" : "webParentAsked", { tag: w.edge.tag, parent: w.edge.parent })
              : w.kind === "bridge"
                ? `#${w.a} ↔ #${w.b} · ${L.t("webKeyBridge")}`
                : w.kind === "link"
                  ? `${w.link.from.title} ${L.t(PHRASE[w.link.type].to)} ${w.link.to.title}`
                  : w.note.title;
          return `${esc(what)}<br/>${esc(L.t("tipWebLine"))}`;
        })
        .nodeCanvasObjectMode(() => "replace")
        .nodeCanvasObject((n, ctx, gs) => {
          const p = L.palette;
          const d = n.dot;
          const f = L.focus;
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const grow = L.animate ? ease(Math.min(1, (performance.now() - n.born) / 450)) : 1;
          const r = d.r * (0.5 + 0.5 * grow);
          const near = !f || f.nodes.has(n.id);
          const lit = f?.lit === n.id || d.kind === "centre";
          const alpha = (near ? 1 : DIM) * grow;
          ctx.save();
          if (d.kind === "note") {
            ctx.globalAlpha = alpha * 0.25;
            ctx.fillStyle = p.primary;
            ctx.beginPath();
            ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
            ctx.fill();
            ctx.globalAlpha = alpha;
            ctx.shadowColor = p.primary;
            ctx.shadowBlur = (lit ? 16 : 8) * gs;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fill();
          } else {
            // a soft halo, a glassy body, a ring
            ctx.globalAlpha = alpha;
            ctx.shadowColor = p.primary;
            ctx.shadowBlur = (lit ? 30 : 14) * gs;
            ctx.fillStyle = p.card;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fill();
            ctx.shadowBlur = 0;
            const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
            body.addColorStop(0, p.card);
            body.addColorStop(1, p.primary);
            ctx.globalAlpha = alpha * (lit ? 0.5 : 0.3);
            ctx.fillStyle = body;
            ctx.fill();
            ctx.globalAlpha = alpha * (lit ? 1 : 0.7);
            ctx.strokeStyle = p.primary;
            ctx.lineWidth = d.kind === "centre" ? 2.5 : 1.5;
            ctx.stroke();
            if (d.kind === "centre" && L.animate) {
              const k = (performance.now() - L.openedAt) / 900;
              if (k >= 0 && k < 1) {
                ctx.globalAlpha = 0.7 * (1 - k);
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, r + 30 * ease(k), 0, 2 * Math.PI);
                ctx.stroke();
              }
            }
          }
          ctx.restore();
          if (!near && !lit) return;
          ctx.save();
          ctx.textAlign = "center";
          if (d.count !== undefined && r * gs >= 14) {
            ctx.font = `600 ${r >= 28 ? 14 : 11}px ${p.font}`;
            ctx.textBaseline = "middle";
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.text;
            ctx.fillText(String(d.count), x, y);
          }
          const label = d.kind !== "note" ? r * gs >= 7 || lit : gs >= 1.3 || lit || !!f;
          if (label) {
            const size = (d.kind === "note" ? 11 : 12.5) / Math.max(gs, 0.6);
            ctx.font = `${d.kind === "note" ? 400 : 600} ${size}px ${p.font}`;
            ctx.textBaseline = "top";
            ctx.globalAlpha = alpha;
            ctx.lineJoin = "round";
            ctx.lineWidth = 3 / Math.max(gs, 0.6);
            ctx.strokeStyle = p.card;
            ctx.strokeText(d.label, x, y + r + 4);
            ctx.fillStyle = d.kind === "note" ? p.muted : p.text;
            ctx.fillText(d.label, x, y + r + 4);
          }
          ctx.restore();
        })
        .nodePointerAreaPaint((n, color, ctx, gs) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, n.dot.r + Math.max(6, 14 / gs), 0, 2 * Math.PI);
          ctx.fill();
        })
        .linkCanvasObjectMode(() => "replace")
        .linkCanvasObject((l, ctx) => {
          const a = l.source as GNode;
          const b = l.target as GNode;
          if (typeof a !== "object" || typeof b !== "object") return;
          const p = L.palette;
          const f = L.focus;
          const on = !!f?.links.has(l.id);
          const look = l.line.look;
          ctx.save();
          ctx.globalAlpha = f ? (on ? 1 : DIM) : look === "carries" ? 0.8 : 0.7;
          ctx.strokeStyle = look === "bridge" ? p.danger : look === "link" ? p.primary : look === "carries" ? p.line : p.muted;
          ctx.lineWidth = on ? 3 : look === "carries" ? 1 : 1.6;
          ctx.lineCap = "round";
          ctx.setLineDash(look === "asked" ? [5, 4] : look === "bridge" ? [2, 4] : []);
          ctx.beginPath();
          ctx.moveTo(a.x ?? 0, a.y ?? 0);
          ctx.lineTo(b.x ?? 0, b.y ?? 0);
          ctx.stroke();
          ctx.restore();
        })
        .linkPointerAreaPaint((l, color, ctx, gs) => {
          const a = l.source as GNode;
          const b = l.target as GNode;
          if (typeof a !== "object" || typeof b !== "object") return;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(8, 16 / gs);
          ctx.beginPath();
          ctx.moveTo(a.x ?? 0, a.y ?? 0);
          ctx.lineTo(b.x ?? 0, b.y ?? 0);
          ctx.stroke();
        })
        .linkDirectionalParticles((l) => (L.animate && (l.line.look === "link" || l.line.look === "bridge") ? 2 : 0))
        .linkDirectionalParticleSpeed(0.005)
        .linkDirectionalParticleWidth(3)
        .linkDirectionalParticleColor((l) => (l.line.look === "bridge" ? L.palette.danger : L.palette.primary))
        .onRenderFramePre((ctx, gs) => {
          if (gs < 0.35) return;
          const inv = ctx.getTransform().inverse();
          const from = inv.transformPoint(new DOMPoint(0, 0));
          const to = inv.transformPoint(new DOMPoint(ctx.canvas.width, ctx.canvas.height));
          const step = 26;
          if (((to.x - from.x) / step) * ((to.y - from.y) / step) > 8000) return;
          ctx.save();
          ctx.fillStyle = L.palette.line;
          ctx.globalAlpha = 0.8;
          for (let x = Math.floor(from.x / step) * step; x < to.x; x += step)
            for (let y = Math.floor(from.y / step) * step; y < to.y; y += step) ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
          ctx.restore();
        })
        .onNodeHover((n) => {
          L.hot = n ? n.id : null;
          L.focus = focusOf(L);
          if (n?.dot.kind === "tag" && n.dot.tag) void preload(webUrl(n.dot.tag), api);
        })
        .onLinkHover((l) => {
          L.hoverLink = l ? l.id : null;
          L.focus = focusOf(L);
        })
        .onNodeClick((n) => {
          const d = n.dot;
          if (d.kind === "tag" && d.tag) {
            pick(null, {});
            L.hot = null;
            L.focus = null;
            setCentre(d.tag);
          } else if (d.note) pick({ kind: "carries", note: d.note, tags: d.noteTags ?? [] }, { node: n.id });
          else pick(null, {});
        })
        .onLinkClick((l) => pick(l.line.why, { line: l.id }))
        .onBackgroundClick(() => pick(null, {}))
        .onEngineTick(() => {
          if (!L.touched && performance.now() < L.fitUntil) graph.zoomToFit(0, 70);
        })
        .onEngineStop(() => {
          if (!L.touched) graph.zoomToFit(L.animate ? 700 : 0, 70);
        })
        .minZoom(0.2)
        .maxZoom(8)
        .d3AlphaDecay(0.02)
        .d3VelocityDecay(0.3)
        .cooldownTime(8000);
      const link = graph.d3Force("link");
      link?.distance((l: GLink) => l.line.length).strength((l: GLink) => l.line.pull);
      graph.d3Force("charge")?.strength(-180);
      graph.d3Force("collide", forceCollide<GNode>((n) => n.dot.r + 16) as never);
      graph.d3Force("x", forceX<GNode>(0).strength(0.05) as never);
      graph.d3Force("y", forceY<GNode>(0).strength(0.05) as never);
      setEngine(graph);
    });

    return () => {
      dead = true;
      for (const stop of watchers) stop();
      g?._destructor();
      el.replaceChildren();
      live.current = null;
      setEngine(null);
    };
  }, [stageOn]); // eslint-disable-line react-hooks/exhaustive-deps -- `t` is kept fresh below; the canvas is made once

  // A new picture: bubbles that were there stay where they were and glide; new ones burst out of the tag that opened.
  useEffect(() => {
    const L = live.current;
    if (!engine || !L || !shape) return;
    L.t = t;
    L.shape = shape;
    L.animate = !wantsStill();
    const now = performance.now();
    const origin = centred ? L.nodes.get(`t:${centred.tag}`) : undefined;
    const nodes = shape.dots.map((dot): GNode => {
      const old = L.nodes.get(dot.id);
      let n = old;
      if (!n) {
        const [sx, sy] = seed(dot.id);
        const k = origin ? 0.12 : 1;
        n = { id: dot.id, dot, born: now, x: (origin?.x ?? 0) + sx * k, y: (origin?.y ?? 0) + sy * k };
      }
      n.dot = dot;
      if (dot.kind === "centre") {
        n.fx = n.x;
        n.fy = n.y;
      } else {
        n.fx = undefined;
        n.fy = undefined;
      }
      return n;
    });
    L.nodes = new Map(nodes.map((n) => [n.id, n]));
    L.lines = new Map(shape.lines.map((line) => [line.id, line]));
    L.adj = new Map();
    for (const line of shape.lines)
      for (const [from, to] of [[line.a, line.b], [line.b, line.a]] as const) L.adj.set(from, [...(L.adj.get(from) ?? []), [line.id, to]]);
    L.hot = L.hoverLink = L.selNode = L.selLine = null;
    L.focus = null;
    L.touched = false;
    L.fitUntil = now + 1400;
    L.openedAt = now;
    engine
      .warmupTicks(L.animate ? 0 : 300)
      .cooldownTicks(L.animate ? Infinity : 0)
      .graphData({ nodes, links: shape.lines.map((line): GLink => ({ id: line.id, source: line.a, target: line.b, line })) });
  }, [engine, shape, centred, t]);

  const header = centred ? (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-bold">#{centred.tag}</h1>
      <span className="text-sm text-muted-foreground">{t("webNotes", { n: centred.notes.length })}</span>
      <Button size="sm" variant="secondary" tip={t("tipWebWhole")} onClick={() => setCentre(null)} className="ml-auto">
        {t("webWhole")}
      </Button>
      {centred.meaning && <p className="w-full text-sm text-muted-foreground">{centred.meaning}</p>}
    </div>
  ) : (
    <div className="mb-3">
      <h1 className="mb-1 text-2xl font-bold">{t("webTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("webWhat")}</p>
    </div>
  );

  if (!allAnswered(whole)) return null;

  if (!shape || shape.dots.length === 0)
    return (
      <div>
        {header}
        {whole.error ? <Notice tone="error">{t("webFailed")}</Notice> : <p className="text-sm text-muted-foreground">{t("webEmpty")}</p>}
      </div>
    );

  const picked = sel && sel.of === shape ? sel.why : null;

  return (
    <div>
      {header}
      {around.error && centre && <Notice tone="error">{t("webFailed")}</Notice>}
      <p className="mb-2 text-xs text-muted-foreground">{t("webHint")}</p>
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {KEY.map((k) => (
          <span key={k.look} className="inline-flex items-center gap-1">
            <svg width="22" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="21" y2="4" className={k.stroke} strokeWidth="2" strokeLinecap="round" strokeDasharray={k.dash} />
            </svg>
            {t(k.text)}
          </span>
        ))}
      </div>
      <div ref={probes} hidden aria-hidden="true">
        <span className="text-primary" />
        <span className="text-muted-foreground" />
        <span className="text-destructive" />
        <span className="bg-card" />
        <span className="border border-border" />
      </div>
      <div
        ref={stage}
        role="img"
        aria-label={t("webTitle")}
        className="h-[60vh] w-full touch-none select-none overflow-hidden rounded-2xl border border-border bg-card md:h-[70vh]"
        onPointerDown={() => {
          if (live.current) live.current.touched = true;
        }}
        onWheel={() => {
          if (live.current) live.current.touched = true;
        }}
      />
      {picked && (
        <div className="mt-3 rounded-2xl border border-border bg-card p-3 text-sm" aria-live="polite">
          <Explain why={picked} onOpen={(tag) => setCentre(tag)} lang={lang} t={t} />
        </div>
      )}
    </div>
  );
}

/** What one line says about itself. */
function Explain({ why, onOpen, lang, t }: { why: Why; onOpen: (tag: string) => void; lang: ReturnType<typeof useLang>["lang"]; t: T }) {
  if (why.kind === "parent") {
    const { edge } = why;
    return (
      <p>
        {t(edge.kept ? "webParentKept" : "webParentAsked", { tag: edge.tag, parent: edge.parent })}
        {why.meaning && <span className="block text-muted-foreground">#{edge.tag}: {why.meaning}</span>}
        {!edge.kept && edge.why && <span className="block text-muted-foreground">{edge.why}</span>}
        {edge.kept && edge.at && <span className="block text-muted-foreground">{t("webKeptOn", { date: formatDate(edge.at, lang) })}</span>}
      </p>
    );
  }
  if (why.kind === "link") return <LinkLine link={why.link} t={t} />;
  if (why.kind === "carries")
    return (
      <p>
        <NoteLink note={why.note} className="font-medium hover:underline">
          {why.note.title}
        </NoteLink>{" "}
        {t("webCarries", { tags: why.tags.map((tag) => `#${tag}`).join(", ") })}
      </p>
    );
  return (
    <div>
      <p className="mb-2">{t("webBridge", { a: why.a, b: why.b })}</p>
      <ul className="mb-2 space-y-1">
        {why.evidence.map((e, i) => (
          <li key={i}>
            {e.kind === "link" ? (
              <LinkLine link={e} t={t} />
            ) : (
              <span>
                <NoteLink note={e.notes[0]} className="font-medium hover:underline">
                  {e.notes[0].title}
                </NoteLink>
                {" · "}
                <NoteLink note={e.notes[1]} className="font-medium hover:underline">
                  {e.notes[1].title}
                </NoteLink>
                {": "}
                {e.kind === "subject" ? t("webSubject", { subject: e.subject }) : t("webTheme", { theme: e.theme })}
              </span>
            )}
          </li>
        ))}
      </ul>
      {why.n > why.evidence.length && <p className="mb-2 text-muted-foreground">{t("webMore", { n: why.n - why.evidence.length })}</p>}
      <div className="flex flex-wrap gap-2">
        {why.follow.map((tag) => (
          <Button key={tag} size="sm" variant="secondary" tip={t("tipWebFollow")} onClick={() => onOpen(tag)}>
            {t("webFollow", { tag })}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** A note link, read from the later note to the earlier, with its reason. */
function LinkLine({ link, t }: { link: Link; t: T }) {
  return (
    <span>
      <NoteLink note={link.from} className="font-medium hover:underline">
        {link.from.title}
      </NoteLink>{" "}
      {t(PHRASE[link.type].to)}{" "}
      <NoteLink note={link.to} className="font-medium hover:underline">
        {link.to.title}
      </NoteLink>
      {link.reason && <span className="text-muted-foreground"> — {link.reason}</span>}
    </span>
  );
}
