// [Filer]

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTags } from "@/lib/note/filing";
import { type TagRow, canParent, parentsOf } from "@/lib/note/tag-tree";

/**
 * The user's tag vocabulary, and the one place a tag is resolved to it.
 *
 * Before this, every mapping call re-derived the vocabulary from whatever
 * tags happened to exist and asked the model to match against that. Nothing
 * held the answer, so nothing accumulated: `recipe` and `recipes` both
 * survived, and the next note could add a third spelling. A tag that matches
 * an alias now resolves to the one canonical name instead, without a model
 * being asked again.
 *
 * A tag the user typed is never renamed or absorbed. It is theirs.
 */

export interface Vocabulary {
  /** Canonical names, for the mapping prompt and for the filing panel. */
  names: string[];
  /** Every known spelling to the canonical name it resolves to. */
  resolve: Map<string, string>;
}

/** Plural and hyphen forms of a tag, so the obvious variants resolve free. */
function variants(tag: string): string[] {
  const forms = new Set<string>([tag]);
  if (tag.endsWith("s")) forms.add(tag.slice(0, -1));
  else forms.add(`${tag}s`);
  if (tag.includes("-")) forms.add(tag.replace(/-/g, " "));
  if (tag.includes(" ")) forms.add(tag.replace(/\s+/g, "-"));
  return [...forms];
}

export async function loadVocabulary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string
): Promise<Vocabulary> {
  const { data } = await admin
    .from("tag_vocabulary")
    .select("name, aliases")
    .eq("user_id", userId);

  const resolve = new Map<string, string>();
  const names: string[] = [];

  for (const row of data || []) {
    names.push(row.name);
    for (const form of [row.name, ...(row.aliases || [])]) {
      for (const variant of variants(form)) {
        // First writer wins: a canonical name is never shadowed by another
        // tag's alias that happens to collide with it.
        if (!resolve.has(variant)) resolve.set(variant, row.name);
      }
    }
  }

  return { names: names.sort(), resolve };
}

/** What a set of tags becomes once the vocabulary has had its say. */
/**
 * Words said one after another that together spell a tag the person has
 * ("one", "human", "tribe" → `one-human-tribe`), joined back into it, longest
 * run first. Words that spell nothing known stay as they came.
 */
export function joinKnown(vocabulary: Vocabulary, words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let end = i + 1;
    for (let j = words.length; j > i + 1; j--) {
      if (vocabulary.resolve.has(words.slice(i, j).join("-"))) {
        end = j;
        break;
      }
    }
    out.push(words.slice(i, end).join("-"));
    i = end;
  }
  return out;
}

export function applyVocabulary(vocabulary: Vocabulary, tags: string[]): string[] {
  return normalizeTags(tags.map((tag) => vocabulary.resolve.get(tag) || tag));
}

/**
 * Records tags that were not in the vocabulary, so the next note can match
 * them. Never throws: a vocabulary that failed to grow costs consistency
 * later, never the note in front of us.
 *
 * `userDefined` marks the tags a person typed. Those are authoritative — a
 * model proposing something similar resolves onto them, not the other way
 * round.
 */
export async function rememberTags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  tags: string[],
  userDefined: boolean
): Promise<void> {
  const clean = normalizeTags(tags);
  if (clean.length === 0) return;

  try {
    await admin.from("tag_vocabulary").upsert(
      clean.map((name) => ({
        user_id: userId,
        name,
        user_defined: userDefined,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,name", ignoreDuplicates: !userDefined }
    );
  } catch (err) {
    console.error("Tag vocabulary not updated (non-fatal):", err);
  }
}

/** Every tag with its parents and meaning: the tree as stored. */
export async function loadTagRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string
): Promise<TagRow[]> {
  const [{ data }, { data: links }] = await Promise.all([
    admin.from("tag_vocabulary").select("name, meaning").eq("user_id", userId),
    admin.from("tag_parents").select("tag, parent").eq("user_id", userId),
  ]);
  const rows = withParents(Array.isArray(data) ? data : [], links);
  // A parent row for a tag the vocabulary lacks still counts.
  const named = new Set(rows.map((row) => row.name));
  const missing = [...new Set((Array.isArray(links) ? links : []).map((l: { tag?: unknown }) => l.tag))].filter((tag): tag is string => typeof tag === "string" && !named.has(tag));
  return [...rows, ...withParents(missing.map((name) => ({ name, meaning: null })), links)];
}

/** Vocabulary rows, each with the tags it sits under from `tag_parents` rows. */
export function withParents<T extends { name: string; meaning?: string | null }>(rows: T[], links: unknown): (T & TagRow)[] {
  const above = new Map<string, string[]>();
  for (const link of Array.isArray(links) ? (links as { tag?: unknown; parent?: unknown }[]) : []) {
    if (typeof link.tag !== "string" || typeof link.parent !== "string") continue;
    above.set(link.tag, [...(above.get(link.tag) ?? []), link.parent]);
  }
  return rows.map((row) => ({ ...row, meaning: row.meaning ?? null, parents: above.get(row.name) ?? [] }));
}

/**
 * Puts tags under more tags, as `[child, parent]`: the person dragging in the
 * sidebar, keeping a suggestion, or a vault's `food/recipe`. Adds, never
 * removes another parent. A pair that would put a tag under itself or a tag
 * beneath it is dropped. Never throws: the note is saved either way.
 */
export async function addParents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  pairs: [string, string][]
): Promise<void> {
  if (pairs.length === 0) return;
  try {
    await rememberTags(admin, userId, pairs.flat(), true);
    const parents = parentsOf(await loadTagRows(admin, userId));
    const adding: { user_id: string; tag: string; parent: string }[] = [];
    for (const [child, parent] of pairs) {
      if (parents.get(child)?.has(parent) || !canParent(child, parent, parents)) continue;
      adding.push({ user_id: userId, tag: child, parent });
      parents.set(child, new Set([...(parents.get(child) ?? []), parent]));
    }
    if (adding.length) await admin.from("tag_parents").upsert(adding, { onConflict: "user_id,tag,parent", ignoreDuplicates: true });
  } catch (err) {
    console.error("Tag parents not saved (non-fatal):", err);
  }
}

/** Takes `tag` out from under `parent`; its other parents stay. */
export async function removeParent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  tag: string,
  parent: string
) {
  return admin.from("tag_parents").delete().eq("user_id", userId).eq("tag", tag).eq("parent", parent);
}
