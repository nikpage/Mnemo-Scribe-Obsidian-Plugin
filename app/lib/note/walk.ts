// [Librarian, Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { noteName } from "@/lib/note/filing";
import type { LinkType } from "@/lib/note/links";
import type { TagRow } from "@/lib/note/tag-tree";
import { SUBJECT_MAX_NOTES, isSelfSubject, type NoteRef, type WebInput, type WebLink, type WebNote } from "@/lib/note/web";
import type { BrainRef } from "@/lib/note/walk-brain";
import type { Kind } from "@/lib/note/what-next-target";

/**
 * The walk: a few steps out from one tag or note, never the whole store.
 *
 * From the centre it reaches outward ring by ring — a tag to the notes
 * carrying it; a note to its tags and to the notes
 * it is joined to by a note link (kept or not yet asked, never turned down), a
 * fact subject or a theme. Each ring has a ceiling so the picture stays
 * readable; within it the strongest route comes first, then the newest note.
 * Every line says why it is there. No text but one summary line per note is
 * sent, and no model is called.
 */

type Db = SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const RINGS = 3;
/** The most nodes each ring adds, outward from the centre; the centre is ring 0. */
export const RING_MAX = [1, 12, 18, 14];
/** What one node sends on to the next ring. */
const TAG_OUT = { tags: 5, notes: 6 };
/** The most notes one walk shows, nearest first; the furthest ring is dropped first. */
export const NOTES_MAX = 40;
const NOTE_OUT = { tags: 3, notes: 4 };

export type WalkNode =
  | { id: string; kind: "tag"; ring: number; from: string | null; name: string; count: number; meaning: string | null; at: string }
  | { id: string; kind: "note"; ring: number; from: string | null; note: NoteRef; at: string; tags: string[]; summary: string | null }
  /** A Brain output drawn in the walk (`walk-brain.ts`), dated when it was written; `read` = how many of the walk's notes it read. */
  | { id: string; kind: "brain"; ring: number; from: string | null; brain: { id: string; title: string; job: Kind; quoted: string[] }; at: string; read: number };

/** `under`: tag a hangs from the whole store's centre (`ALL_TAG`). `carries`: note a carries tag b. `link`: note a (later) to note b. `read`: Brain output a read note b (or a note under tag b). */
export type WalkEdge = { id: string; a: string; b: string; kind: "under" | "carries" | "link" | "subject" | "theme" | "read"; type?: LinkType; why: string | null; name?: string };
export type Walk = { centre: string; nodes: WalkNode[]; edges: WalkEdge[] };
export type Centre = { tag: string } | { note: string };
/** The centre of the whole store: a tag name no one can type (tags are normalised), joined to every tag in use. */
export const ALL_TAG = "∗ all notes";

const tagId = (name: string) => `t:${name}`;
const noteId = (id: string) => `n:${id}`;
const STRENGTH = { link: 3, subject: 2, theme: 1 } as const;

type Relation = { other: string; kind: "link" | "subject" | "theme"; type?: LinkType; why: string | null; name?: string; /** A link is stored from the later note. */ later?: string };

const refOf = (note: WebNote): NoteRef => ({ id: note.id, path: note.path, title: noteName(note.path || "", note.label).replace(/\.md$/, "") });
const newestFirst = (a: WebNote, b: WebNote) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : a.id.localeCompare(b.id));
const median = (dates: string[]): string => [...dates].sort()[Math.floor(dates.length / 2)];

/** The walk from a centre; null when the centre has no note in use. */
export function buildWalk(input: WebInput, centre: Centre): Walk | null {
  // The whole store: every tag in use hangs from one centre, and so do notes with no tag.
  const all = "tag" in centre && centre.tag === ALL_TAG;
  const everyTag = all ? [...new Set(input.notes.flatMap((note) => note.tags || []))] : [];
  const byId = new Map(input.notes.map((note) => [note.id, note]));

  // How many notes carry each tag, and the date in the middle of them.
  const stat = new Map<string, { count: number; at: string }>();
  const statOf = (tag: string) => {
    let s = stat.get(tag);
    if (!s) {
      const inside = tag === ALL_TAG ? input.notes : input.notes.filter((note) => (note.tags || []).includes(tag));
      s = { count: inside.length, at: inside.length ? median(inside.map((n) => n.recorded_at)) : "" };
      stat.set(tag, s);
    }
    return s;
  };
  const inUse = (tag: string) => statOf(tag).count > 0;
  const carrying = new Map<string, WebNote[]>();
  for (const note of input.notes) for (const tag of note.tags || []) carrying.set(tag, [...(carrying.get(tag) ?? []), note]);
  if (all) carrying.set(ALL_TAG, input.notes.filter((note) => !note.tags?.length));
  for (const list of carrying.values()) list.sort(newestFirst);

  // Notes reach each other outside their tags.
  const relations = new Map<string, Relation[]>();
  const relate = (x: string, y: string, r: Omit<Relation, "other">) => {
    if (x === y || !byId.has(x) || !byId.has(y)) return;
    relations.set(x, [...(relations.get(x) ?? []), { ...r, other: y }]);
    relations.set(y, [...(relations.get(y) ?? []), { ...r, other: x }]);
  };
  for (const link of input.links) relate(link.from, link.to, { kind: "link", type: link.type, why: link.reason || null, later: link.from });
  const groups = (rows: [string, string][]) => {
    const out = new Map<string, Set<string>>();
    for (const [name, id] of rows) if (name && byId.has(id)) out.set(name, (out.get(name) ?? new Set()).add(id));
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  const together = (kind: "subject" | "theme", sets: [string, Set<string>][]) => {
    for (const [name, ids] of sets) {
      if (ids.size > SUBJECT_MAX_NOTES) continue;
      const list = [...ids].sort();
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) relate(list[i], list[j], { kind, why: null, name });
    }
  };
  together("subject", groups(input.facts.filter((f) => !isSelfSubject(f.subject)).map((f) => [f.subject.trim(), f.recording_id])));
  together("theme", groups(input.themes.flatMap((t) => t.evidence.map((id) => [t.name.trim(), id] as [string, string]))));

  const start = "tag" in centre ? (inUse(centre.tag) ? tagId(centre.tag) : null) : byId.has(centre.note) ? noteId(centre.note) : null;
  if (!start) return null;

  const nodes = new Map<string, WalkNode>();
  const add = (id: string, ring: number, from: string | null) => {
    if (nodes.has(id)) return;
    if (id.startsWith("t:")) {
      const name = id.slice(2);
      const s = statOf(name);
      nodes.set(id, { id, kind: "tag", ring, from, name, count: s.count, meaning: input.rows.find((r) => r.name === name)?.meaning ?? null, at: s.at });
    } else {
      const note = byId.get(id.slice(2))!;
      nodes.set(id, { id, kind: "note", ring, from, note: refOf(note), at: note.recorded_at, tags: note.tags || [], summary: null });
    }
  };
  add(start, 0, null);

  /** Not yet in the picture: a place already taken must not use up one of a node's few ways onward. */
  const fresh = (id: string) => !nodes.has(id);

  /** Where one node leads, strongest first. */
  const onward = (id: string): string[] => {
    if (id.startsWith("t:")) {
      const tag = id.slice(2);
      const tags = (tag === ALL_TAG ? everyTag : []).filter(inUse).sort((a, b) => statOf(b).count - statOf(a).count || a.localeCompare(b));
      const notes = carrying.get(tag) ?? [];
      return [...tags.map(tagId).filter(fresh).slice(0, tag === ALL_TAG ? RING_MAX[1] : TAG_OUT.tags), ...notes.map((n) => noteId(n.id)).filter(fresh).slice(0, TAG_OUT.notes)];
    }
    const note = byId.get(id.slice(2))!;
    const tags = [...new Set(note.tags || [])].filter(inUse).sort((a, b) => statOf(b).count - statOf(a).count || a.localeCompare(b));
    const rel = [...(relations.get(note.id) ?? [])]
      .sort((a, b) => STRENGTH[b.kind] - STRENGTH[a.kind] || newestFirst(byId.get(a.other)!, byId.get(b.other)!))
      .map((r) => r.other);
    return [...tags.map(tagId).filter(fresh).slice(0, NOTE_OUT.tags), ...[...new Set(rel)].map(noteId).filter(fresh).slice(0, NOTE_OUT.notes)];
  };

  let ring = [start];
  for (let r = 1; r <= RINGS; r++) {
    const next: string[] = [];
    for (const id of ring) {
      for (const to of onward(id)) {
        if (nodes.has(to) || next.length >= RING_MAX[r]) continue;
        add(to, r, id);
        next.push(to);
      }
    }
    ring = next;
  }

  // Every line between what is shown, once.
  const edges: WalkEdge[] = [];
  const shownNotes = [...nodes.values()].filter((n): n is Extract<WalkNode, { kind: "note" }> => n.kind === "note");
  if (all) for (const node of nodes.values()) if (node.kind === "tag" && node.name !== ALL_TAG) edges.push({ id: `u:${node.name}\n${ALL_TAG}`, a: node.id, b: tagId(ALL_TAG), kind: "under", why: null });
  for (const note of shownNotes) for (const tag of [...new Set(note.tags.length || !all ? note.tags : [ALL_TAG])].sort()) if (nodes.has(tagId(tag))) edges.push({ id: `c:${note.note.id}\n${tag}`, a: note.id, b: tagId(tag), kind: "carries", why: null });
  const seen = new Set<string>();
  for (const note of shownNotes) {
    const best = new Map<string, Relation>();
    for (const r of relations.get(note.note.id) ?? []) {
      if (!nodes.has(noteId(r.other))) continue;
      const held = best.get(r.other);
      if (!held || STRENGTH[r.kind] > STRENGTH[held.kind]) best.set(r.other, r);
    }
    for (const r of [...best.values()].sort((a, b) => a.other.localeCompare(b.other))) {
      const [x, y] = [note.note.id, r.other].sort();
      if (seen.has(`${x}\n${y}`)) continue;
      seen.add(`${x}\n${y}`);
      // A link reads from the later note to the earlier, as it is stored.
      const [a, b] = r.kind === "link" && r.later ? [r.later, r.later === x ? y : x] : [x, y];
      edges.push({ id: `${r.kind}:${x}\n${y}`, a: noteId(a), b: noteId(b), kind: r.kind, type: r.type, why: r.why, name: r.name });
    }
  }

  return capNotes({ centre: start, nodes: [...nodes.values()], edges }, NOTES_MAX);
}

/**
 * A walk with at most `max` notes: the nearest stay (nodes are held nearest
 * ring first), the furthest go, and with them whatever then no line reaches
 * from the centre and every line to what went.
 */
export function capNotes(walk: Walk, max: number): Walk {
  let notes = 0;
  const kept = new Set<string>();
  for (const n of walk.nodes) {
    if (n.kind === "note" && ++notes > max) continue;
    kept.add(n.id);
  }
  if (kept.size === walk.nodes.length) return walk;
  const edges = walk.edges.filter((e) => kept.has(e.a) && kept.has(e.b));
  const reached = new Set([walk.centre]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of edges) {
      if (reached.has(e.a) !== reached.has(e.b)) {
        reached.add(e.a).add(e.b);
        grew = true;
      }
    }
  }
  return { centre: walk.centre, nodes: walk.nodes.filter((n) => kept.has(n.id) && reached.has(n.id)), edges: edges.filter((e) => reached.has(e.a) && reached.has(e.b)) };
}

/** A walk cut to its centre and what one step reaches: each anchor of the Web's "View this map". */
export function oneStep(walk: Walk): Walk {
  const kept = new Set(walk.nodes.filter((n) => n.ring <= 1).map((n) => n.id));
  return { centre: walk.centre, nodes: walk.nodes.filter((n) => kept.has(n.id)), edges: walk.edges.filter((e) => kept.has(e.a) && kept.has(e.b)) };
}

/** The first sentence of a summary, cut short enough for a hover. */
export function firstSentence(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  const one = end >= 0 ? flat.slice(0, end + 1) : flat;
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** As many summaries as one request may ask for: a walk shows at most this many notes. */
export const SUMMARIES_MAX = 60;

/** The first sentence of each named note's summary, for this account's notes only. */
export async function summariesOf(admin: Db, userId: string, ids: string[]): Promise<Record<string, string>> {
  const asked = [...new Set(ids)].slice(0, SUMMARIES_MAX);
  if (!asked.length) return {};
  const { data, error } = await admin.from("recordings").select("id, analysis").eq("user_id", userId).in("id", asked);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const row of (data || []) as { id: string; analysis: { summary?: string } | null }[]) if (row.analysis?.summary) out[row.id] = firstSentence(row.analysis.summary);
  return out;
}

/** The walk with each note's summary line, read for the notes shown only. */
export async function withSummaries(admin: Db, userId: string, walk: Walk): Promise<Walk> {
  const lines = await summariesOf(admin, userId, walk.nodes.flatMap((n) => (n.kind === "note" ? [n.note.id] : [])));
  return { ...walk, nodes: walk.nodes.map((n) => (n.kind === "note" ? { ...n, summary: lines[n.note.id] ?? null } : n)) };
}

/**
 * What the browser needs to walk by itself: every note in use by name, date
 * and tags, and how notes reach each other — no text. A store past
 * `STORE_NOTES_MAX` is not sent (`more`), and the walk asks the server per
 * click instead, so a very large store never pays this wait.
 */
export const STORE_NOTES_MAX = 3000;
/** Where the browser asks for it, and what a change to a note refreshes. */
export const WALK_STORE_URL = "/api/notes/walk-store";
export type WalkStore = {
  more: boolean;
  rows: TagRow[];
  notes: WebNote[];
  links: WebLink[];
  facts: { recording_id: string; subject: string }[];
  themes: { name: string; evidence: string[] }[];
  /** Pairs of notes that read alike: [earlier id, later id, 0 to 1] (`neighbour-table.ts`). */
  neighbours: [string, string, number][];
  /** The Brain outputs, each with the notes it joins (`walk-brain.ts`); sent for a store of any size. */
  brain: BrainRef[];
};

export function storeOf(input: WebInput, neighbours: [string, string, number][] = [], brain: BrainRef[] = []): WalkStore {
  if (input.notes.length > STORE_NOTES_MAX) return { more: true, rows: [], notes: [], links: [], facts: [], themes: [], neighbours: [], brain };
  // Only what groups notes: a subject said by more notes than that joins nothing (`SUBJECT_MAX_NOTES`).
  const said = new Map<string, Set<string>>();
  for (const f of input.facts) if (!isSelfSubject(f.subject)) said.set(f.subject.trim(), (said.get(f.subject.trim()) ?? new Set()).add(f.recording_id));
  const facts: { recording_id: string; subject: string }[] = [];
  for (const [subject, ids] of said) if (subject && ids.size > 1 && ids.size <= SUBJECT_MAX_NOTES) for (const id of ids) facts.push({ recording_id: id, subject });
  // Named field by field: whatever a read returned beyond these never reaches the browser.
  const notes = input.notes.map((n) => ({ id: n.id, path: n.path, label: n.label, recorded_at: n.recorded_at, tags: n.tags }));
  // Only pairs between notes in use: the rest could never be drawn.
  const inUse = new Set(notes.map((n) => n.id));
  const joined = brain.map((o) => ({ ...o, joins: o.joins.filter((id) => inUse.has(id)), quoted: o.quoted.filter((id) => inUse.has(id)) })).filter((o) => o.joins.length);
  return { more: false, rows: input.rows, notes, links: input.links, facts, themes: input.themes, neighbours: neighbours.filter(([a, b]) => inUse.has(a) && inUse.has(b)), brain: joined };
}

/** The walk's inputs, back from what the browser holds. */
export function inputOf(store: WalkStore): WebInput {
  return { rows: store.rows, notes: store.notes, links: store.links, facts: store.facts, themes: store.themes };
}
