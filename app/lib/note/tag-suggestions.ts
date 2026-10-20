// [Filer, Librarian]

import type { SupabaseClient } from "@supabase/supabase-js";
import { claim, release } from "@/lib/ai/claim";
import { noteText } from "@/lib/note/build";
import { isMnemo, normalizeSegment, normalizeTags, singular } from "@/lib/note/filing";
import { primaryLanguage } from "@/lib/note/language";
import { READ } from "@/lib/note/shelf";
import { storyMeaning } from "@/lib/note/stories";
import { loadSubjects } from "@/lib/note/subjects";
import { canParent, parentsOf } from "@/lib/note/tag-tree";
import { type Earned, type OwnTag, type Proposal, type TagSummary, barred, checkNotes, planTags, quoted, tagNote } from "@/lib/note/tagging";
import { addParents, applyVocabulary, withParents, joinKnown, loadTagRows, loadVocabulary, rememberTags } from "@/lib/note/vocabulary";

/**
 * Everything the app asks before it changes a tag, and what happens when the
 * person answers. A skipped suggestion is never asked again (the table's
 * unique index); a kept one is carried out here, the one place tags change
 * across many notes at once.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export const KINDS = ["new", "meaning", "merge", "retire", "parent", "add", "remove"] as const;
export type Kind = (typeof KINDS)[number];
export type Source = "model" | "spoken" | "folder" | "tidy";

export interface Suggestion {
  id: string;
  kind: Kind;
  tag: string;
  target: string;
  recording_id: string;
  meaning: string | null;
  notes: { id: string; why: string }[];
  why: string | null;
  source: Source;
}

/** A tag the model thinks notes need shows once this many notes need it. */
export const NEW_TAG_NOTES = 2;

/**
 * Whether the person is asked yet. A tag the model proposes waits for a
 * second note, unless one of its notes has no tag at all: a bare note is
 * asked about at once. One the person said out loud, a folder they used, or
 * a tidy-up's is asked at once too.
 */
export function shown(s: Pick<Suggestion, "kind" | "source" | "notes">, bare: (noteId: string) => boolean = () => false): boolean {
  return s.kind !== "new" || s.source !== "model" || s.notes.length >= NEW_TAG_NOTES || s.notes.some((n) => bare(n.id));
}

/** The tags the person has, with their meanings: those in use, and those given a meaning. */
export async function ownTags(admin: Admin, userId: string, inUse: string[]): Promise<(OwnTag & { parents: string[]; checked: string | null })[]> {
  const [{ data }, { data: links }] = await Promise.all([
    admin.from("tag_vocabulary").select("name, meaning, checked_meaning").eq("user_id", userId),
    admin.from("tag_parents").select("tag, parent").eq("user_id", userId),
  ]);
  const used = new Set(inUse);
  return withParents((Array.isArray(data) ? data : []) as { name: string; meaning: string | null; checked_meaning: string | null }[], links)
    .filter((row) => row.meaning || used.has(row.name))
    .map((row) => ({
      name: row.name,
      meaning: row.meaning ?? null,
      parents: row.parents,
      checked: row.checked_meaning ?? null,
    }));
}

/** New tags already asked about and skipped (or, with `any`, asked at all): never proposed again. */
export async function skippedNames(admin: Admin, userId: string, any = false): Promise<Set<string>> {
  const query = admin.from("tag_suggestions").select("tag").eq("user_id", userId).eq("kind", "new");
  const { data } = await (any ? query : query.eq("state", "skipped"));
  return new Set((data || []).map((row: { tag: string }) => row.tag));
}

/**
 * The questions waiting for the person, as the Tags screen shows them: a
 * model's new tag once two notes need it or one of them has no tag, and no
 * add or remove the person already made by hand. Each with its notes' titles.
 */
export async function openQuestions(admin: Admin, userId: string): Promise<(Suggestion & { title: string; notes: { id: string; why: string; title: string }[] })[]> {
  const { data } = await admin
    .from("tag_suggestions")
    .select("id, kind, tag, target, recording_id, meaning, notes, why, source")
    .eq("user_id", userId)
    .eq("state", "open")
    .order("created_at", { ascending: true });
  const all = (data || []) as Suggestion[];
  const ids = [...new Set(all.flatMap((s) => (s.recording_id ? [s.recording_id] : s.notes.map((n) => n.id))))];
  const { data: notes } = ids.length
    ? await admin.from("recordings").select("id, label, tags").eq("user_id", userId).in("id", ids)
    : { data: [] };
  const byId = new Map((notes || []).map((n: { id: string; label: string; tags: string[] | null }) => [n.id, n]));
  const bare = (id: string) => byId.has(id) && (byId.get(id)!.tags || []).length === 0;
  return all
    .filter((s) => shown(s, bare))
    .filter((s) => {
      if (s.kind !== "add" && s.kind !== "remove") return true;
      const note = byId.get(s.recording_id);
      return Boolean(note) && (s.kind === "add") !== (note!.tags || []).includes(s.tag);
    })
    .map((s) => ({
      ...s,
      notes: s.notes.map((n) => ({ ...n, title: byId.get(n.id)?.label ?? "" })),
      title: s.recording_id ? (byId.get(s.recording_id)?.label ?? "") : "",
    }));
}

/** New tags and parents the person turned down, newest first, each with its notes' titles: restorable. */
export async function turnedDown(admin: Admin, userId: string): Promise<(Pick<Suggestion, "id" | "kind" | "tag" | "target" | "meaning"> & { notes: string[] })[]> {
  const { data } = await admin
    .from("tag_suggestions")
    .select("id, kind, tag, target, meaning, notes")
    .eq("user_id", userId)
    .eq("state", "skipped")
    .in("kind", ["new", "parent"])
    .not("decided_at", "is", null)
    .order("decided_at", { ascending: false })
    .limit(100);
  const rows = (data || []) as Pick<Suggestion, "id" | "kind" | "tag" | "target" | "meaning" | "notes">[];
  const ids = [...new Set(rows.flatMap((s) => s.notes.map((n) => n.id)))];
  const { data: notes } = ids.length ? await admin.from("recordings").select("id, label").eq("user_id", userId).in("id", ids) : { data: [] };
  const title = new Map((notes || []).map((n: { id: string; label: string }) => [n.id, n.label]));
  return rows.map((s) => ({ ...s, notes: s.notes.flatMap((n) => (title.has(n.id) ? [title.get(n.id)!] : [])) }));
}

/**
 * The new tags asked about for one note, whatever else needs them, and the
 * `mnemo-` tags asked about on it alone (`story`): shown on the note itself.
 */
export async function noteQuestions(
  admin: Admin,
  userId: string,
  noteId: string
): Promise<{ id: string; tag: string; meaning: string | null; parent: string; why: string; notes: number; story?: true }[]> {
  const [{ data }, { data: stories }, { data: note }] = await Promise.all([
    admin.from("tag_suggestions").select("id, tag, target, meaning, notes").eq("user_id", userId).eq("state", "open").eq("kind", "new").contains("notes", [{ id: noteId }]),
    admin.from("tag_suggestions").select("id, tag, why").eq("user_id", userId).eq("state", "open").eq("kind", "add").eq("recording_id", noteId).like("tag", "mnemo-%"),
    admin.from("recordings").select("tags").eq("user_id", userId).eq("id", noteId).maybeSingle(),
  ]);
  const has = new Set((note?.tags as string[] | null) || []);
  const meanings = new Map((await loadTagRows(admin, userId)).map((r) => [r.name, r.meaning]));
  const lang = await primaryLanguage(admin, userId);
  return [
    ...((data || []) as Pick<Suggestion, "id" | "tag" | "target" | "meaning" | "notes">[]).map((s) => ({
      id: s.id,
      tag: s.tag,
      meaning: s.meaning,
      parent: s.target,
      why: s.notes.find((n) => n.id === noteId)?.why ?? "",
      notes: s.notes.length,
    })),
    ...((stories || []) as Pick<Suggestion, "id" | "tag" | "why">[])
      .filter((s) => !has.has(s.tag))
      .map((s) => ({ id: s.id, tag: s.tag, meaning: storyMeaning(s.tag, lang) ?? meanings.get(s.tag) ?? null, parent: "", why: s.why ?? "", notes: 1, story: true as const })),
  ];
}

/**
 * The `mnemo-` tags that seem to fit a note, asked on that note at once and
 * never put on it unasked: each is the person's to keep or skip, note by
 * note. Never throws: a question lost costs a question, never the note.
 */
export async function askOnNote(admin: Admin, userId: string, noteId: string, asks: Earned[]): Promise<void> {
  const rows = asks.filter((a) => isMnemo(a.tag)).map((a) => ({ ...blank, kind: "add" as const, tag: a.tag, recording_id: noteId, why: a.why, source: "model" as const }));
  try {
    await ask(admin, userId, rows);
  } catch (err) {
    console.error("Story tag question not saved (non-fatal):", err);
  }
}

/**
 * The tag each thread through the store offers its notes, asked about at once
 * like a tidy-up's. A tag the person already has, skipped, or may not hold is
 * not offered; nothing goes on a note until they keep it.
 */
export async function proposeThemeTags(admin: Admin, userId: string, themes: { evidence: string[]; tag?: { name: string; meaning: string } }[]): Promise<void> {
  const subjects = await clientNames(admin, userId);
  const own = new Set((await loadTagRows(admin, userId)).map((r) => r.name));
  const skipped = await skippedNames(admin, userId);
  for (const theme of themes) {
    const tag = normalizeSegment(theme.tag?.name ?? "");
    if (!tag || isMnemo(tag) || own.has(tag) || skipped.has(tag) || barred(tag, subjects)) continue;
    for (const noteId of theme.evidence) {
      await proposeTags(admin, userId, noteId, [{ tag, meaning: theme.tag!.meaning, parent: null, why: "" }], "tidy");
    }
  }
}

/** The names the person's clients go by: never tags. */
export async function clientNames(admin: Admin, userId: string): Promise<string[]> {
  return (await loadSubjects(admin, userId)).flatMap((s) => [s.name, ...s.aliases]);
}

/**
 * Records new tags a note seems to need, or adds the note to a proposal
 * already open (in either spelling). Never throws: a proposal lost costs a
 * question, never the note.
 */
export async function proposeTags(admin: Admin, userId: string, noteId: string, proposals: Proposal[], source: Source): Promise<void> {
  if (proposals.length === 0) return;
  try {
    const { data } = await admin
      .from("tag_suggestions")
      .select("id, tag, state, notes")
      .eq("user_id", userId)
      .eq("kind", "new");
    const rows = (data || []) as { id: string; tag: string; state: string; notes: { id: string; why: string }[] }[];
    for (const p of proposals) {
      const known = rows.find((row) => singular(row.tag) === singular(p.tag));
      if (known && known.state !== "open") continue;
      if (known) {
        if (known.notes.some((n) => n.id === noteId)) continue;
        known.notes = [...known.notes, { id: noteId, why: p.why }];
        await admin.from("tag_suggestions").update({ notes: known.notes }).eq("user_id", userId).eq("id", known.id);
        continue;
      }
      const { data: made } = await admin
        .from("tag_suggestions")
        .insert({
          user_id: userId,
          kind: "new",
          tag: p.tag,
          target: p.parent ?? "",
          meaning: p.meaning,
          notes: [{ id: noteId, why: p.why }],
          source,
        })
        .select("id, tag, state, notes")
        .single();
      if (made) rows.push(made);
    }
  } catch (err) {
    console.error("Tag proposal not saved (non-fatal):", err);
  }
}

/** One note's tags changed, with the sentences that earned them. */
async function retag(
  admin: Admin,
  userId: string,
  noteId: string,
  change: (tags: string[], why: Record<string, string>) => { tags: string[]; why: Record<string, string> }
): Promise<void> {
  const { data: note } = await admin
    .from("recordings")
    .select("tags, tag_why")
    .eq("user_id", userId)
    .eq("id", noteId)
    .maybeSingle();
  if (!note) return;
  const before = (note.tags || []) as string[];
  const next = change([...before], { ...((note.tag_why || {}) as Record<string, string>) });
  const tags = normalizeTags(next.tags);
  const why = Object.fromEntries(Object.entries(next.why).filter(([tag]) => tags.includes(tag)));
  await admin
    .from("recordings")
    .update({ tags, tag_why: why, filed: true, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", noteId);
}

/** Every note carrying `tag`, by id. */
async function carrying(admin: Admin, userId: string, tag: string): Promise<string[]> {
  const { data } = await admin.from("recordings").select("id").eq("user_id", userId).contains("tags", [tag]);
  return (data || []).map((row: { id: string }) => row.id);
}

/** The person's answer to one suggestion, beyond keep or skip. */
export interface Edit {
  /** A new tag's name, as the person changed it. */
  name?: string;
  meaning?: string;
  target?: string;
  /** Delete the tag instead of what was asked (a meaning, a merge, a parent). */
  retire?: boolean;
  /** Notes whose only tag goes, to the tag each gets instead. */
  moves?: Record<string, string>;
}

/**
 * Takes a tag out of the vocabulary and the tree: the tags under it go under
 * `heirs` instead (what it merged into, or the tags it sat under), never
 * losing a parent they had elsewhere.
 */
async function dropTag(admin: Admin, userId: string, tag: string, heirs: string[]): Promise<void> {
  const children = (await loadTagRows(admin, userId)).filter((r) => r.parents.includes(tag)).map((r) => r.name);
  await admin.from("tag_parents").delete().eq("user_id", userId).eq("tag", tag);
  await admin.from("tag_parents").delete().eq("user_id", userId).eq("parent", tag);
  await addParents(admin, userId, children.flatMap((child) => heirs.filter((h) => h !== child && h !== tag).map((h) => [child, h] as [string, string])));
  await admin.from("tag_vocabulary").delete().eq("user_id", userId).eq("name", tag);
}

/**
 * Carries out or skips one suggestion. `edit` is the person's change before
 * keeping it: a reworded meaning, another parent, another tag to merge into,
 * or the tag deleted instead, with the notes it leaves bare moved to another.
 * Returns false when the suggestion is not this person's or already answered.
 * `was: "skipped"` restores one the person turned down: kept, exactly as a
 * keep, and never one the app closed itself (no `decided_at`).
 */
export async function decide(admin: Admin, userId: string, id: string, keep: boolean, edit: Edit = {}, was: "open" | "skipped" = "open"): Promise<boolean> {
  const { data: row } = await admin
    .from("tag_suggestions")
    .select("id, kind, tag, target, recording_id, meaning, notes, why, source, state, decided_at")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (!row || row.state !== was || (was === "skipped" && !row.decided_at)) return false;
  const s = row as Suggestion & { state: string };
  if (edit.retire && keep && s.kind !== "new" && s.kind !== "add" && s.kind !== "remove") s.kind = "retire";
  const meaning = (edit.meaning ?? s.meaning ?? "").trim() || null;
  const target = edit.target !== undefined ? normalizeSegment(edit.target) : s.target;

  if (keep) {
    const now = new Date().toISOString();
    if (s.kind === "new") {
      // The person's name for it; one that is already theirs keeps what it has.
      const tag = (edit.name !== undefined && normalizeSegment(edit.name)) || s.tag;
      if (barred(tag, await clientNames(admin, userId))) return false;
      const had = (await loadTagRows(admin, userId)).find((r) => r.name === tag);
      await rememberTags(admin, userId, target ? [tag, target] : [tag], true);
      await admin
        .from("tag_vocabulary")
        .update({ meaning: had?.meaning ?? meaning, updated_at: now })
        .eq("user_id", userId)
        .eq("name", tag);
      // One more parent; one that would loop is dropped (`addParents`).
      if (target && target !== tag) await addParents(admin, userId, [[tag, target]]);
      for (const note of s.notes) {
        await retag(admin, userId, note.id, (tags, why) => ({ tags: [...tags, tag], why: { ...why, [tag]: note.why } }));
      }
    } else if (s.kind === "meaning") {
      await rememberTags(admin, userId, [s.tag], true);
      await admin.from("tag_vocabulary").update({ meaning, updated_at: now }).eq("user_id", userId).eq("name", s.tag);
    } else if (s.kind === "merge") {
      if (!target || target === s.tag) return false;
      await rememberTags(admin, userId, [target], true);
      for (const noteId of await carrying(admin, userId, s.tag)) {
        await retag(admin, userId, noteId, (tags, why) => ({
          tags: [...tags.filter((tag) => tag !== s.tag), target],
          why: { ...(why[s.tag] !== undefined ? { [target]: why[s.tag] } : {}), ...why },
        }));
      }
      const { data: into } = await admin.from("tag_vocabulary").select("aliases").eq("user_id", userId).eq("name", target).maybeSingle();
      await admin
        .from("tag_vocabulary")
        .update({ aliases: normalizeTags([...((into?.aliases as string[]) || []), s.tag]), updated_at: now })
        .eq("user_id", userId)
        .eq("name", target);
      await dropTag(admin, userId, s.tag, [target]);
    } else if (s.kind === "retire") {
      // A note left bare goes to the tag the person ticked, if that tag is theirs.
      const theirs = new Set(edit.moves ? (await loadTagRows(admin, userId)).map((r) => r.name) : []);
      for (const noteId of await carrying(admin, userId, s.tag)) {
        const to = normalizeSegment(edit.moves?.[noteId] ?? "");
        await retag(admin, userId, noteId, (tags, why) => {
          const rest = tags.filter((tag) => tag !== s.tag);
          return rest.length === 0 && to && to !== s.tag && theirs.has(to) ? { tags: [to], why: { ...why, [to]: why[to] ?? "" } } : { tags: rest, why };
        });
      }
      await dropTag(admin, userId, s.tag, (await loadTagRows(admin, userId)).find((r) => r.name === s.tag)?.parents ?? []);
    } else if (s.kind === "parent") {
      if (!target || target === s.tag) return false;
      await rememberTags(admin, userId, [s.tag, target], true);
      const rows = await loadTagRows(admin, userId);
      if (!canParent(s.tag, target, parentsOf(rows))) return false;
      await addParents(admin, userId, [[s.tag, target]]);
      // A new top-level tag comes with the meaning it was proposed with.
      if (meaning && !rows.find((r) => r.name === target)?.meaning) {
        await admin.from("tag_vocabulary").update({ meaning, updated_at: now }).eq("user_id", userId).eq("name", target);
      }
    } else if (s.kind === "add") {
      await retag(admin, userId, s.recording_id, (tags, why) => ({ tags: [...tags, s.tag], why: { ...why, [s.tag]: s.why ?? "" } }));
    } else if (s.kind === "remove") {
      await retag(admin, userId, s.recording_id, (tags, why) => ({ tags: tags.filter((tag) => tag !== s.tag), why }));
    }
  }

  await admin
    .from("tag_suggestions")
    .update({ state: keep ? "kept" : "skipped", decided_at: new Date().toISOString(), ...(keep ? { meaning, target } : {}) })
    .eq("user_id", userId)
    .eq("id", id);
  return true;
}

/** The notes the tag work reads: finished, on the shelves the AI may read. */
async function readableNotes(admin: Admin, userId: string) {
  const { data } = await admin
    .from("recordings")
    .select("id, label, tags, tag_why, body_md, transcript, analysis")
    .eq("user_id", userId)
    .eq("status", "done")
    .in("shelf", READ)
    .eq("report", false);
  return (data || []) as {
    id: string;
    label: string;
    tags: string[] | null;
    tag_why: Record<string, string> | null;
    body_md: string | null;
    transcript: { utterances?: { text?: string }[] } | null;
    analysis: { summary?: string } | null;
  }[];
}

/** Saves suggestions, never re-asking one already answered. */
async function ask(admin: Admin, userId: string, rows: Omit<Suggestion, "id">[]): Promise<void> {
  if (rows.length === 0) return;
  await admin
    .from("tag_suggestions")
    .upsert(rows.map((row) => ({ user_id: userId, ...row })), { onConflict: "user_id,kind,tag,target,recording_id", ignoreDuplicates: true });
}

const blank: Pick<Suggestion, "target" | "recording_id" | "meaning" | "notes" | "why"> = { target: "", recording_id: "", meaning: null, notes: [], why: null };

/**
 * A tidy-up: one look at every tag and the notes carrying it. Meanings for
 * tags without one are written in; merges, parents and new top-level tags are
 * saved as suggestions. A tag on fewer than two notes is offered for
 * retirement without asking a model.
 */
export async function tidy(admin: Admin, userId: string, runId: string): Promise<void> {
  // A meaning is written, not asked: questions about one from before are closed.
  // Closed by the app, not turned down: no `decided_at`, so never listed as the person's "no".
  await admin.from("tag_suggestions").update({ state: "skipped" }).eq("user_id", userId).eq("kind", "meaning").eq("state", "open");
  const notes = await readableNotes(admin, userId);
  const inUse = [...new Set(notes.flatMap((n) => n.tags || []))];
  // A `mnemo-` tag is the person's alone: never given a meaning, merged, retired or moved here.
  const own = (await ownTags(admin, userId, inUse)).filter((tag) => !isMnemo(tag.name));
  // A note with one tag is marked, and listed first, so the plan says where it would go.
  const alone = notes.filter((n) => (n.tags || []).length === 1);
  const ref = new Map(alone.map((n, i) => [n.id, `n${i + 1}`]));
  const summaries: TagSummary[] = own.map((tag) => ({
    name: tag.name,
    meaning: tag.meaning,
    parents: tag.parents,
    notes: notes
      .filter((n) => (n.tags || []).includes(tag.name))
      .sort((a, b) => Number(ref.has(b.id)) - Number(ref.has(a.id)))
      .map((n) => ({ title: n.label, summary: n.analysis?.summary || noteText(n).slice(0, 240), ref: ref.get(n.id) })),
  }));
  const ctx = { userId };
  const subjects = await clientNames(admin, userId);
  const plan = await planTags(summaries, { lang: await primaryLanguage(admin, userId), subjects, asked: await skippedNames(admin, userId, true), ctx });

  for (const m of plan.meanings) {
    await admin.from("tag_vocabulary").update({ meaning: m.meaning, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("name", m.tag).is("meaning", null);
  }
  const thin = summaries.filter((t) => t.notes.length < 2 && !plan.merges.some((m) => m.tag === t.name));
  await closeStale(admin, userId, notes, own, subjects, new Set(thin.map((t) => t.name)));
  await ask(admin, userId, [
    ...thin.map((t) => ({ ...blank, kind: "retire" as const, tag: t.name, why: t.notes.length ? "one note" : "no notes", source: "tidy" as const })),
    ...plan.merges.map((m) => ({ ...blank, kind: "merge" as const, tag: m.tag, target: m.into, why: m.why, source: "tidy" as const })),
    ...plan.parents.map((p) => ({ ...blank, kind: "parent" as const, tag: p.tag, target: p.parent, source: "tidy" as const })),
    ...plan.groups.flatMap((g) => g.children.map((c) => ({ ...blank, kind: "parent" as const, tag: c, target: g.tag, meaning: g.meaning, why: g.why, source: "tidy" as const }))),
  ]);
  const byRef = new Map(plan.moves.map((m) => [m.ref, m.tag]));
  for (const tag of own) {
    const moves = Object.fromEntries(alone.filter((n) => n.tags![0] === tag.name).map((n) => [n.id, byRef.get(ref.get(n.id)!) ?? ""]));
    await admin.from("tag_vocabulary").update({ moves }).eq("user_id", userId).eq("name", tag.name);
  }
  await finish(admin, userId, runId);
}

/**
 * Open questions a tidy-up would no longer ask, closed: a retirement for a
 * tag now on two notes or more, and a new tag the filing rules now bar — one
 * the person has in any spelling, one nobody may hold, one without a meaning,
 * or one no readable note still quotes. A tag the person said or a folder
 * gave (`spoken`, `folder`) is theirs, never closed here.
 */
async function closeStale(
  admin: Admin,
  userId: string,
  notes: Awaited<ReturnType<typeof readableNotes>>,
  own: { name: string }[],
  subjects: string[],
  thin: Set<string>
): Promise<void> {
  const { data } = await admin
    .from("tag_suggestions")
    .select("id, kind, tag, meaning, notes, source")
    .eq("user_id", userId)
    .eq("state", "open")
    .in("kind", ["retire", "new"]);
  const names = new Set(own.map((t) => singular(t.name)));
  const text = new Map(notes.map((n) => [n.id, noteText(n)]));
  const stands = (s: Pick<Suggestion, "source" | "notes">) =>
    s.notes.some((n) => text.has(n.id) && ((s.source === "tidy" && !n.why) || quoted(n.why, text.get(n.id)!)));
  const stale = ((data || []) as Pick<Suggestion, "id" | "kind" | "tag" | "meaning" | "notes" | "source">[]).filter((s) =>
    s.kind === "retire"
      ? !thin.has(s.tag)
      : (s.source === "model" || s.source === "tidy") &&
        (names.has(singular(s.tag)) || barred(s.tag, subjects) || !s.meaning?.trim() || !stands(s))
  );
  if (stale.length === 0) return;
  await admin
    .from("tag_suggestions")
    .update({ state: "skipped" })
    .eq("user_id", userId)
    .in("id", stale.map((s) => s.id));
}

/**
 * Every note read again against each tag whose meaning changed since the
 * last check, as suggestions to add or remove that tag. A tag the person
 * gave a note (typed, said, from a vault) is never offered for removal.
 */
export async function recheck(admin: Admin, userId: string, runId: string): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const notes = await readableNotes(admin, userId);
    const own = await ownTags(admin, userId, [...new Set(notes.flatMap((n) => n.tags || []))]);
    // A `mnemo-` tag is never re-checked: only the person adds or removes one.
    const due = own.filter((tag) => tag.meaning && tag.meaning !== tag.checked && !isMnemo(tag.name));
    if (due.length === 0) break;
    const verdicts = await checkNotes(
      notes.map((n) => ({ id: n.id, text: noteText(n) })),
      due,
      { subjects: await clientNames(admin, userId), ctx: { userId } }
    );
    await ask(admin, userId, changesFrom(notes, due.map((t) => t.name), verdicts));
    // A tag already on a note and found to fit gets its sentence: nothing changes but the why.
    for (const note of notes) {
      const found = foundWhy(note, verdicts.get(note.id) || []);
      if (found) await admin.from("recordings").update({ tag_why: found }).eq("user_id", userId).eq("id", note.id);
    }
    for (const tag of due) {
      await admin.from("tag_vocabulary").update({ checked_meaning: tag.meaning }).eq("user_id", userId).eq("name", tag.name);
    }
    await askForBare(admin, userId, notes, verdicts);
  }
  await finish(admin, userId, runId);
}

/**
 * A note with no tag that the re-check found none for: the tag it needs is
 * asked about, as a note being filed would be.
 */
async function askForBare(admin: Admin, userId: string, notes: Awaited<ReturnType<typeof readableNotes>>, verdicts: Map<string, Earned[]>): Promise<void> {
  const bare = notes.filter((n) => (n.tags || []).length === 0 && (verdicts.get(n.id) || []).length === 0);
  if (bare.length === 0) return;
  const own = await ownTags(admin, userId, await tagsInUse(admin, userId));
  const opts = { lang: await primaryLanguage(admin, userId), subjects: await clientNames(admin, userId), ctx: { userId } };
  const { data: open } = await admin.from("tag_suggestions").select("notes").eq("user_id", userId).eq("kind", "new").eq("state", "open");
  const asked = new Set(((open || []) as { notes: { id: string }[] }[]).flatMap((s) => s.notes.map((n) => n.id)));
  for (const note of bare.filter((n) => !asked.has(n.id))) {
    const read = await tagNote({ text: noteText(note) }, own, { ...opts, asked: await skippedNames(admin, userId) });
    await proposeTags(admin, userId, note.id, read.proposed, "model");
  }
}

/**
 * A note's sentences once a re-check found the tags it already carries fit:
 * each such tag without one gets the quote. Null when nothing is new. A tag
 * the person gave ("") keeps saying so.
 */
export function foundWhy(note: { tags: string[] | null; tag_why: Record<string, string> | null }, fits: Earned[]): Record<string, string> | null {
  const why = { ...(note.tag_why || {}) };
  let changed = false;
  for (const f of fits) {
    if ((note.tags || []).includes(f.tag) && why[f.tag] === undefined) {
      why[f.tag] = f.why;
      changed = true;
    }
  }
  return changed ? why : null;
}

/** What a re-check found, as suggestions: a tag that fits and is missing, one that is there and does not fit. */
export function changesFrom(
  notes: { id: string; tags: string[] | null; tag_why: Record<string, string> | null }[],
  checked: string[],
  verdicts: Map<string, Earned[]>
): Omit<Suggestion, "id">[] {
  const out: Omit<Suggestion, "id">[] = [];
  for (const note of notes) {
    const fits = verdicts.get(note.id);
    if (!fits) continue;
    const has = new Set(note.tags || []);
    for (const tag of checked.filter((tag) => !isMnemo(tag))) {
      const earned = fits.find((f) => f.tag === tag);
      if (earned && !has.has(tag)) out.push({ ...blank, kind: "add", tag, recording_id: note.id, why: earned.why, source: "tidy" });
      const given = (note.tag_why || {})[tag] === "";
      if (!earned && has.has(tag) && !given) out.push({ ...blank, kind: "remove", tag, recording_id: note.id, source: "tidy" });
    }
  }
  return out;
}

async function finish(admin: Admin, userId: string, runId: string): Promise<void> {
  await admin.from("tag_runs").update({ status: "done", finished_at: new Date().toISOString() }).eq("user_id", userId).eq("id", runId);
}

/** One tidy-up or re-check per account at a time, held until it is written. */
export const TAGS_CLAIM = "tags:run";
/** Netlify's ceiling for a background function: a run older than this died. */
export const TAG_RUN_MS = 15 * 60 * 1000;

/** Runs one recorded tidy-up or re-check. Never throws: it runs in the background. */
export async function runTags(admin: Admin, runId: string): Promise<void> {
  const { data: run } = await admin.from("tag_runs").select("id, user_id, kind").eq("id", runId).maybeSingle();
  if (!run) return;
  try {
    if (run.kind === "tidy") {
      await tidy(admin, run.user_id, run.id);
      // Meanings the tidy-up wrote are read against every note at once, unless it asked something first.
      if (await recheckDue(admin, run.user_id)) await recheck(admin, run.user_id, run.id);
    } else await recheck(admin, run.user_id, run.id);
  } catch (err) {
    console.error(`Tag ${run.kind} failed:`, err);
    await admin
      .from("tag_runs")
      .update({ status: "failed", error: err instanceof Error ? err.message.slice(0, 300) : "failed", finished_at: new Date().toISOString() })
      .eq("user_id", run.user_id)
      .eq("id", run.id);
  } finally {
    await release(admin, run.user_id, TAGS_CLAIM);
  }
}

/**
 * Records a run and starts it: on Netlify in the background function, under
 * `next dev` here. Null when one is already running for this account.
 */
export async function startRun(admin: Admin, userId: string, kind: "tidy" | "recheck", base: string): Promise<string | null> {
  if (!(await claim(admin, userId, TAGS_CLAIM, TAG_RUN_MS))) return null;
  const { data: run, error } = await admin.from("tag_runs").insert({ user_id: userId, kind }).select("id").single();
  if (error || !run) {
    await release(admin, userId, TAGS_CLAIM);
    return null;
  }
  if (process.env.SITE_ID) {
    const started = await fetch(new URL("/.netlify/functions/tags-background", base), {
      method: "POST",
      headers: { "x-cron-key": process.env.CRON_SECRET ?? "" },
      body: JSON.stringify({ runId: run.id }),
    }).catch((err: unknown) => err);
    if (!(started instanceof Response) || started.status !== 202) {
      await admin
        .from("tag_runs")
        .update({ status: "failed", error: "background function did not start" })
        .eq("user_id", userId)
        .eq("id", run.id);
      await release(admin, userId, TAGS_CLAIM);
      return null;
    }
  } else {
    await runTags(admin, run.id);
  }
  return run.id;
}

/** Structural questions still open: the tags themselves are not settled yet. */
const SHAPING: Kind[] = ["new", "meaning", "merge", "retire", "parent"];

/**
 * Whether every note should be read again now: some tag's meaning changed
 * since the last check and nothing about the tags themselves is still open.
 */
export async function recheckDue(admin: Admin, userId: string): Promise<boolean> {
  const { data: open } = await admin
    .from("tag_suggestions")
    .select("kind, source, notes")
    .eq("user_id", userId)
    .eq("state", "open")
    .in("kind", SHAPING);
  if ((open || []).some((s: Pick<Suggestion, "kind" | "source" | "notes">) => shown(s))) return false;
  const { data: tags } = await admin.from("tag_vocabulary").select("meaning, checked_meaning").eq("user_id", userId).not("meaning", "is", null);
  return (tags || []).some((t: { meaning: string; checked_meaning: string | null }) => t.meaning !== t.checked_meaning);
}

/** Every tag on the person's notes. */
export async function tagsInUse(admin: Admin, userId: string): Promise<string[]> {
  const { data } = await admin.from("recordings").select("tags").eq("user_id", userId);
  return [...new Set((data || []).flatMap((row: { tags: string[] | null }) => row.tags || []))];
}

/**
 * Words the person gave a note — said out loud, or a folder it sat in. Those
 * that are already their tags go on the note; the rest are asked about as
 * new tags. A state word or a client's name is neither.
 */
export async function givenTags(admin: Admin, userId: string, noteId: string, words: string[], source: "spoken" | "folder"): Promise<string[]> {
  const subjects = await clientNames(admin, userId);
  const vocabulary = await loadVocabulary(admin, userId);
  const clean = applyVocabulary(vocabulary, joinKnown(vocabulary, normalizeTags(words))).filter((tag) => !barred(tag, subjects));
  if (clean.length === 0) return [];
  const own = new Set((await ownTags(admin, userId, await tagsInUse(admin, userId))).map((tag) => tag.name));
  const skipped = await skippedNames(admin, userId);
  await proposeTags(
    admin,
    userId,
    noteId,
    clean.filter((tag) => !own.has(tag) && !skipped.has(tag)).map((tag) => ({ tag, meaning: "", parent: null, why: "" })),
    source
  );
  return clean.filter((tag) => own.has(tag));
}
