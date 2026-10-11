// [Filer]

import type { SupabaseClient } from "@supabase/supabase-js";
import { type Lang, LANGUAGE_NAMES } from "@/lib/i18n";

/**
 * The user's primary language: the one their paths and tags are written in,
 * and the fallback when speech language detection is not confident. It is
 * never derived from a note — a note can be spoken in anything.
 */
export async function primaryLanguage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string
): Promise<Lang> {
  const { data } = await admin
    .from("profiles")
    .select("primary_language")
    .eq("id", userId)
    .single();
  const lang = data?.primary_language;
  return lang && lang in LANGUAGE_NAMES ? (lang as Lang) : "en";
}

/**
 * The language written answers come back in, when the user fixed one. Null
 * means "the language I ask in". Read on its own so an account set up before
 * the setting existed — or a database not yet given the column — simply has
 * no choice made.
 */
export async function answerLanguage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string
): Promise<Lang | null> {
  const { data } = await admin
    .from("profiles")
    .select("answer_language")
    .eq("id", userId)
    .single();
  const lang = data?.answer_language;
  return lang && lang in LANGUAGE_NAMES ? (lang as Lang) : null;
}

/**
 * What the weekly report and the threads are written in. Nobody asked a
 * question there, so "the language I ask in" falls back to the notes' own.
 */
export async function reportLanguage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string
): Promise<Lang> {
  return (await answerLanguage(admin, userId)) ?? (await primaryLanguage(admin, userId));
}
