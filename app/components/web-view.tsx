"use client";

// [Librarian, Guru]
import { useEffect, useMemo, useRef, useState } from "react";
import { preload } from "swr";
import { type SimulationNodeDatum, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { allAnswered, api, useApi } from "@/lib/api";
import { useLang } from "@/hooks/use-lang";
import { formatDate } from "@/lib/format";
import type { Evidence, NoteRef, TagWeb, Web, WebEdge } from "@/lib/note/web";
import { NoteLink } from "@/components/note-link";
import { PHRASE } from "@/components/note-links";
import { Button, Notice } from "@/components/ui";

/**
 * The web (`lib/note/web.ts`): every tag in use sized by its notes, with the
 * tags it sits under and the bridges between areas that share no tag. Tap a
 * tag: it goes to the centre with its notes, their links and the tags its
 * bridges reach, and tapping one of those crosses the bridge. Tap a line: why
 * it is there. Tap a note: it opens. The picture is laid out to rest before it
 * is drawn, the same store the same way, and nothing moves until pressed:
 * drag pans, wheel or pinch zooms. Free of Next and server code: the plugins
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

type Dot = { id: string; kind: "tag" | "centre" | "note"; label: string; r: number; note?: NoteRef; tag?: string };
type Line = { id: string; a: string; b: string; look: "kept" | "asked" | "bridge" | "link" | "carries"; length: number; pull: number; why: Why };

/** A start for each dot from its name alone, so a new tag leaves the others where they were. */
function seed(name: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const angle = (((h >>> 0) % 3600) / 3600) * 2 * Math.PI;
  const radius = 40 + ((h >>> 12) % 240);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

/** Each dot's resting place: the forces run to the end before anything is drawn. */
function settle(dots: Dot[], lines: Line[], centre?: string): Map<string, { x: number; y: number }> {
  type N = SimulationNodeDatum & { id: string; r: number };
  const nodes: N[] = dots.map((dot) => {
    const [x, y] = seed(dot.id);
    return dot.id === centre ? { id: dot.id, r: dot.r, x: 0, y: 0, fx: 0, fy: 0 } : { id: dot.id, r: dot.r, x, y };
  });
  const links = lines.map((line) => ({ source: line.a, target: line.b, length: line.length, pull: line.pull }));
  forceSimulation(nodes)
    .force(
      "link",
      forceLink<N, (typeof links)[number] & { source: string | N; target: string | N }>(links)
        .id((n) => n.id)
        .distance((l) => l.length)
        .strength((l) => l.pull)
    )
    .force("charge", forceManyBody<N>().strength(-180))
    .force("collide", forceCollide<N>((n) => n.r + 16))
    .force("x", forceX<N>(0).strength(0.05))
    .force("y", forceY<N>(0).strength(0.05))
    .stop()
    .tick(300);
  return new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}

const short = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const tagRadius = (count: number) => Math.min(48, 6 + 5 * Math.sqrt(count));

/** The whole web as dots and lines. */
function wholeShape(web: Web): { dots: Dot[]; lines: Line[] } {
  const meaning = new Map(web.tags.map((tag) => [tag.name, tag.meaning]));
  const dots: Dot[] = web.tags.map((tag) => ({ id: `t:${tag.name}`, kind: "tag", label: `#${tag.name}`, r: tagRadius(tag.count), tag: tag.name }));
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
    { id: centre, kind: "centre", label: `#${web.tag}`, r: tagRadius(web.notes.length), tag: web.tag },
    ...web.notes.map((note): Dot => ({ id: `n:${note.id}`, kind: "note", label: short(note.title), r: 6, note })),
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

const STROKE: Record<Line["look"], string> = {
  kept: "stroke-muted-foreground",
  asked: "stroke-muted-foreground",
  bridge: "stroke-destructive",
  link: "stroke-primary",
  carries: "stroke-border",
};

export function WebView() {
  const { t, lang } = useLang();
  const [centre, setCentre] = useState<string | null>(null);
  const whole = useApi<Web>("/api/notes/web");
  // The tag last opened stays drawn until the next one has answered.
  const around = useApi<TagWeb>(centre ? webUrl(centre) : null, { keepPreviousData: true });
  const centred = centre ? around.data ?? null : null;

  const shape = useMemo(() => (centred ? centreShape(centred) : whole.data ? wholeShape(whole.data) : null), [centred, whole.data]);
  const placed = useMemo(() => (shape ? settle(shape.dots, shape.lines, centred ? `t:${centred.tag}` : undefined) : null), [shape, centred]);

  // Pan, zoom and the line picked belong to one picture; a new one starts unmoved, nothing picked.
  const [held, setHeld] = useState<{ of: unknown; x: number; y: number; k: number; picked: Line | null }>({ of: null, x: 0, y: 0, k: 1, picked: null });
  const fresh = { of: placed, x: 0, y: 0, k: 1, picked: null };
  const view = held.of === placed ? held : fresh;
  const picked = view.picked;
  const setView = (change: (v: { x: number; y: number; k: number }) => { x: number; y: number; k: number }) =>
    setHeld((h) => {
      const now = h.of === placed ? h : fresh;
      return { ...now, ...change(now) };
    });
  const setPicked = (line: Line | null) => setHeld((h) => ({ ...(h.of === placed ? h : fresh), picked: line }));
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);

  const toSvg = (x: number, y: number) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x, y };
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const zoomAt = (at: { x: number; y: number }, by: number) =>
    setView((v) => {
      const k = Math.min(8, Math.max(0.25, v.k * by));
      return { k, x: at.x - (at.x - v.x) * (k / v.k), y: at.y - (at.y - v.y) * (k / v.k) };
    });
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(toSvg(e.clientX, e.clientY), Math.exp(-e.deltaY / 400));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  function down(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = false;
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const was = pointers.current.get(e.pointerId);
    if (!was) return;
    const now = { x: e.clientX, y: e.clientY };
    if (!moved.current && Math.hypot(now.x - was.x, now.y - was.y) < 5) return;
    if (!moved.current) svg.current?.setPointerCapture(e.pointerId);
    moved.current = true;
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
    pointers.current.set(e.pointerId, now);
    if (others.length === 1) {
      const other = others[0];
      const mid = toSvg((now.x + other.x) / 2, (now.y + other.y) / 2);
      const before = Math.hypot(was.x - other.x, was.y - other.y) || 1;
      zoomAt(mid, Math.hypot(now.x - other.x, now.y - other.y) / before);
      return;
    }
    const a = toSvg(was.x, was.y);
    const b = toSvg(now.x, now.y);
    setView((v) => ({ ...v, x: v.x + b.x - a.x, y: v.y + b.y - a.y }));
  }
  function up(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
  }
  // A drag ends in a click on whatever it started on; that click does nothing.
  const tap = (act: () => void) => (e: React.MouseEvent) => {
    if (moved.current) {
      e.preventDefault();
      return;
    }
    act();
  };
  const open = (tag: string) => {
    setPicked(null);
    setCentre(tag);
  };
  const ready = (tag: string) => void preload(webUrl(tag), api);

  if (!allAnswered(whole)) return null;

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

  if (!shape || !placed || shape.dots.length === 0)
    return (
      <div>
        {header}
        {whole.error ? <Notice tone="error">{t("webFailed")}</Notice> : <p className="text-sm text-muted-foreground">{t("webEmpty")}</p>}
      </div>
    );

  const at = (id: string) => placed.get(id) ?? { x: 0, y: 0 };
  const xs = shape.dots.flatMap((d) => [at(d.id).x - d.r - d.label.length * 3.5, at(d.id).x + d.r + d.label.length * 3.5]);
  const ys = shape.dots.flatMap((d) => [at(d.id).y - d.r, at(d.id).y + d.r + 16]);
  const pad = 24;
  const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad];

  return (
    <div>
      {header}
      {around.error && centre && <Notice tone="error">{t("webFailed")}</Notice>}
      <p className="mb-2 text-xs text-muted-foreground">{t("webHint")}</p>
      <svg
        ref={svg}
        viewBox={box.join(" ")}
        className="h-[60vh] w-full touch-none select-none rounded-2xl border border-border bg-card md:h-[70vh]"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {shape.lines.map((line) => {
            const a = at(line.a);
            const b = at(line.b);
            const on = picked?.id === line.id;
            return (
              <g key={line.id} role="button" tabIndex={0} data-tip={t("tipWebLine")} className="cursor-pointer" onClick={tap(() => setPicked(line))} onKeyDown={(e) => e.key === "Enter" && setPicked(line)}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={STROKE[line.look]} strokeWidth={on ? 3 : line.look === "carries" ? 1 : 1.5} strokeDasharray={line.look === "asked" ? "5 4" : line.look === "bridge" ? "2 3" : undefined} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} />
              </g>
            );
          })}
          {shape.dots.map((dot) => {
            const p = at(dot.id);
            const label = (
              <text x={p.x} y={p.y + dot.r + 12} textAnchor="middle" className={`fill-current text-[11px] ${dot.kind === "note" ? "text-muted-foreground" : "font-semibold"}`}>
                {dot.label}
              </text>
            );
            if (dot.note)
              return (
                <NoteLink key={dot.id} note={dot.note} tip={t("tipWebNote")} onClick={(e) => moved.current && e.preventDefault()}>
                  <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={dot.r} className="fill-primary" />
                  {label}
                </NoteLink>
              );
            const tag = dot.tag!;
            const here = dot.kind === "centre";
            return (
              <g
                key={dot.id}
                role="button"
                tabIndex={0}
                data-tip={t("tipWebTag")}
                className={here ? "" : "cursor-pointer"}
                onPointerEnter={() => !here && ready(tag)}
                onClick={tap(() => !here && open(tag))}
                onKeyDown={(e) => e.key === "Enter" && !here && open(tag)}
              >
                <circle cx={p.x} cy={p.y} r={dot.r} className={here ? "fill-primary/30 stroke-primary" : "fill-primary/15 stroke-primary/60"} strokeWidth={1.5} />
                {label}
              </g>
            );
          })}
        </g>
      </svg>
      {picked && (
        <div className="mt-3 rounded-2xl border border-border bg-card p-3 text-sm" aria-live="polite">
          <Explain why={picked.why} onOpen={open} lang={lang} t={t} />
        </div>
      )}
    </div>
  );
}

type T = ReturnType<typeof useLang>["t"];

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
