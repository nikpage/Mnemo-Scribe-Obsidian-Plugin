// [Librarian]

import type { TranslationKey } from "@/lib/i18n";
import type { Label } from "@/lib/note/passage-labels";

/**
 * Kind: a passage's three labels read as one list (`passage-labels.ts`). What
 * the speaker was doing (journal, ideas, log, draft), whether it was a story,
 * and whose words (quote, retold, my take). The database keeps the labels as
 * they are; these are their values, named in `i18n.ts`.
 */
export const KINDS = ["journal", "points", "log", "draft", "fiction", "quote", "borrowed", "inspired"] as const;
export type Kind = (typeof KINDS)[number];

/** Each Kind's name, the same words the note screen's passage labels use. */
export const KIND_NAME: Record<Kind, TranslationKey> = {
  journal: "passageKindJournal",
  points: "passageKindPoints",
  log: "passageKindLog",
  draft: "passageKindDraft",
  fiction: "passageTruthFiction",
  quote: "passageWordsQuote",
  borrowed: "passageWordsBorrowed",
  inspired: "passageWordsInspired",
};

/** How the note's line says a Kind that is not what the speaker was doing: "with a story". */
export const KIND_WITH: Partial<Record<Kind, TranslationKey>> = {
  fiction: "kindWithStory",
  quote: "kindWithQuote",
  borrowed: "kindWithRetold",
  inspired: "kindWithMyTake",
};

/** A Kind from an address or a request; anything else is dropped. */
export function readKinds(raw: string | null | undefined): Kind[] {
  return [...new Set((raw || "").split(",").filter((k): k is Kind => (KINDS as readonly string[]).includes(k)))];
}

/** A passage's labels and topics, as the filter reads them. */
export type KindPassage = Pick<Label, "kind" | "truth" | "words" | "topics">;

/** The Kinds one passage is. A note its speaker called a journal entry is journal in every passage. */
export function kindsOf(p: Pick<Label, "kind" | "truth" | "words">, journal: boolean): Set<Kind> {
  const out = new Set<Kind>([p.kind]);
  if (journal) out.add("journal");
  if (p.truth === "fiction") out.add("fiction");
  if (p.words !== "mine") out.add(p.words);
  return out;
}

/**
 * A note's Kinds in the order its line says them: what the speaker was doing,
 * as the passages go (a journal entry first), then what it holds.
 */
export function noteKinds(passages: Pick<Label, "kind" | "truth" | "words">[], journal: boolean): Kind[] {
  const doing: Kind[] = journal ? ["journal"] : [];
  for (const p of passages) if (!doing.includes(p.kind)) doing.push(p.kind);
  const holds = KINDS.filter((k) => KIND_WITH[k] && passages.some((p) => kindsOf(p, false).has(k)));
  return [...doing, ...holds];
}

/**
 * Whether a note matches the chosen Kinds and tags, each held by one passage:
 * a passage with every chosen Kind and every chosen tag. A tag counts for a
 * passage when it is one of its topics, or is on the note and on none of its
 * passages (given by hand, or said). No Kind chosen: the note's tags alone.
 * A note not yet in passages is one passage, of no Kind but a journal entry's.
 */
export function kindMatch(note: { tags: string[]; journal: boolean }, passages: KindPassage[], kinds: Kind[], tags: string[]): boolean {
  if (!tags.every((t) => note.tags.includes(t))) return false;
  if (kinds.length === 0) return true;
  const own = new Set(passages.flatMap((p) => p.topics));
  const whole = passages.length ? passages : [null];
  return whole.some((p) => {
    const has = p ? kindsOf(p, note.journal) : new Set<Kind>(note.journal ? ["journal"] : []);
    return kinds.every((k) => has.has(k)) && tags.every((t) => !own.has(t) || Boolean(p?.topics.includes(t)));
  });
}

/**
 * Whether a tag reaches a note only through a story: every passage carrying it
 * is fiction, and the person did not give it by hand ("" in `tag_why`).
 */
export function inAStory(why: Record<string, string>, passages: Pick<Label, "truth" | "topics">[], tag: string): boolean {
  if (why[tag] === "") return false;
  const carrying = passages.filter((p) => p.topics.includes(tag));
  return carrying.length > 0 && carrying.every((p) => p.truth === "fiction");
}
