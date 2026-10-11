// [Filer]

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Subject {
  id: string;
  name: string;
  aliases: string[];
  kind: string | null;
  external_ref: string | null;
  archived: boolean;
  about: string | null;
}

/**
 * Everything the user calls a subject. Authored rows, read straight back —
 * there is no vocabulary step here and no model, because a subject is a
 * record the user keeps rather than a label a note grows.
 */
export async function loadSubjects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string
): Promise<Subject[]> {
  const { data } = await admin
    .from("subjects")
    .select("id, name, aliases, kind, external_ref, archived, about")
    .eq("user_id", userId)
    .order("name");

  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    aliases: row.aliases || [],
    kind: row.kind ?? null,
    external_ref: row.external_ref ?? null,
    archived: !!row.archived,
    about: row.about ?? null,
  }));
}

/**
 * The name the model returned, back to the row it came from.
 *
 * Case and surrounding space are forgiven and an alias counts as the name,
 * because those are ways of saying the same subject. Nothing else is: a name
 * this store does not hold resolves to null and the note stays unattached,
 * which is the right answer far more often than a guess would be.
 */
export function matchSubject(subjects: Subject[], name: string | null): string | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const hit = subjects.find(
    (s) =>
      s.name.trim().toLowerCase() === wanted ||
      s.aliases.some((a) => a.trim().toLowerCase() === wanted)
  );
  return hit ? hit.id : null;
}

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, "");

/**
 * "Patient Jan Novák, came in today…" — the client a note names out loud.
 *
 * Null when the note does not open with the pack's keyword: that note is
 * personal and joins no client. Otherwise the spoken name, up to three words
 * or the first punctuation, and the existing client it matches (either word
 * order, so "Novák Jan" is the same person), or no id when it is new.
 */
export function spokenClient(
  subjects: Subject[],
  keyword: { en: string; cs: string },
  transcript: string
): { name: string; id: string | null } | null {
  const words = transcript.trim().split(/\s+/);
  if (![keyword.en, keyword.cs].includes(bare(words[0] || ""))) return null;
  const name: string[] = [];
  for (const word of words.slice(1, 4)) {
    const clean = word.replace(/[^\p{L}\p{N}-]/gu, "");
    if (clean) name.push(clean);
    if (/[.,;:!?]$/.test(word)) break;
  }
  if (name.length === 0) return null;
  for (let n = name.length; n > 0; n--) {
    const part = name.slice(0, n);
    const id =
      matchSubject(subjects, part.join(" ")) ??
      (n === 2 ? matchSubject(subjects, [...part].reverse().join(" ")) : null);
    if (id) return { name: part.join(" "), id };
  }
  return { name: name.join(" "), id: null };
}

/**
 * The client a note names. The analysis hears the keyword anywhere in the
 * opening and in any form ("Okay, pacientka Nováková…"); its name counts only
 * when a form of the keyword really is in the first forty words, so a model
 * guess can never put an ordinary note under a client. Failing that, the free
 * first-word reading above.
 *
 * A name that is part of exactly one client's name is that client — the
 * speaker says "Nováková", the list holds "Jana Nováková".
 */
export function namedClient(
  subjects: Subject[],
  keyword: { en: string; cs: string },
  transcript: string,
  heard: string | undefined
): { name: string; id: string | null } | null {
  const name = (heard || "").trim();
  const opening = transcript.trim().split(/\s+/).slice(0, 40).map(bare);
  const said = opening.some((w) => w.startsWith(keyword.en) || w.startsWith(keyword.cs));
  if (!name || !said) return spokenClient(subjects, keyword, transcript);

  const words = name.toLowerCase().split(/\s+/);
  const exact =
    matchSubject(subjects, name) ??
    (words.length === 2 ? matchSubject(subjects, [...words].reverse().join(" ")) : null);
  if (exact) return { name, id: exact };
  const partial = subjects.filter((s) => {
    const own = s.name.toLowerCase().split(/\s+/);
    return words.every((w) => own.includes(w));
  });
  return partial.length === 1 ? { name: partial[0].name, id: partial[0].id } : { name, id: null };
}
