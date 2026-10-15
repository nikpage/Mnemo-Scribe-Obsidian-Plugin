"use client";

// [Librarian, Guru]
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR, { preload } from "swr";
import { allAnswered, api, useApi } from "@/lib/api";
import { useLang } from "@/hooks/use-lang";
import { formatDateShort, formatFactDate } from "@/lib/format";
import { type Walk, type WalkEdge, type WalkNode, type WalkStore, WALK_STORE_URL, buildWalk, defaultCentre, inputOf } from "@/lib/note/walk";
import { type Layout, type Side, layoutWalk } from "@/lib/note/walk-layout";
import { type Share, mergeWalks } from "@/lib/note/walk-set";
import { LEVEL_WIDTH, type Row, connectionsOf, drawOrder, isStruck, levelColour, levelOfRing, listOf, nameOf, shownOf } from "@/lib/note/walk-levels";
import { ShareGlyph, ShareMark, WalkList } from "@/components/walk-list";
import { NoteLink } from "@/components/note-link";
import { PHRASE } from "@/components/note-links";
import { Button, Notice } from "@/components/ui";
import { showPicture } from "@/lib/note/web-picture";
import type { WebSet } from "@/lib/note/web-set";

/**
 * The walk (`lib/note/walk.ts`): the notes a few steps out from one tag or
 * note, time running along one axis, a tag's size its notes. Hover a thing and
 * what it touches stays lit, with its summary or its reason beside it; tap a
 * thing to walk there and the picture glides to the new neighbourhood. Drawn
 * as SVG so that the app and both plugins' panels draw the same picture. Beside
 * it (under it on a phone, one swipe away) a list of the same walk, whose rows
 * light and walk the picture. Three levels, three colours (`walk-levels.ts`).
 * Free of Next and server code.
 */

type Where = { tag: string } | { note: string };
type T = ReturnType<typeof useLang>["t"];
type Lang = ReturnType<typeof useLang>["lang"];

/** One request for the walks of a set; a tag no note carries any more is left out, and only when none is left does it fail. */
const walksKey = (urls: string[]) => `walks:${urls.join("|")}`;
async function fetchWalks(key: string): Promise<Walk[]> {
  let failed: unknown;
  const got = await Promise.all(
    key
      .slice("walks:".length)
      .split("|")
      .map((u) => api<Walk>(u).catch((e: unknown) => ((failed ??= e), null))),
  );
  const walks = got.filter((w): w is Walk => !!w);
  if (!walks.length) throw failed;
  return walks;
}
const url = (at: Where | null) => (!at ? "/api/notes/walk" : "tag" in at ? `/api/notes/walk?tag=${encodeURIComponent(at.tag)}` : `/api/notes/walk?note=${encodeURIComponent(at.note)}`);
const whereOf = (n: WalkNode): Where => (n.kind === "tag" ? { tag: n.name } : { note: n.note.id });
/** Slow in, quick through the middle, slow out: no jolt at the start, no long tail at the end. */
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const GLIDE_MS = 520;
const NO_TAGS: string[] = [];
const DIM = 0.07;
/** How long a pointer must rest on a bubble before it lights, and how long after leaving the picture before it lets go. */
const REST_MS = 90;
const LET_GO_MS = 400;
/** The box under the picture holds one fixed height, so what it says never moves the legend; long lists scroll inside it. */
const STRIP_H = 176;
/** Room for the list beside the picture. */
const SIDE_MIN = 980;
const SIDE_W = 340;

function wantsStill(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

type Mode = "stay" | "enter" | "leave";
type Drawn = { node: WalkNode; x0: number; y0: number; x1: number; y1: number; r: number; named: Side | null; label: string; mode: Mode };
type Scene = { nodes: Map<string, Drawn>; edges: Map<string, { edge: WalkEdge; mode: Mode }>; walk: Walk; layout: Layout; /** The centre moved, so the picture rings once. */ moved: boolean; /** Whether it glides to its places; the first drawing and reduced motion do not. */ animate: boolean };

/**
 * What is on the screen and where it is going. A new walk keeps what both
 * share gliding from where it was, grows what is new out of the thing it was
 * reached from, and fades what has gone.
 */
function useGlide(walk: Walk | null, layout: Layout | null) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [k, setK] = useState(1);
  const [reduced] = useState(wantsStill);

  // A new walk (or a new size) replaces the picture while it is being drawn, from where everything is
  // right now, even part-way through a move. The very first drawing, and a reload, never move.
  if (walk && layout && (!scene || scene.walk !== walk || scene.layout !== layout)) {
    const still = reduced || !scene;
    const e0 = ease(k);
    const shown = new Map<string, { x: number; y: number }>();
    for (const [id, d] of scene?.nodes ?? []) shown.set(id, { x: d.x0 + (d.x1 - d.x0) * e0, y: d.y0 + (d.y1 - d.y0) * e0 });

    const nodes = new Map<string, Drawn>();
    const centre = layout.placed.get(walk.centre);
    for (const node of walk.nodes) {
      const p = layout.placed.get(node.id)!;
      const old = shown.get(node.id);
      const start = old ?? (node.from ? (shown.get(node.from) ?? layout.placed.get(node.from)) : undefined) ?? centre ?? p;
      nodes.set(node.id, { node, x0: still ? p.x : start.x, y0: still ? p.y : start.y, x1: p.x, y1: p.y, r: p.r, named: p.named, label: p.label, mode: old ? "stay" : "enter" });
    }
    const edges = new Map<string, { edge: WalkEdge; mode: Mode }>();
    for (const edge of walk.edges) edges.set(edge.id, { edge, mode: scene?.edges.has(edge.id) ? "stay" : "enter" });
    if (scene && !still) {
      for (const [id, d] of scene.nodes) {
        if (nodes.has(id) || d.mode === "leave") continue;
        const at = shown.get(id)!;
        nodes.set(id, { ...d, x0: at.x, y0: at.y, x1: at.x, y1: at.y, mode: "leave" });
      }
      for (const [id, held] of scene.edges) if (!edges.has(id) && held.mode !== "leave") edges.set(id, { edge: held.edge, mode: "leave" });
    }
    setScene({ nodes, edges, walk, layout, moved: !!scene && scene.walk.centre !== walk.centre, animate: !still });
    setK(still ? 1 : 0);
  }

  // The clock for one move.
  useEffect(() => {
    if (!scene || !scene.animate) return;
    const from = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const x = Math.min(1, (now - from) / GLIDE_MS);
      setK(x);
      if (x < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [scene]);

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

/**
 * The Web: one picture for the set in the address (`?set=`), every anchor an
 * orange centre in it, one list per anchor beside it; a bare address is the
 * one walk from the tag with most notes.
 */
export function WebView({ set }: { set?: WebSet }) {
  return <WalkPanel anchorKey={(set?.live ?? []).join(",")} struck={set?.struck ?? NO_TAGS} />;
}

/** The picture of a set's anchors, or of the usual centre; a walk taken since goes where it was taken, and Back returns. */
function WalkPanel({ anchorKey, struck: struckTags }: { anchorKey: string; struck: string[] }) {
  const { t, lang } = useLang();
  const struck = useMemo(() => new Set(struckTags), [struckTags]);
  const anchors = useMemo(() => (anchorKey ? anchorKey.split(",") : []), [anchorKey]);
  const [at, setAt] = useState<Where | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // The bubble just chosen, marked at once while its walk is on the way.
  const [chosen, setChosen] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ at: Where | null; name: string }[]>([]);
  const [seen, setSeen] = useState(anchorKey);
  // A new set starts from itself: a walk taken from the old one is let go.
  if (seen !== anchorKey) {
    setSeen(anchorKey);
    setAt(null);
    setTrail([]);
    setChosen(null);
    setPicked(null);
  }
  // The walk is worked out here from a slim copy of the store (names, dates, tags, links; no text), so a
  // click needs no server. A store too large to send is walked by the server, one click at a time.
  const store = useApi<WalkStore>(WALK_STORE_URL, { revalidateOnFocus: false, keepPreviousData: true });
  const serverMode = store.data?.more === true;
  const starts: Where[] = at ? [at] : anchors.map((tag) => ({ tag }));
  const asked = starts.length ? starts.map(url) : [url(null)];
  const remote = useSWR<Walk[]>(serverMode ? walksKey(asked) : null, fetchWalks, { keepPreviousData: true });
  const input = useMemo(() => (store.data && !store.data.more ? inputOf(store.data) : null), [store.data]);
  const here = useMemo(() => {
    if (!input) return null;
    const from: Where[] = at ? [at] : anchors.map((tag) => ({ tag }));
    // A set's tag no note carries any more is left out; with none left it falls back to the usual centre.
    let walks = from.map((c) => buildWalk(input, c)).filter((w): w is Walk => !!w);
    if (!walks.length) {
      const usual = defaultCentre(input);
      const w = usual ? buildWalk(input, usual) : null;
      walks = w ? [w] : [];
    }
    return walks.length ? mergeWalks(walks) : null;
  }, [input, at, anchors]);
  const res = serverMode ? remote : store;
  const pic = useMemo(() => (serverMode ? (remote.data?.length ? mergeWalks(remote.data) : null) : here), [serverMode, remote.data, here]);
  const walk = pic?.walk ?? null;
  const multi = !!pic && pic.anchors.length > 1;

  // The first sentence of each note shown, asked for the notes in view; the picture never waits on it.
  const noteIds = useMemo(() => (walk && !serverMode ? walk.nodes.flatMap((n) => (n.kind === "note" ? [n.note.id] : [])).sort().join(",") : ""), [walk, serverMode]);
  const lines = useApi<{ summaries: Record<string, string> }>(noteIds ? `/api/notes/walk-summaries?ids=${encodeURIComponent(noteIds)}` : null, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
  const summaryOf = (n: Extract<WalkNode, { kind: "note" }>) => n.summary ?? lines.data?.summaries[n.note.id] ?? null;

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
  const height = width >= 640 ? Math.max(420, Math.min(720, Math.round(width * 0.52))) : Math.max(480, Math.min(780, Math.round(width * 1.4)));

  // Whether there is room for the list beside the picture, measured before the first paint.
  const [outer, setOuter] = useState<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    if (!outer) return;
    const measure = () => setRoom(Math.round(outer.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [outer]);
  const beside = room >= SIDE_MIN;
  // Narrow: the picture and the list are two pages side by side, swiped between.
  const pager = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);
  const showPage = (n: number) => {
    const el = pager.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: wantsStill() ? "auto" : "smooth" });
    setPage(n);
  };

  const layout = useMemo(() => (walk && pic && width > 0 ? layoutWalk(walk, width, height, multi ? { ids: pic.anchors, reach: pic.reach } : undefined) : null), [walk, pic, multi, width, height]);
  const { scene, e } = useGlide(walk, layout);

  const [hover, setHover] = useState<string | null>(null);
  // What the box under the picture describes: the last thing pointed at, held while the pointer travels to
  // the box, and let go (back to the centre) once the pointer has left the picture, the list and the box.
  const [kept, setKept] = useState<string | null>(null);
  const touch = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAim = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  /** Lights `id` after the pointer has rested on it; crossing a crowd lights nothing on the way. */
  const aim = (id: string | null, wait: number, ahead?: Where) => {
    cancelAim();
    timer.current = setTimeout(() => {
      setHover(id);
      if (id === null) setKept(null);
      // What a click here would show is asked for now, so the click has nothing to wait on.
      if (ahead) void preload(walksKey([url(ahead)]), fetchWalks);
    }, wait);
  };
  useEffect(() => cancelAim, []);

  // What is lit: the bubble pointed at and what touches it. Something that is not in this picture lights nothing.
  const lit = useMemo(() => {
    const id = hover ?? picked;
    if (!id || !walk || !walk.nodes.some((n) => n.id === id)) return null;
    const nodes = new Set<string>([id]);
    const edges = new Set<string>();
    for (const x of walk.edges) {
      if (x.a !== id && x.b !== id) continue;
      edges.add(x.id);
      nodes.add(x.a).add(x.b);
    }
    return { id, nodes, edges };
  }, [hover, picked, walk]);

  if (lit && lit.id !== kept) setKept(lit.id);

  // The left tag list wears this walk's colours for the tags it shows.
  useEffect(() => {
    if (!walk) return;
    showPicture("picture", new Map(walk.nodes.flatMap((n) => (n.kind === "tag" ? [[n.name, n.ring] as [string, number]] : []))));
    return () => showPicture("picture", null);
  }, [walk]);

  if (!allAnswered(res)) return null;

  if (!walk || !scene) {
    const gone = res.error && typeof res.error === "object" && "status" in res.error && (res.error as { status: number }).status === 404;
    const empty = !res.error && !walk;
    return (
      <div ref={setOuter}>
        <h1 className="mb-2 text-2xl font-bold">{t("webTitle")}</h1>
        {res.error || empty ? <Notice tone={empty || gone ? "info" : "error"}>{empty || gone ? t("webEmpty") : t("webFailed")}</Notice> : <div ref={setStage} className="w-full" />}
      </div>
    );
  }

  const centre = walk.nodes.find((n) => n.id === walk.centre)!;
  const allNodes = pic!.walks.flatMap((w) => w.nodes);
  const heading = pic!.anchors.map((id) => nameOf(allNodes.find((n) => n.id === id)!)).join(" · ");
  const go = (node: WalkNode) => {
    if (node.id === walk.centre) return;
    setTrail((tr) => [...tr, { at, name: heading }]);
    setAt(whereOf(node));
    cancelAim();
    setHover(null);
    setPicked(null);
    setKept(null);
    setChosen(node.id);
  };
  const back = () => {
    const last = trail[trail.length - 1];
    if (!last) return;
    setTrail((tr) => tr.slice(0, -1));
    setAt(last.at);
    cancelAim();
    setHover(null);
    setPicked(null);
    setKept(null);
    setChosen(null);
  };

  const pos = (d: Drawn) => {
    const a = d.mode === "leave" ? 1 - e : d.mode === "enter" ? e : 1;
    return { x: d.x0 + (d.x1 - d.x0) * e, y: d.y0 + (d.y1 - d.y0) * e, a };
  };
  const drawn = [...scene.nodes.values()].filter((d) => d.mode !== "leave" || e < 1);
  const where = new Map(drawn.map((d) => [d.node.id, pos(d)]));
  const dimOf = (id: string, kind: "node" | "edge") => (!lit ? 1 : (kind === "node" ? lit.nodes : lit.edges).has(id) ? 1 : DIM);
  const alone = walk.nodes.length === 1;
  // The bubble chosen, until the walk it asked for has arrived or failed.
  const pending = chosen && walk.centre !== chosen && !res.error ? chosen : null;

  const stripNode = shownOf(walk, kept);
  const ringOf = new Map(walk.nodes.map((n) => [n.id, n.ring]));

  const lists = pic!.walks.map((w) => ({ walk: w, rows: listOf(w), name: nameOf(w.nodes.find((n) => n.id === w.centre)!) }));
  const shares = pic!.shares;
  const words: Record<Share, string> = { shared: t(pic!.anchors.length > 2 ? "walkInAll" : "walkInBoth"), only: t("walkOnlyHere") };
  // A row pointed at lights its bubble as a bubble does, at once; a list has no crowd to cross.
  const point = (id: string) => {
    cancelAim();
    setHover(id);
  };

  const column = { multi, height, struck, lit: lit?.nodes ?? null, shares, words, onPoint: point, onLeave: () => aim(null, LET_GO_MS), t, lang };

  const picture = (
    <>
      <div
        ref={setStage}
        className="w-full overflow-hidden rounded-2xl border border-border bg-card"
        style={{ height, position: "relative" }}
        onPointerEnter={cancelAim}
        onPointerLeave={() => aim(null, LET_GO_MS)}
      >
        {layout && (
          <svg
            width={layout.width}
            height={layout.height}
            role="img"
            aria-label={t("webTitle")}
            style={{ display: "block" }}
          >
            <rect
              width={layout.width}
              height={layout.height}
              fill="transparent"
              onClick={() => {
                setPicked(null);
                setKept(null);
              }}
            />
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

            {layout.breaks.map((b) => (
              <g key={b.from}>
                {layout.along === "x" ? (
                  <>
                    <line x1={b.at} x2={b.at} y1={14} y2={layout.height - 44} className="stroke-border" strokeWidth={1} strokeDasharray="1 4" />
                    <text x={b.at} y={layout.height - 30} textAnchor="middle" fontSize={11} className="fill-current text-muted-foreground">
                      {`${formatFactDate(b.from.slice(0, 7), lang)} ⁄⁄ ${formatFactDate(b.to.slice(0, 7), lang)}`}
                    </text>
                  </>
                ) : (
                  <>
                    <line x1={14} x2={layout.width - 14} y1={b.at} y2={b.at} className="stroke-border" strokeWidth={1} strokeDasharray="1 4" />
                    <text x={16} y={b.at - 5} fontSize={11} className="fill-current text-muted-foreground">
                      {`${formatFactDate(b.from.slice(0, 7), lang)} ⁄⁄ ${formatFactDate(b.to.slice(0, 7), lang)}`}
                    </text>
                  </>
                )}
              </g>
            ))}

            {/* Lines answer nothing: only bubbles and list rows do, so the pointer never loses what it holds on the way. */}
            {drawOrder([...scene.edges.values()], ringOf).map(({ edge, mode, level }) => {
                const a = where.get(edge.a);
                const b = where.get(edge.b);
                if (!a || !b) return null;
                const alpha = (mode === "leave" ? 1 - e : mode === "enter" ? e : 1) * dimOf(edge.id, "edge");
                const d = curve(a.x, a.y, b.x, b.y, edge.kind === "under" ? 0.08 : 0.14);
                const dotted = edge.kind === "subject" || edge.kind === "theme";
                const heavy = lit?.edges.has(edge.id) ? 1.4 : 1;
                return (
                  <path
                    key={edge.id}
                    d={d}
                    fill="none"
                    opacity={alpha}
                    pointerEvents="none"
                    style={{ stroke: levelColour(level), transition: e >= 1 ? "opacity 260ms ease" : "none" }}
                    strokeWidth={LEVEL_WIDTH[level] * heavy}
                    strokeLinecap="round"
                    strokeDasharray={dotted ? "1 7" : undefined}
                  />
                );
              })}

            {drawn
              .sort((x, y) => (x.node.id === walk.centre ? 1 : 0) - (y.node.id === walk.centre ? 1 : 0))
              .map((d) => {
                const p = where.get(d.node.id)!;
                const isCentre = d.node.id === walk.centre;
                const tag = d.node.kind === "tag";
                const colour = levelColour(levelOfRing(d.node.ring));
                const crossed = isStruck(d.node, struck);
                const alpha = p.a * dimOf(d.node.id, "node") * (d.node.ring >= 3 ? 0.75 : 1) * (crossed ? 0.6 : 1);
                const open = (ev: React.MouseEvent) => {
                  ev.stopPropagation();
                  if (touch.current && picked !== d.node.id) setPicked(d.node.id);
                  else go(d.node);
                };
                return (
                  <g
                    key={d.node.id}
                    transform={`translate(${p.x} ${p.y})`}
                    opacity={alpha}
                    style={{ cursor: "pointer", outline: "none", transition: e >= 1 ? "opacity 260ms ease" : "none" }}
                    role="button"
                    tabIndex={0}
                    aria-label={nameOf(d.node)}
                    onPointerEnter={(ev) => {
                      if (ev.pointerType !== "touch") aim(d.node.id, REST_MS, serverMode ? whereOf(d.node) : undefined);
                    }}
                    onPointerLeave={cancelAim}
                    onPointerDown={(ev) => {
                      touch.current = ev.pointerType === "touch";
                    }}
                    onClick={open}
                    onKeyDown={(ev) => ev.key === "Enter" && go(d.node)}
                  >
                    <circle r={Math.max(d.r + 6, 18)} fill="transparent" />
                    <circle r={d.r + (isCentre ? 12 : 7)} style={{ fill: colour }} fillOpacity={0.3} filter="url(#walk-glow)" />
                    {pending === d.node.id && (
                      <circle r={d.r + 10} fill="none" style={{ stroke: colour }} strokeWidth={2}>
                        {!wantsStill() && <animate attributeName="opacity" values="0.9;0.25;0.9" dur="0.9s" repeatCount="indefinite" />}
                      </circle>
                    )}
                    {isCentre && scene.moved && e < 1 && <circle r={d.r + 8 + 46 * e} fill="none" style={{ stroke: colour }} strokeWidth={2} opacity={0.7 * (1 - e)} />}
                    <circle
                      r={d.r}
                      className={tag ? undefined : "stroke-card"}
                      style={tag ? { fill: colour, stroke: colour } : { fill: colour }}
                      fillOpacity={tag ? 0.15 : undefined}
                      strokeWidth={isCentre ? 3 : 1.6}
                    />
                    {shares.get(d.node.id) && (
                      <g transform={`translate(${d.r + 8} ${-(d.r + 8)})`} className="text-muted-foreground">
                        <ShareGlyph share={shares.get(d.node.id)!} />
                      </g>
                    )}
                    {tag && d.node.kind === "tag" && (
                      <text textAnchor="middle" dy="0.35em" fontSize={Math.max(11, Math.min(15, d.r * 0.7))} fontWeight={600} className="fill-current" textDecoration={crossed ? "line-through" : undefined}>
                        {d.node.count}
                      </text>
                    )}
                    {d.named && (
                      <text
                        x={d.named === "right" ? d.r + 6 : d.named === "left" ? -(d.r + 6) : 0}
                        y={d.named === "below" ? d.r + 15 : d.named === "above" ? -(d.r + 6) : 4}
                        textAnchor={d.named === "right" ? "start" : d.named === "left" ? "end" : "middle"}
                        fontSize={12}
                        fontWeight={tag || isCentre ? 600 : 400}
                        className="fill-current stroke-card"
                        strokeWidth={4}
                        paintOrder="stroke"
                        strokeLinejoin="round"
                        textDecoration={crossed ? "line-through" : undefined}
                      >
                        {d.label}
                      </text>
                    )}
                  </g>
                );
              })}
          </svg>
        )}

        {alone && <p className="text-center text-sm text-muted-foreground" style={{ position: "absolute", bottom: 40, left: 16, right: 16 }}>{t("walkAlone")}</p>}
      </div>

      <div style={{ height: STRIP_H }} className="mt-2" aria-live="polite" onPointerEnter={cancelAim} onPointerLeave={() => aim(null, LET_GO_MS)}>
        {stripNode && (
          <div className="overflow-y-auto rounded-2xl border border-border bg-card p-3 text-sm" style={{ maxHeight: STRIP_H }}>
            {stripNode.kind === "note" ? <NoteCard node={stripNode} summary={summaryOf(stripNode)} share={shares.get(stripNode.id)} words={words} lang={lang} t={t} /> : <TagCard node={stripNode} crossed={isStruck(stripNode, struck)} t={t} />}
            <Connections node={stripNode} walk={walk} t={t} />
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {[
          { text: t("walkKeyHere"), colour: levelColour(1), width: LEVEL_WIDTH[1], dash: undefined },
          { text: t("walkKeyNear"), colour: levelColour(2), width: LEVEL_WIDTH[2], dash: undefined },
          { text: t("walkKeyFar"), colour: levelColour(3), width: LEVEL_WIDTH[3], dash: undefined },
          { text: t("walkKeyShared"), colour: null, width: 2.4, dash: "1 6" },
        ].map((k) => (
          <span key={k.text} className="inline-flex items-center gap-1">
            <svg width="24" height="8" aria-hidden="true">
              <line x1="2" y1="4" x2="22" y2="4" className={k.colour ? undefined : "stroke-muted-foreground"} style={k.colour ? { stroke: k.colour } : undefined} strokeWidth={k.width} strokeLinecap="round" strokeDasharray={k.dash} />
            </svg>
            {k.text}
          </span>
        ))}
        {multi &&
          (["shared", "only"] as Share[]).map((share) => (
            <span key={share} className="inline-flex items-center gap-1">
              <svg width="14" height="8" viewBox="-7 -4 14 8" aria-hidden="true" className="text-muted-foreground">
                <ShareGlyph share={share} />
              </svg>
              {words[share]}
            </span>
          ))}
      </div>
    </>
  );

  return (
    <div ref={setOuter}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {trail.length > 0 && (
          <Button size="sm" variant="secondary" tip={trail[trail.length - 1].name} onClick={back}>
            {t("walkBack", { name: trail[trail.length - 1].name })}
          </Button>
        )}
        <h1 className="text-2xl font-bold">{multi ? heading : nameOf(centre)}</h1>
        {!multi && (
          <span className="text-sm text-muted-foreground">
            {centre.kind === "tag" ? t("webNotes", { n: centre.count }) : formatDateShort(centre.at, lang)}
          </span>
        )}
        {centre.kind === "note" && (
          <NoteLink note={centre.note} className="ml-auto text-sm font-medium hover:underline">
            {t("walkOpen")}
          </NoteLink>
        )}
        {!multi && centre.kind === "tag" && centre.meaning && <p className="w-full text-sm text-muted-foreground">{centre.meaning}</p>}
        {centre.kind === "note" && summaryOf(centre) && <p className="w-full text-sm text-muted-foreground">{summaryOf(centre)}</p>}
      </div>

      {beside ? (
        <div style={{ display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${SIDE_W}px`, gap: 16, alignItems: "start" }}>
          <div style={{ minWidth: 0 }}>{picture}</div>
          {/* The lists one above the other, sharing the picture's height, so the picture keeps the width. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            {lists.map((l) => (
              <ListColumn key={l.walk.centre} list={l} onGo={go} {...column} height={Math.max(120, Math.floor((height - (lists.length - 1) * 12 - (multi ? lists.length * 26 : 0)) / lists.length))} />
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-2 flex gap-2">
            <Button size="sm" variant={page === 0 ? "primary" : "secondary"} tip={t("tipWalkPicture")} aria-pressed={page === 0} onClick={() => showPage(0)}>
              {t("walkPicture")}
            </Button>
            {lists.map((l, i) => (
              <Button key={l.walk.centre} size="sm" variant={page === i + 1 ? "primary" : "secondary"} tip={t("tipWalkList")} aria-pressed={page === i + 1} onClick={() => showPage(i + 1)}>
                {multi ? l.name : t("walkList")}
              </Button>
            ))}
          </div>
          <div
            ref={pager}
            onScroll={(ev) => setPage(Math.round(ev.currentTarget.scrollLeft / Math.max(1, ev.currentTarget.clientWidth)))}
            style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none", overscrollBehaviorX: "contain" }}
          >
            <div style={{ flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start" }}>{picture}</div>
            {lists.map((l) => (
              <div key={l.walk.centre} style={{ flex: "0 0 100%", minWidth: 0, scrollSnapAlign: "start" }}>
                <ListColumn
                  list={l}
                  onGo={(n) => {
                    showPage(0);
                    go(n);
                  }}
                  {...column}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One anchor's list, titled with the anchor when the picture holds several. */
function ListColumn({ list, multi, height, struck, lit, shares, words, onPoint, onLeave, onGo, t, lang }: { list: { walk: Walk; rows: Row[]; name: string }; multi: boolean; height: number; struck: ReadonlySet<string>; lit: Set<string> | null; shares: ReadonlyMap<string, Share>; words: Record<Share, string>; onPoint: (id: string) => void; onLeave: () => void; onGo: (n: WalkNode) => void; t: T; lang: Lang }) {
  return (
    <div style={{ minWidth: 0 }}>
      {multi && (
        <p className="mb-1 text-sm font-semibold" style={{ color: levelColour(1) }}>
          {list.name}
        </p>
      )}
      <WalkList rows={list.rows} height={height} struck={struck} lit={lit} centre={list.walk.centre} shares={shares} words={words} onPoint={onPoint} onLeave={onLeave} onGo={onGo} t={t} lang={lang} />
    </div>
  );
}

function NoteCard({ node, summary, share, words, lang, t }: { node: Extract<WalkNode, { kind: "note" }>; summary: string | null; share: Share | undefined; words: Record<Share, string>; lang: Lang; t: T }) {
  return (
    <div>
      <p className="font-medium">{node.note.title}</p>
      {share && (
        <p className="mb-1">
          <ShareMark share={share} word={words[share]} />
        </p>
      )}
      <p className="mb-1 text-xs text-muted-foreground">
        {formatDateShort(node.at, lang)}
        {node.tags.length > 0 && ` · ${node.tags.map((tag) => `#${tag}`).join(" ")}`}
      </p>
      {summary && <p className="mb-2 text-muted-foreground">{summary}</p>}
      <NoteLink note={node.note} className="mt-2 block rounded-2xl border border-border p-3 text-center font-medium hover:underline">
        {t("walkOpen")}
      </NoteLink>
    </div>
  );
}

function TagCard({ node, crossed, t }: { node: Extract<WalkNode, { kind: "tag" }>; crossed: boolean; t: T }) {
  return (
    <div>
      <p className="font-medium">
        <span style={{ textDecoration: crossed ? "line-through" : undefined }}>#{node.name}</span> <span className="text-muted-foreground" style={{ fontWeight: 400 }}>· {t("webNotes", { n: node.count })}</span>
      </p>
      {node.meaning && <p className="text-muted-foreground">{node.meaning}</p>}
    </div>
  );
}

/** Everything the lit bubble touches in this picture, and why, one line each. */
function Connections({ node, walk, t }: { node: WalkNode; walk: Walk; t: T }) {
  const own = connectionsOf(walk, node.id);
  if (!own.length) return null;
  return (
    <div className="mt-2 border-border" style={{ borderTop: "1px solid", paddingTop: 8 }}>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t("walkConnected")}</p>
      {own.map((edge) => (
        <div key={edge.id} className="mb-1">
          <EdgeCard edge={edge} walk={walk} t={t} />
        </div>
      ))}
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
