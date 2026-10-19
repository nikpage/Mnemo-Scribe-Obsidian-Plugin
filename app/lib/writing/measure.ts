// [Writer]

/**
 * How a voice writes, counted: free, no model, the same on the server and
 * the screen. What studies of style measure first (sentence length and its
 * spread, paragraph length, dialogue, punctuation, contractions), so a piece
 * can be set beside the voice it was written in.
 */
export interface Measures {
  words: number;
  /** Words per sentence: the mean, and how far sentences stray from it (standard deviation). */
  sentence: { mean: number; spread: number };
  /** Words per paragraph, headings left out. */
  paragraph: number;
  /** Share of the words inside quotation marks, 0 to 1. */
  dialogue: number;
  /** Each mark per 100 words. */
  punctuation: { comma: number; semicolon: number; colon: number; dash: number; question: number; exclamation: number };
  /** Contractions ("don't", "it's") per 100 words; none in a language without them. */
  contractions: number;
}

export const MARKS = ["comma", "semicolon", "colon", "dash", "question", "exclamation"] as const;

const MARK: Record<(typeof MARKS)[number], RegExp> = {
  comma: /,/g,
  semicolon: /;/g,
  colon: /:(?!\/\/)/g,
  dash: /\s[—–-]\s|—/g,
  question: /\?/g,
  exclamation: /!/g,
};

const wordsIn = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** The prose of a text: Markdown headings, list marks, emphasis and links taken off. */
function prose(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#{1,6}\s/.test(p) && !/^(-{3,}|\*{3,})$/.test(p))
    .map((p) =>
      p
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
        .replace(/^>\s?/gm, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`]+/g, "")
    );
}

/** The sentences of a paragraph: ended by . ! ? … with any closing quote or bracket. */
function sentences(paragraph: string): string[] {
  return paragraph
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…]["”“’»)]?)\s+(?=["„“‘«(]?[\p{Lu}\p{N}])/u)
    .filter((s) => wordsIn(s) > 0);
}

/** Words inside quotation marks: "…", “…”, „…“, «…». */
function quotedWords(text: string): number {
  let n = 0;
  for (const m of text.matchAll(/"([^"\n]+)"|“([^”\n]+)”|„([^“”\n]+)[“”]|«([^»\n]+)»/g)) n += wordsIn(m.slice(1).find(Boolean) ?? "");
  return n;
}

const CONTRACTION = /\b\p{L}+[’'](?:t|re|ve|ll|d|m)\b|\b(?:it|that|there|what|he|she|who|here|where|let|how)[’']s\b/giu;

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

/** The measures of texts taken together; null when they hold no words. */
export function measure(texts: string[]): Measures | null {
  const paragraphs = texts.flatMap(prose);
  const words = paragraphs.reduce((sum, p) => sum + wordsIn(p), 0);
  if (!words) return null;
  const lengths = paragraphs.flatMap(sentences).map(wordsIn);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const spread = Math.sqrt(lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length);
  const all = paragraphs.join("\n\n");
  const per100 = (n: number) => round((n * 100) / words);
  return {
    words,
    sentence: { mean: round(mean), spread: round(spread) },
    paragraph: round(words / paragraphs.length),
    dialogue: round(quotedWords(all) / words, 2),
    punctuation: Object.fromEntries(MARKS.map((m) => [m, per100(all.match(MARK[m])?.length ?? 0)])) as Measures["punctuation"],
    contractions: per100(all.match(CONTRACTION)?.length ?? 0),
  };
}

/** A voice's measures: counted on its written examples when it has any, since speech is not writing. */
export function measureVoice(examples: { text: string; spoken: boolean }[]): Measures | null {
  const written = examples.filter((e) => !e.spoken);
  return measure((written.length ? written : examples).map((e) => e.text));
}

/**
 * How far one text's measures are from a voice's: each measure's difference
 * as a share of the larger of the two, averaged. 0 is the same; 1 is as far
 * as they go. A rough guide, read beside the texts, never instead of them.
 */
export function distance(a: Measures, b: Measures): number {
  const pairs: [number, number][] = [
    [a.sentence.mean, b.sentence.mean],
    [a.sentence.spread, b.sentence.spread],
    [a.paragraph, b.paragraph],
    [a.dialogue, b.dialogue],
    [a.contractions, b.contractions],
    ...MARKS.map((m): [number, number] => [a.punctuation[m], b.punctuation[m]]),
  ];
  const apart = pairs.map(([x, y]) => (Math.max(x, y) === 0 ? 0 : Math.abs(x - y) / Math.max(x, y)));
  return round(apart.reduce((s, d) => s + d, 0) / apart.length, 2);
}
