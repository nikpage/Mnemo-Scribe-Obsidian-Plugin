"use client";

// [Librarian, Guru]
import { useEffect, useMemo, useRef, useState } from "react";
import { allAnswered, useApi } from "@/lib/api";
import { useLang } from "@/hooks/use-lang";
import { formatDateShort, formatFactDate } from "@/lib/format";
import type { Walk, WalkEdge, WalkNode } from "@/lib/note/walk";
import { type Layout, layoutWalk } from "@/lib/note/walk-layout";
import { NoteLink } from "@/components/note-link";
import { PHRASE } from "@/components/note-links";
import { Button, Notice } from "@/components/ui";

/**
 * The walk (`lib/note/walk.ts`): the notes a few steps out from one tag or
 * note, time running along one axis, a tag's size its notes. Hover a thing and
 * what it touches stays lit, with its summary or its reason beside it; tap a
 * thing to walk there and the picture glides to the new neighbourhood. Drawn
 * as SVG so that the app and both plugins' panels draw the same picture. Free
 * of Next and server code.
 */

type Where = { tag: string } | { note: string };
type T = ReturnType<typeof useLang>["t"];
type Lang = ReturnType<typeof useLang>["lang"];

const url = (at: Where | null) => (!at ? "/api/notes/walk" : "tag" in at ? `/api/notes/walk?tag=${encodeURIComponent(at.tag)}` : `/api/notes/walk?note=${encodeURIComponent(at.note)}`);
const whereOf = (n: WalkNode): Where => (n.kind === "tag" ? { tag: n.name } : { note: n.note.id });
const nameOf = (n: WalkNode) => (n.kind === "tag" ? `#${n.name}` : n.note.title);
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const GLIDE_MS = 700;
const DIM = 0.16;

function wantsStill(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

type Mode = "stay" | "enter" | "leave";
type Drawn = { node: WalkNode; x0: number; y0: number; x1: number; y1: number; r: number; named: boolean; label: string; mode: Mode };
type Scene = { nodes: Map<string, Drawn>; edges: Map<string, { edge: WalkEdge; mode: Mode }>; walk: Walk; layout: Layout; /** The centre moved, so the picture glides and rings once. */ moved: boolean };

/**
 * What is on the screen and where it is going. A new walk keeps what both
 * share gliding from where it was, grows what is new out of the thing it was
 * reached from, and fades what has gone.
 */
function useGlide(walk: Walk | null, layout: Layout | null) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [k, setK] = useState(1);
  const clock = useRef({ at: 0, k: 1, raf: 0 });
  const drawnOnce = useRef(false);

  useEffect(() => {
    if (!walk || !layout) return;
    // The first drawing, and a reload, never move: only a tap does.
    const still = wantsStill() || !drawnOnce.current;
    drawnOnce.current = true;
    setScene((prev) => {
      const e = ease(clock.current.k);
      const shown = new Map<string, { x: number; y: number }>();
      for (const [id, d] of prev?.nodes ?? []) shown.set(id, { x: d.x0 + (d.x1 - d.x0) * e, y: d.y0 + (d.y1 - d.y0) * e });
      const nodes = new Map<string, Drawn>();
      const centre = layout.placed.get(walk.centre);
      for (const node of walk.nodes) {
        const p = layout.placed.get(node.id)!;
        const old = shown.get(node.id);
        const start = old ?? (node.from ? (shown.get(node.from) ?? layout.placed.get(node.from)) : undefined) ?? centre ?? p;
        nodes.set(node.id, { node, x0: still ? p.x : start.x, y0: still ? p.y : start.y, x1: p.x, y1: p.y, r: p.r, named: p.named, label: p.label, mode: old ? "stay" : "enter" });
      }
      const edges = new Map<string, { edge: WalkEdge; mode: Mode }>();
      for (const edge of walk.edges) edges.set(edge.id, { edge, mode: prev?.edges.has(edge.id) ? "stay" : "enter" });
      if (prev && !still) {
        for (const [id, d] of prev.nodes) {
          if (nodes.has(id) || d.mode === "leave") continue;
          const at = shown.get(id)!;
          nodes.set(id, { ...d, x0: at.x, y0: at.y, x1: at.x, y1: at.y, mode: "leave" });
        }
        for (const [id, held] of prev.edges) if (!edges.has(id) && held.mode !== "leave") edges.set(id, { edge: held.edge, mode: "leave" });
      }
      return { nodes, edges, walk, layout, moved: !!prev && prev.walk.centre !== walk.centre };
    });
    const c = clock.current;
    cancelAnimationFrame(c.raf);
    if (still) {
      c.k = 1;
      setK(1);
      return;
    }
    c.at = performance.now();
    c.k = 0;
    setK(0);
    const frame = (now: number) => {
      const x = Math.min(1, (now - c.at) / GLIDE_MS);
      c.k = x;
      setK(x);
      if (x < 1) c.raf = requestAnimationFrame(frame);
    };
    c.raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(c.raf);
  }, [walk, layout]);

  return { scene, e: ease(k) };
}

/** A line from one point to another, bowed a little so lines that share an end do not stack. */
function curve(ax: number, ay: number, bx: number, by: number, bow: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  return `M${ax} ${ay} Q${mx - dy * bow} ${my + dx * bow} ${bx} ${by}`;
}

export function WebView() {
  const { t, lang } = useLang();
  const [at, setAt] = useState<Where | null>(null);
  const [trail, setTrail] = useState<{ at: Where | null; name: string }[]>([]);
  const res = useApi<Walk>(url(at), { keepPreviousData: true });
  const walk = res.data ?? null;

  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!stage) return;
    const measure = () => setWidth(Math.round(stage.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage]);
  const height = width >= 640 ? Math.max(420, Math.min(640, Math.round(width * 0.52))) : Math.max(480, Math.min(780, Math.round(width * 1.4)));

  const layout = useMemo(() => (walk && width > 0 ? layoutWalk(walk, width, height) : null), [walk, width, height]);
  const { scene, e } = useGlide(walk, layout);

  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const touch = useRef(false);

  // What is lit: the thing pointed at and what touches it.
  const lit = useMemo(() => {
    const id = hover ?? picked;
    if (!id || !walk) return null;
    const nodes = new Set<string>();
    const edges = new Set<string>();
    const edge = walk.edges.find((x) => x.id === id);
    if (edge) {
      edges.add(edge.id);
      nodes.add(edge.a).add(edge.b);
    } else {
      nodes.add(id);
      for (const x of walk.edges) {
        if (x.a !== id && x.b !== id) continue;
        edges.add(x.id);
        nodes.add(x.a).add(x.b);
      }
    }
    return { id, nodes, edges };
  }, [hover, picked, walk]);

  if (!allAnswered(res)) return null;

  if (!walk || !scene) {
    const none = res.error && typeof res.error === "object" && "status" in res.error && (res.error as { status: number }).status === 404 && !at;
    return (
      <div>
        <h1 className="mb-2 text-2xl font-bold">{t("webTitle")}</h1>
        {res.error ? <Notice tone="error">{none ? t("webEmpty") : t("webFailed")}</Notice> : <div ref={setStage} className="w-full" />}
      </div>
    );
  }

  const centre = walk.nodes.find((n) => n.id === walk.centre)!;
  const go = (node: WalkNode) => {
    if (node.id === walk.centre) return;
    setTrail((tr) => [...tr, { at: whereOf(centre), name: nameOf(centre) }]);
    setAt(whereOf(node));
    setHover(null);
    setPicked(null);
  };
  const back = () => {
    const last = trail[trail.length - 1];
    if (!last) return;
    setTrail((tr) => tr.slice(0, -1));
    setAt(last.at);
    setHover(null);
    setPicked(null);
  };

  const pos = (d: Drawn) => {
    const a = d.mode === "leave" ? 1 - e : d.mode === "enter" ? e : 1;
    return { x: d.x0 + (d.x1 - d.x0) * e, y: d.y0 + (d.y1 - d.y0) * e, a };
  };
  const drawn = [...scene.nodes.values()].filter((d) => d.mode !== "leave" || e < 1);
  const where = new Map(drawn.map((d) => [d.node.id, pos(d)]));
  const dimOf = (id: string, kind: "node" | "edge") => (!lit ? 1 : (kind === "node" ? lit.nodes : lit.edges).has(id) ? 1 : DIM);
  const alone = walk.nodes.length === 1;

  const cardOf = lit ? (scene.nodes.get(lit.id)?.node ?? null) : null;
  const cardEdge = lit && !cardOf ? (walk.edges.find((x) => x.id === lit.id) ?? null) : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {trail.length > 0 && (
          <Button size="sm" variant="secondary" tip={trail[trail.length - 1].name} onClick={back}>
            {t("walkBack", { name: trail[trail.length - 1].name })}
          </Button>
        )}
        <h1 className="text-2xl font-bold">{nameOf(centre)}</h1>
        <span className="text-sm text-muted-foreground">
          {centre.kind === "tag" ? t("webNotes", { n: centre.count }) : formatDateShort(centre.at, lang)}
        </span>
        {centre.kind === "note" && (
          <NoteLink note={centre.note} className="ml-auto text-sm font-medium hover:underline">
            {t("walkOpen")}
          </NoteLink>
        )}
        {centre.kind === "tag" && centre.meaning && <p className="w-full text-sm text-muted-foreground">{centre.meaning}</p>}
        {centre.kind === "note" && centre.summary && <p className="w-full text-sm text-muted-foreground">{centre.summary}</p>}
      </div>

      <div ref={setStage} className="w-full overflow-hidden rounded-2xl border border-border bg-card" style={{ height, position: "relative" }}>
        {layout && (
          <svg width={layout.width} height={layout.height} role="img" aria-label={t("webTitle")} style={{ display: "block" }}>
            <defs>
              <filter id="walk-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>

            {layout.ticks.map((tick) => (
              <g key={tick.iso}>
                {layout.along === "x" ? (
                  <line x1={tick.at} x2={tick.at} y1={14} y2={layout.height - 30} className="stroke-border" strokeWidth={1} strokeDasharray="2 6" />
                ) : (
                  <line x1={14} x2={layout.width - 14} y1={tick.at} y2={tick.at} className="stroke-border" strokeWidth={1} strokeDasharray="2 6" />
                )}
                <text
                  x={layout.along === "x" ? tick.at : 16}
                  y={layout.along === "x" ? layout.height - 12 : tick.at - 5}
                  textAnchor={layout.along === "x" ? "middle" : "start"}
                  fontSize={11}
                  className="fill-current text-muted-foreground"
                >
                  {tick.kind === "year" ? tick.iso.slice(0, 4) : formatFactDate(tick.iso.slice(0, 7), lang)}
                </text>
              </g>
            ))}

            {[...scene.edges.values()].map(({ edge, mode }) => {
              const a = where.get(edge.a);
              const b = where.get(edge.b);
              if (!a || !b) return null;
              const alpha = (mode === "leave" ? 1 - e : mode === "enter" ? e : 1) * dimOf(edge.id, "edge");
              const d = curve(a.x, a.y, b.x, b.y, edge.kind === "under" ? 0.08 : 0.14);
              const look =
                edge.kind === "link"
                  ? { className: "stroke-primary", width: 2.2, dash: undefined }
                  : edge.kind === "under"
                    ? { className: "stroke-muted-foreground", width: 1.6, dash: undefined }
                    : edge.kind === "carries"
                      ? { className: "stroke-primary/60", width: 1.2, dash: undefined }
                      : { className: "stroke-muted-foreground", width: 1.4, dash: "1 6" };
              return (
                <g
                  key={edge.id}
                  opacity={alpha}
                  onPointerEnter={() => setHover(edge.id)}
                  onPointerLeave={() => setHover((h) => (h === edge.id ? null : h))}
                  onPointerDown={(ev) => {
                    touch.current = ev.pointerType === "touch";
                  }}
                  onClick={() => setPicked((p) => (p === edge.id ? null : edge.id))}
                >
                  <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
                  <path d={d} fill="none" className={look.className} strokeWidth={look.width} strokeLinecap="round" strokeDasharray={look.dash} />
                </g>
              );
            })}

            {drawn
              .sort((x, y) => (x.node.id === walk.centre ? 1 : 0) - (y.node.id === walk.centre ? 1 : 0))
              .map((d) => {
                const p = where.get(d.node.id)!;
                const isCentre = d.node.id === walk.centre;
                const tag = d.node.kind === "tag";
                const alpha = p.a * dimOf(d.node.id, "node");
                const open = () => {
                  if (touch.current && picked !== d.node.id) setPicked(d.node.id);
                  else go(d.node);
                };
                return (
                  <g
                    key={d.node.id}
                    transform={`translate(${p.x} ${p.y})`}
                    opacity={alpha}
                    style={{ cursor: "pointer", outline: "none" }}
                    role="button"
                    tabIndex={0}
                    aria-label={nameOf(d.node)}
                    onPointerEnter={(ev) => ev.pointerType !== "touch" && setHover(d.node.id)}
                    onPointerLeave={() => setHover((h) => (h === d.node.id ? null : h))}
                    onPointerDown={(ev) => {
                      touch.current = ev.pointerType === "touch";
                    }}
                    onClick={open}
                    onKeyDown={(ev) => ev.key === "Enter" && go(d.node)}
                  >
                    <circle r={d.r + (isCentre ? 12 : 7)} className="fill-primary/30" filter="url(#walk-glow)" />
                    {isCentre && scene.moved && e < 1 && <circle r={d.r + 8 + 46 * e} fill="none" className="stroke-primary" strokeWidth={2} opacity={0.7 * (1 - e)} />}
                    <circle r={d.r} className={tag ? "fill-primary/15 stroke-primary" : "fill-primary stroke-card"} strokeWidth={isCentre ? 3 : 1.6} />
                    {tag && d.node.kind === "tag" && (
                      <text textAnchor="middle" dy="0.35em" fontSize={Math.max(11, Math.min(15, d.r * 0.7))} fontWeight={600} className="fill-current">
                        {d.node.count}
                      </text>
                    )}
                    {d.named && (
                      <text
                        y={d.r + 15}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={tag || isCentre ? 600 : 400}
                        className="fill-current stroke-card"
                        strokeWidth={4}
                        paintOrder="stroke"
                        strokeLinejoin="round"
                      >
                        {d.label}
                      </text>
                    )}
                  </g>
                );
              })}
          </svg>
        )}

        {layout && cardOf && lit && <Card at={where.get(lit.id)} size={layout} onEnter={() => setHover(lit.id)} onLeave={() => setHover(null)}>{cardOf.kind === "note" ? <NoteCard node={cardOf} lang={lang} t={t} /> : <TagCard node={cardOf} t={t} />}</Card>}
        {layout && cardEdge && lit && (
          <Card
            at={midpoint(where.get(cardEdge.a), where.get(cardEdge.b))}
            size={layout}
            onEnter={() => setHover(lit.id)}
            onLeave={() => setHover(null)}
          >
            <EdgeCard edge={cardEdge} walk={walk} t={t} />
          </Card>
        )}
        {alone && <p className="text-center text-sm text-muted-foreground" style={{ position: "absolute", bottom: 40, left: 16, right: 16 }}>{t("walkAlone")}</p>}
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {[
          { text: t("walkKeyUnder"), stroke: "stroke-muted-foreground", dash: undefined, width: 2 },
          { text: t("walkKeyLink"), stroke: "stroke-primary", dash: undefined, width: 2.4 },
          { text: t("walkKeyShared"), stroke: "stroke-muted-foreground", dash: "1 5", width: 2 },
        ].map((k) => (
          <span key={k.text} className="inline-flex items-center gap-1">
            <svg width="24" height="8" aria-hidden="true">
              <line x1="2" y1="4" x2="22" y2="4" className={k.stroke} strokeWidth={k.width} strokeLinecap="round" strokeDasharray={k.dash} />
            </svg>
            {k.text}
          </span>
        ))}
      </div>
    </div>
  );
}

const midpoint = (a?: { x: number; y: number }, b?: { x: number; y: number }) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined);

/** A card beside the thing it describes, kept inside the picture; the pointer can move onto it. */
function Card({ at, size, onEnter, onLeave, children }: { at?: { x: number; y: number }; size: Layout; onEnter: () => void; onLeave: () => void; children: React.ReactNode }) {
  if (!at) return null;
  const W = Math.min(300, size.width - 16);
  const left = Math.max(8, Math.min(size.width - W - 8, at.x - W / 2));
  const above = at.y > size.height * 0.55;
  return (
    <div
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{ position: "absolute", left, width: W, ...(above ? { bottom: size.height - at.y + 6 } : { top: at.y + 6 }), paddingTop: above ? 0 : 16, paddingBottom: above ? 16 : 0, zIndex: 5 }}
    >
      <div className="rounded-2xl border border-border bg-card p-3 text-sm">{children}</div>
    </div>
  );
}

function NoteCard({ node, lang, t }: { node: Extract<WalkNode, { kind: "note" }>; lang: Lang; t: T }) {
  return (
    <div>
      <p className="font-medium">{node.note.title}</p>
      <p className="mb-1 text-xs text-muted-foreground">
        {formatDateShort(node.at, lang)}
        {node.tags.length > 0 && ` · ${node.tags.map((tag) => `#${tag}`).join(" ")}`}
      </p>
      {node.summary && <p className="mb-2 text-muted-foreground">{node.summary}</p>}
      <NoteLink note={node.note} className="font-medium hover:underline">
        {t("walkOpen")}
      </NoteLink>
    </div>
  );
}

function TagCard({ node, t }: { node: Extract<WalkNode, { kind: "tag" }>; t: T }) {
  return (
    <div>
      <p className="font-medium">
        #{node.name} <span className="text-muted-foreground" style={{ fontWeight: 400 }}>· {t("webNotes", { n: node.count })}</span>
      </p>
      {node.meaning && <p className="text-muted-foreground">{node.meaning}</p>}
    </div>
  );
}

/** Why one line is there, in words about the notes. */
function EdgeCard({ edge, walk, t }: { edge: WalkEdge; walk: Walk; t: T }) {
  const node = (id: string) => walk.nodes.find((n) => n.id === id);
  const a = node(edge.a);
  const b = node(edge.b);
  if (!a || !b) return null;
  if (edge.kind === "under" && a.kind === "tag" && b.kind === "tag") return <p>{t("webParentKept", { tag: a.name, parent: b.name })}</p>;
  if (edge.kind === "carries" && a.kind === "note" && b.kind === "tag") return <p>{t("walkCarries", { note: a.note.title, tag: b.name })}</p>;
  if (a.kind !== "note" || b.kind !== "note") return null;
  if (edge.kind === "link") {
    return (
      <p>
        <span className="font-medium">{a.note.title}</span> {t(PHRASE[edge.type ?? "revisits"].to)} <span className="font-medium">{b.note.title}</span>
        {edge.why && <span className="block text-muted-foreground">{edge.why}</span>}
      </p>
    );
  }
  return (
    <p>
      <span className="font-medium">{a.note.title}</span> · <span className="font-medium">{b.note.title}</span>
      <span className="block text-muted-foreground">{edge.kind === "subject" ? t("webSubject", { subject: edge.name ?? "" }) : t("webTheme", { theme: edge.name ?? "" })}</span>
    </p>
  );
}
