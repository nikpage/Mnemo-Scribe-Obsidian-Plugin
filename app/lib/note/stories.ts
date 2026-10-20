// [Filer, Writer]

import { type Lang, type TranslationKey, t } from "@/lib/i18n";
import { isMnemo } from "@/lib/note/filing";

/**
 * The story bank: five `mnemo-` tags every person has, each with its rule as
 * its meaning. Filing asks one that seems to fit on the note it fits, never
 * putting it on unasked; the writer follows each rule. Built in and locked:
 * a person's own `mnemo-` tag sits beside them with the meaning they gave it.
 */
export const STORY_TAGS = [
  { name: "mnemo-story-mine", meaning: "storyMineRule", fiction: false },
  { name: "mnemo-story-borrowed", meaning: "storyBorrowedRule", fiction: false },
  { name: "mnemo-story-made-up", meaning: "storyMadeUpRule", fiction: true },
  { name: "mnemo-story-quote", meaning: "storyQuoteRule", fiction: false },
  { name: "mnemo-story-inspired", meaning: "storyInspiredRule", fiction: false },
] as const satisfies readonly { name: string; meaning: TranslationKey; fiction: boolean }[];

export const QUOTE_TAG = "mnemo-story-quote";

/** Whether `tag` is one of the five built in. */
export function isStoryTag(tag: string): boolean {
  return STORY_TAGS.some((s) => s.name === tag);
}

/** A tag's meaning, the built-in rule over anything stored for it. */
export function storyMeaning(tag: string, lang: Lang): string | null {
  const story = STORY_TAGS.find((s) => s.name === tag);
  return story ? t(story.meaning, lang) : null;
}

/**
 * The person's tags with the story bank in: the five built in, with their
 * rules, over any stored row of the same name; and the person's own `mnemo-`
 * tags only with a meaning, since a rule nobody wrote says nothing.
 */
export function withStories<T extends { name: string; meaning: string | null }>(own: T[], lang: Lang): { name: string; meaning: string | null }[] {
  const rest = own.filter((tag) => !isStoryTag(tag.name) && (!isMnemo(tag.name) || tag.meaning?.trim()));
  return [...rest, ...STORY_TAGS.map((s) => ({ name: s.name, meaning: t(s.meaning, lang) }))];
}

/**
 * Whether a piece may read a note with these tags: fiction reads every
 * story, anything else never one made up.
 */
export function storyAllowed(tags: string[] | null | undefined, fiction: boolean): boolean {
  return fiction || !(tags || []).some((tag) => STORY_TAGS.some((s) => s.fiction && s.name === tag));
}

/** Whether a note is in the story bank at all. */
export function inStoryBank(tags: string[] | null | undefined): boolean {
  return (tags || []).some(isStoryTag);
}

/**
 * The rules the writer follows for the `mnemo-` tags on the notes it reads,
 * in English as every writing prompt is: the built-in ones, then the
 * person's own with their meaning. Empty when none of its notes carries one.
 */
export function storyRules(present: string[], own: { name: string; meaning?: string | null }[]): string {
  const lines = [...new Set(present.filter(isMnemo))]
    .sort()
    .flatMap((tag) => {
      const meaning = storyMeaning(tag, "en") ?? own.find((o) => o.name === tag)?.meaning?.trim();
      return meaning ? [`- ${tag}: ${meaning}`] : [];
    });
  return lines.length ? `THE AUTHOR'S RULES FOR SOME NOTES (a note carrying one of these tags is used only as its rule says)\n${lines.join("\n")}` : "";
}
