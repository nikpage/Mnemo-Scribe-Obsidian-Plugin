// [Filer]

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTags } from "@/lib/note/filing";
import type { TagRow } from "@/lib/note/tag-tree";

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

/** Every tag with its meaning. */
export async function loadTagRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string
): Promise<TagRow[]> {
  const { data } = await admin.from("tag_vocabulary").select("name, meaning").eq("user_id", userId);
  return ((Array.isArray(data) ? data : []) as { name: string; meaning?: string | null }[]).map((row) => ({ name: row.name, meaning: row.meaning ?? null }));
}
