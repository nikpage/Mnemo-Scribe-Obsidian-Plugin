// [Writer]

import type { TranslationKey } from "@/lib/i18n";

/**
 * What a piece is: a blog post, an essay, a novel chapter. The built-in
 * forms are data here, their words in both languages (`i18n.ts`); the
 * person's own sit beside them in `writing_forms` (`076`). Fiction is one
 * form among many, not the centre.
 */
export interface BuiltInForm {
  /** Stable, never shown: what a piece records as its form. */
  id: string;
  /** About how long a piece in this form runs. */
  words: number;
  name: TranslationKey;
  /** How it is built, part by part. */
  structure: TranslationKey;
  /** What it always or never does. */
  conventions: TranslationKey;
}

export const BUILT_IN_FORMS: BuiltInForm[] = [
  { id: "blog-post", words: 1000, name: "formBlogPost", structure: "formBlogPostBuild", conventions: "formBlogPostRules" },
  { id: "essay", words: 2500, name: "formEssay", structure: "formEssayBuild", conventions: "formEssayRules" },
  { id: "term-paper", words: 5000, name: "formTermPaper", structure: "formTermPaperBuild", conventions: "formTermPaperRules" },
  { id: "long-article", words: 4000, name: "formLongArticle", structure: "formLongArticleBuild", conventions: "formLongArticleRules" },
  { id: "newsletter", words: 800, name: "formNewsletter", structure: "formNewsletterBuild", conventions: "formNewsletterRules" },
  { id: "speech", words: 1500, name: "formSpeech", structure: "formSpeechBuild", conventions: "formSpeechRules" },
  { id: "report", words: 3000, name: "formReport", structure: "formReportBuild", conventions: "formReportRules" },
  { id: "short-story", words: 5000, name: "formShortStory", structure: "formShortStoryBuild", conventions: "formShortStoryRules" },
  { id: "novel-chapter", words: 4000, name: "formNovelChapter", structure: "formNovelChapterBuild", conventions: "formNovelChapterRules" },
];

/** A form of the person's own, as `/api/writing/forms` returns it. */
export interface OwnForm {
  id: string;
  name: string;
  words: number | null;
  structure: string | null;
  conventions: string | null;
  voice_id: string | null;
  bible: string | null;
}

/** The longest a form's or a voice's text may be: a work bible grows with the work. */
export const TEXT_MAX = { name: 120, structure: 4000, conventions: 4000, bible: 50_000, voiceNotes: 20_000 } as const;
