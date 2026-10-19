// [Writer]

import type { TranslationKey } from "@/lib/i18n";

/**
 * What a piece is: a blog post, an essay, a novel chapter. The built-in
 * forms are data here, their words in both languages (`i18n.ts`); the
 * person's own sit beside them in `writing_forms` (`076`), as do their
 * changes to a built-in one (`base_key`, `080`). Fiction is one form among
 * many, not the centre.
 */
export interface BuiltInForm {
  /** Stable, never shown: what a piece records as its form. */
  id: string;
  /** About how long a piece in this form runs. */
  words: number;
  name: TranslationKey;
  /** What you get, in a line under its name: `{n}` is its length. */
  line: TranslationKey;
  /** How it is built, part by part. */
  structure: TranslationKey;
  /** What it always or never does. */
  conventions: TranslationKey;
  /** A story: New piece opens its background box. */
  fiction?: true;
}

export const BUILT_IN_FORMS: BuiltInForm[] = [
  { id: "blog-post", words: 1000, name: "formBlogPost", line: "formBlogPostLine", structure: "formBlogPostBuild", conventions: "formBlogPostRules" },
  { id: "essay", words: 2500, name: "formEssay", line: "formEssayLine", structure: "formEssayBuild", conventions: "formEssayRules" },
  { id: "term-paper", words: 5000, name: "formTermPaper", line: "formTermPaperLine", structure: "formTermPaperBuild", conventions: "formTermPaperRules" },
  { id: "long-article", words: 4000, name: "formLongArticle", line: "formLongArticleLine", structure: "formLongArticleBuild", conventions: "formLongArticleRules" },
  { id: "newsletter", words: 800, name: "formNewsletter", line: "formNewsletterLine", structure: "formNewsletterBuild", conventions: "formNewsletterRules" },
  { id: "speech", words: 1500, name: "formSpeech", line: "formSpeechLine", structure: "formSpeechBuild", conventions: "formSpeechRules" },
  { id: "report", words: 3000, name: "formReport", line: "formReportLine", structure: "formReportBuild", conventions: "formReportRules" },
  { id: "short-story", words: 5000, name: "formShortStory", line: "formShortStoryLine", structure: "formShortStoryBuild", conventions: "formShortStoryRules", fiction: true },
  { id: "novel-chapter", words: 4000, name: "formNovelChapter", line: "formNovelChapterLine", structure: "formNovelChapterBuild", conventions: "formNovelChapterRules", fiction: true },
];

/**
 * A row of `/api/writing/forms`: a form of the person's own, or with
 * `base_key` their version of that built-in one, where a field left null is
 * the built-in's own.
 */
export interface FormRow {
  id: string;
  name: string;
  words: number | null;
  structure: string | null;
  conventions: string | null;
  voice_id: string | null;
  base_key: string | null;
}

/** The longest a form's or a voice's text may be: a piece's background grows with the work. */
export const TEXT_MAX = { name: 120, structure: 4000, conventions: 4000, background: 50_000, voiceNotes: 20_000 } as const;

/** What a background is priced as: its words, rounded up to the hundred, so the price moves in steps as it is typed. */
export function backgroundWords(text: string | null | undefined): number {
  const words = (text ?? "").split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 100) * 100;
}
