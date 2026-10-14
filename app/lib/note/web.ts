// [Librarian, Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { noteName } from "@/lib/note/filing";
import type { LinkType } from "@/lib/note/links";
import { type Parents, type TagRow, above, canParent, parentsOf, under } from "@/lib/note/tag-tree";
import { loadTagRows } from "@/lib/note/vocabulary";

/**
 * The web: the person's tags as one picture, and the notes that join areas
 * the tags keep apart. A tag is drawn sized by its notes (carrying it or a tag
 * under it), with a solid line to each tag it sits under and a dashed one to
 * each the model suggests. A **bridge** joins two tags with no tag above
 * either in common, because a note in one and a note in the other are joined
 * — by a note link (kept or not yet asked, never turned down), a fact subject
 * both state, or a theme both are in — and the two notes' tags share nothing.
 * Every line carries why it is there. Only notes in use (the normal shelf,
 * the lists' notes) are drawn; no note's text is sent. Free: no model call.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** A note as the web needs it: no text. */
export type WebNote = { id: string; path: string | null; label: string; recorded_at: string; tags: string[] | null };
/** A note link stored later → earlier. */
export type WebLink = { from: string; to: string; type: LinkType; reason: string };

export interface WebInput {
  rows: TagRow[];
  /** When each parent was kept. */
  kept: { tag: string; parent: string; at: string | null }[];
  /** Parents the model suggests, still open. */
  asked: { tag: string; parent: string; why: string | null }[];
  notes: WebNote[];
  /** Links not turned down, between any notes. */
  links: WebLink[];
  facts: { recording_id: string; subject: string }[];
  themes: { name: string; evidence: string[] }[];
}

export type WebTag = { name: string; count: number; meaning: string | null };
/** A tag under a tag: kept by the person, or suggested and still asked. */
export type WebEdge = { tag: string; parent: string; kept: boolean; at: string | null; why: string | null };
export type NoteRef = { id: string; path: string | null; title: string };
export type Evidence =
  | { kind: "link"; from: NoteRef; to: NoteRef; type: LinkType; reason: string }
  | { kind: "subject"; subject: string; notes: [NoteRef, NoteRef] }
  | { kind: "theme"; theme: string; notes: [NoteRef, NoteRef] };
/** Two tags, by name in order, and what joins them; `n` counts all of it, `evidence` holds the first few. */
export type Bridge = { a: string; b: string; n: number; evidence: Evidence[] };

export type Web = { tags: WebTag[]; edges: WebEdge[]; bridges: Bridge[] };

/** One tag at the centre: its notes, the links among them, and the tags its bridges reach. */
export type TagWeb = {
  tag: string;
  meaning: string | null;
  notes: (NoteRef & { recorded_at: string; tags: string[] })[];
  links: Extract<Evidence, { kind: "link" }>[];
  /** Each tag outside reached by a bridge; every piece of evidence has one note inside. */
  bridges: { tag: string; n: number; evidence: Evidence[] }[];
};

/** How much evidence a bridge sends; the rest is counted. */
export const EVIDENCE_MAX = 5;
/**
 * A fact subject stated in more notes than this joins nothing in particular
 * (the speaker's own name, "money"); it is left out of bridges rather than
 * pairing every note with every other.
 */
export const SUBJECT_MAX_NOTES = 50;

const refOf = (note: WebNote): NoteRef => ({ id: note.id, path: note.path, title: noteName(note.path || "", note.label).replace(/\.md$/, "") });

/** Two notes whose areas share nothing, and what joins them. */
type Pair = { x: WebNote; y: WebNote; evidence: Evidence[] };

/**
 * Every pair of notes in use joined by a link, a fact subject or a theme,
 * whose tags have no tag above them in common. An untagged note is in no
 * area and bridges nothing.
 */
function bridgePairs(input: WebInput, parents: Parents): Pair[] {
  const byId = new Map(input.notes.map((note) => [note.id, note]));
  const area = new Map<string, Set<string>>();
  const areaOf = (note: WebNote) => {
    let out = area.get(note.id);
    if (!out) {
      out = new Set((note.tags || []).flatMap((tag) => [...above(tag, parents)]));
      area.set(note.id, out);
    }
    return out;
  };
  const apart = (x: WebNote, y: WebNote) => {
    const a = areaOf(x);
    const b = areaOf(y);
    return a.size > 0 && b.size > 0 && ![...a].some((tag) => b.has(tag));
  };

  const pairs = new Map<string, Pair>();
  const add = (xId: string, yId: string, evidence: (x: NoteRef, y: NoteRef) => Evidence) => {
    const x = byId.get(xId);
    const y = byId.get(yId);
    if (!x || !y || x.id === y.id || !apart(x, y)) return;
    const [p, q] = x.id < y.id ? [x, y] : [y, x];
    const key = `${p.id}\n${q.id}`;
    const pair = pairs.get(key) ?? { x: p, y: q, evidence: [] };
    pair.evidence.push(evidence(refOf(x), refOf(y)));
    pairs.set(key, pair);
  };

  for (const link of input.links) add(link.from, link.to, (from, to) => ({ kind: "link", from, to, type: link.type, reason: link.reason }));

  const groups = (rows: [string, string][]) => {
    const out = new Map<string, Set<string>>();
    for (const [name, id] of rows) if (name && byId.has(id)) out.set(name, (out.get(name) ?? new Set()).add(id));
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  for (const [subject, ids] of groups(input.facts.map((f) => [f.subject.trim(), f.recording_id]))) {
    if (ids.size > SUBJECT_MAX_NOTES) continue;
    const list = [...ids].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], (x, y) => ({ kind: "subject", subject, notes: [x, y] }));
  }
  for (const [theme, ids] of groups(input.themes.flatMap((t) => t.evidence.map((id) => [t.name.trim(), id] as [string, string])))) {
    const list = [...ids].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], (x, y) => ({ kind: "theme", theme, notes: [x, y] }));
  }
  return [...pairs.values()];
}

/** The tags in use and every tag above one, each with its notes counted by every route. */
function shownTags(input: WebInput, parents: Parents): WebTag[] {
  const meaning = new Map(input.rows.map((row) => [row.name, row.meaning ?? null]));
  const shown = new Set<string>();
  for (const note of input.notes) for (const tag of note.tags || []) for (const at of above(tag, parents)) shown.add(at);
  return [...shown]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const branch = under(name, parents);
      return { name, count: input.notes.filter((note) => (note.tags || []).some((tag) => branch.has(tag))).length, meaning: meaning.get(name) ?? null };
    });
}

/** The whole web. */
export function buildWeb(input: WebInput): Web {
  const parents = parentsOf(input.rows);
  const tags = shownTags(input, parents);
  const shown = new Set(tags.map((tag) => tag.name));
  const keptAt = new Map(input.kept.map((k) => [`${k.tag}\n${k.parent}`, k.at]));

  const edges: WebEdge[] = [];
  for (const tag of tags) for (const parent of [...(parents.get(tag.name) ?? [])].sort()) edges.push({ tag: tag.name, parent, kept: true, at: keptAt.get(`${tag.name}\n${parent}`) ?? null, why: null });
  for (const s of input.asked) {
    if (!shown.has(s.tag) || !shown.has(s.parent) || parents.get(s.tag)?.has(s.parent) || !canParent(s.tag, s.parent, parents)) continue;
    if (edges.some((e) => e.tag === s.tag && e.parent === s.parent)) continue;
    edges.push({ tag: s.tag, parent: s.parent, kept: false, at: null, why: s.why });
  }

  const bridges = new Map<string, Bridge>();
  for (const { x, y, evidence } of bridgePairs(input, parents)) {
    for (const p of x.tags || []) {
      for (const q of y.tags || []) {
        const [a, b] = p < q ? [p, q] : [q, p];
        const key = `${a}\n${b}`;
        const bridge = bridges.get(key) ?? { a, b, n: 0, evidence: [] };
        bridge.n += evidence.length;
        bridge.evidence.push(...evidence.slice(0, EVIDENCE_MAX - bridge.evidence.length));
        bridges.set(key, bridge);
      }
    }
  }
  return { tags, edges, bridges: [...bridges.values()].sort((p, q) => p.a.localeCompare(q.a) || p.b.localeCompare(q.b)) };
}

/** One tag at the centre; null when no note in use carries it or a tag under it. */
export function tagWeb(input: WebInput, tag: string): TagWeb | null {
  const parents = parentsOf(input.rows);
  const branch = under(tag, parents);
  const inside = input.notes.filter((note) => (note.tags || []).some((t) => branch.has(t)));
  if (!inside.length) return null;
  const ids = new Set(inside.map((note) => note.id));
  const byId = new Map(inside.map((note) => [note.id, note]));

  const links = input.links
    .filter((link) => ids.has(link.from) && ids.has(link.to))
    .map((link) => ({ kind: "link" as const, from: refOf(byId.get(link.from)!), to: refOf(byId.get(link.to)!), type: link.type, reason: link.reason }));

  const out = new Map<string, TagWeb["bridges"][number]>();
  for (const { x, y, evidence } of bridgePairs(input, parents)) {
    const away = ids.has(x.id) ? y : ids.has(y.id) ? x : null;
    if (!away) continue;
    for (const t of away.tags || []) {
      const bridge = out.get(t) ?? { tag: t, n: 0, evidence: [] };
      bridge.n += evidence.length;
      bridge.evidence.push(...evidence.slice(0, EVIDENCE_MAX - bridge.evidence.length));
      out.set(t, bridge);
    }
  }

  return {
    tag,
    meaning: input.rows.find((row) => row.name === tag)?.meaning ?? null,
    notes: inside
      .map((note) => ({ ...refOf(note), recorded_at: note.recorded_at, tags: note.tags || [] }))
      .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : a.id.localeCompare(b.id))),
    links,
    bridges: [...out.values()].sort((a, b) => a.tag.localeCompare(b.tag)),
  };
}

/** Every row a query names — a query returns at most 1,000 at a time. */
async function every<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (Array.isArray(data) ? data : []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** What the web is drawn from, for one account. */
export async function loadWeb(admin: Db, userId: string): Promise<WebInput> {
  const [rows, kept, asked, notes, links, facts, themes] = await Promise.all([
    loadTagRows(admin, userId),
    every<{ tag: string; parent: string; created_at: string | null }>((a, b) => admin.from("tag_parents").select("tag, parent, created_at").eq("user_id", userId).order("tag").order("parent").range(a, b)),
    every<{ tag: string; target: string; why: string | null }>((a, b) =>
      admin.from("tag_suggestions").select("tag, target, why").eq("user_id", userId).eq("kind", "parent").eq("state", "open").order("id").range(a, b)
    ),
    every<WebNote>((a, b) => admin.from("recordings").select("id, path, label, recorded_at, tags").eq("user_id", userId).eq("status", "done").eq("shelf", "normal").order("id").range(a, b)),
    every<{ from_recording: string; to_recording: string; link_type: LinkType; reason: string | null }>((a, b) =>
      admin
        .from("note_links")
        .select("from_recording, to_recording, link_type, reason")
        .eq("user_id", userId)
        .or("confirmed.is.null,confirmed.eq.true")
        .order("id")
        .range(a, b)
    ),
    every<{ recording_id: string; subject: string }>((a, b) =>
      admin.from("note_facts").select("recording_id, subject").eq("user_id", userId).gte("confidence", 0.5).order("id").range(a, b)
    ),
    every<{ name: string; evidence: string[] | null }>((a, b) => admin.from("note_themes").select("name, evidence").eq("user_id", userId).order("id").range(a, b)),
  ]);
  return {
    rows,
    kept: kept.map((k) => ({ tag: k.tag, parent: k.parent, at: k.created_at })),
    asked: asked.map((s) => ({ tag: s.tag, parent: s.target, why: s.why })),
    notes,
    links: links.map((l) => ({ from: l.from_recording, to: l.to_recording, type: l.link_type, reason: l.reason || "" })),
    facts: facts.filter((f) => typeof f.subject === "string"),
    themes: themes.map((t) => ({ name: t.name, evidence: t.evidence || [] })),
  };
}
