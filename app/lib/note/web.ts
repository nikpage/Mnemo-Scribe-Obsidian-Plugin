// [Librarian, Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinkType } from "@/lib/note/links";
import type { TagRow } from "@/lib/note/tag-tree";
import { loadTagRows } from "@/lib/note/vocabulary";
import { HIDDEN, outNotes, outputOut } from "@/lib/note/groups";

/**
 * What the Web and the Brain read of the person's notes: the tags and the
 * notes in use (the normal shelf, no text), and how notes reach each other
 * outside their tags — a note link (kept or not yet asked, never turned
 * down), a fact subject, a theme. Free: reads only, no model.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** A note as the Web needs it: no text. */
export type WebNote = { id: string; path: string | null; label: string; recorded_at: string; tags: string[] | null };
/** A note link stored later → earlier. */
export type WebLink = { from: string; to: string; type: LinkType; reason: string };

export interface WebInput {
  rows: TagRow[];
  notes: WebNote[];
  /** Links not turned down, between any notes. */
  links: WebLink[];
  facts: { recording_id: string; subject: string }[];
  themes: { name: string; evidence: string[] }[];
}

export type NoteRef = { id: string; path: string | null; title: string };

/**
 * A fact subject stated in more notes than this joins nothing in particular
 * (the speaker's own name, "money"); it is left out rather than pairing every
 * note with every other.
 */
export const SUBJECT_MAX_NOTES = 50;

/** The word a fact uses for its speaker: two notes sharing it say nothing about each other. */
const SELF_WORDS = new Set(["me", "i", "myself", "my", "já", "ja", "mě", "mne", "mně", "mi", "sám", "sama"]);
export const isSelfSubject = (subject: string) => SELF_WORDS.has(subject.trim().toLowerCase());

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

/** How notes reach each other outside their tags: a note link, a fact subject, a theme. */
export interface Routes {
  /** Every link between notes, turned-down ones included (`confirmed === false`). */
  links: (WebLink & { confirmed: boolean | null })[];
  facts: { recording_id: string; subject: string }[];
  themes: { name: string; evidence: string[] }[];
}

/** The routes between one account's notes. A turned-down link comes back marked, never dropped. */
export async function loadRoutes(admin: Db, userId: string): Promise<Routes> {
  const [links, facts, threads, out] = await Promise.all([
    every<{ from_recording: string; to_recording: string; link_type: LinkType; reason: string | null; confirmed: boolean | null }>((a, b) =>
      admin.from("note_links").select("from_recording, to_recording, link_type, reason, confirmed").eq("user_id", userId).order("id").range(a, b)
    ),
    every<{ recording_id: string; subject: string }>((a, b) =>
      admin.from("note_facts").select("recording_id, subject").eq("user_id", userId).gte("confidence", 0.5).order("id").range(a, b)
    ),
    every<{ name: string; evidence: string[] | null; read_ids: string[] | null }>((a, b) => admin.from("note_themes").select("name, evidence, read_ids").eq("user_id", userId).order("id").range(a, b)),
    outNotes(admin, userId),
  ]);
  // A theme a group now puts out joins nothing (`lib/note/groups.ts`).
  const themes = threads.filter((t) => !outputOut({ shows: t.evidence ?? [], read: t.read_ids }, out));
  return {
    links: links.map((l) => ({ from: l.from_recording, to: l.to_recording, type: l.link_type, reason: l.reason || "", confirmed: l.confirmed })),
    facts: facts.filter((f) => typeof f.subject === "string"),
    themes: themes.map((t) => ({ name: t.name, evidence: t.evidence || [] })),
  };
}

/** What the Web is drawn from, for one account. */
export async function loadWeb(admin: Db, userId: string): Promise<WebInput> {
  const [rows, notes, routes] = await Promise.all([
    loadTagRows(admin, userId),
    every<WebNote>((a, b) => admin.from("recordings").select("id, path, label, recorded_at, tags").eq("user_id", userId).eq("status", "done").eq("shelf", "normal").neq(HIDDEN, true).order("id").range(a, b)),
    loadRoutes(admin, userId),
  ]);
  return {
    rows,
    notes,
    links: routes.links.filter((l) => l.confirmed !== false).map((l) => ({ from: l.from, to: l.to, type: l.type, reason: l.reason })),
    facts: routes.facts,
    themes: routes.themes,
  };
}
