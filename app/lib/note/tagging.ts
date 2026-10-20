// [Filer]

import { z } from "zod";
import { generate, readJson } from "@/lib/ai/call";
import type { CostContext } from "@/lib/ai/cost";
import { type Lang, LANGUAGE_NAMES } from "@/lib/i18n";
import { isMnemo, normalizeSegment, singular } from "@/lib/note/filing";
import { canParent, parentsOf } from "@/lib/note/tag-tree";
import { theoryLines } from "@/lib/theories";

/**
 * Tags the person owns. Every tag has a meaning they approved; filing puts a
 * tag on a note only when the note fits that meaning, and shows the sentence
 * that earned it. Filing never makes a tag up: a tag the note seems to need
 * comes back as a proposal, which the person keeps or skips
 * (`tag-suggestions.ts`). Pure checks here, so a model that invents a tag or
 * an evidence sentence is caught in code, not trusted.
 */

const MODEL = "gemini-3.1-flash-lite";

/** One of the person's tags, as the model is shown it. */
export interface OwnTag {
  name: string;
  meaning: string | null;
}

/** A tag on a note and the sentence from the note that earned it. */
export interface Earned {
  tag: string;
  why: string;
}

/** A tag the note seems to need that the person does not have yet. */
export interface Proposal {
  tag: string;
  meaning: string;
  /** An existing tag it would sit under, or null. */
  parent: string | null;
  why: string;
}

/** How much of one note a model reads. The longest note in use is ~16k. */
export const NOTE_CHARS = 20_000;

/**
 * Words that say where a note is in its life, not what it is about. A note's
 * state is its own mark, so none of these is ever a tag.
 */
export const STATE_WORDS = new Set([
  "draft",
  "drafts",
  "done",
  "finished",
  "published",
  "publishing",
  "unpublished",
  "wip",
  "todo",
  "to-do",
  "untagged",
]);

/** Text compared without case, punctuation or spacing, so a quote survives a comma. */
function plain(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Whether `quote` is really in `text`: at least three words of it, word for word. */
export function quoted(quote: string, text: string): boolean {
  const q = plain(quote);
  return q.split(" ").length >= 3 && ` ${plain(text)} `.includes(` ${q} `);
}

/** A tag nobody may hold: a state word, or the name of one of the person's clients. */
export function barred(tag: string, subjects: string[]): boolean {
  return STATE_WORDS.has(tag) || subjects.some((name) => normalizeSegment(name) === tag);
}

/** The words of a tag's name, each in the singular. */
function nameWords(name: string): string[] {
  return name.split(/[-\s]+/).filter(Boolean).map(singular);
}

/**
 * Whether `tag` was asked about already, or is one asked about with words
 * added (`physical-fitness` after `fitness`): a "no" holds for every spelling
 * that still names it.
 */
export function alreadyAsked(tag: string, asked: Set<string>): boolean {
  if (asked.has(tag)) return true;
  const words = new Set(nameWords(tag));
  for (const name of asked) {
    const theirs = nameWords(name);
    if (theirs.length && theirs.every((word) => words.has(word))) return true;
  }
  return false;
}

/** Tags asked about before, as a prompt reads them: never offered again, not even in other words. */
function askedLines(asked: Set<string>): string {
  return asked.size ? `\n\nALREADY ASKED ABOUT (never propose one of these again, nor the same idea in other words): ${[...asked].sort().join(", ")}` : "";
}

/**
 * Whether `parent` is made from a word of the tag's own name (`money` over
 * `my-money`): a parent names the field a tag belongs to, never the word the
 * two share.
 */
export function ownWord(tag: string, parent: string): boolean {
  const own = new Set(nameWords(tag));
  return nameWords(parent).some((word) => own.has(word));
}

/**
 * What survives of a filing reply: only the person's tags, each with a
 * sentence really in the note; only new tags never asked about before, not
 * barred, each with a sentence and a meaning. A `mnemo-` tag that fits is a
 * question on the note (`asks`), never a tag, and the model never makes one.
 */
export function keepFitting(
  reply: { tags?: Reply["tags"]; proposed?: Reply["proposed"] },
  own: OwnTag[],
  text: string,
  opts: { subjects: string[]; asked: Set<string> }
): { tags: Earned[]; proposed: Proposal[]; asks: Earned[] } {
  const names = new Set(own.map((tag) => tag.name));
  const tags: Earned[] = [];
  const asks: Earned[] = [];
  for (const item of reply.tags || []) {
    const tag = normalizeSegment(String(item.tag ?? ""));
    const why = String(item.quote ?? "").trim();
    // A note that only mentions what a tag means is not about it.
    if (item.weight !== "main" && item.weight !== "part") continue;
    if (!names.has(tag) || barred(tag, opts.subjects) || !quoted(why, text)) continue;
    const into = isMnemo(tag) ? asks : tags;
    if (!into.some((t) => t.tag === tag)) into.push({ tag, why });
  }
  const proposed: Proposal[] = [];
  for (const item of reply.proposed || []) {
    const tag = normalizeSegment(String(item.tag ?? ""));
    const why = String(item.quote ?? "").trim();
    const meaning = String(item.meaning ?? "").trim();
    if (!tag || isMnemo(tag) || names.has(tag) || alreadyAsked(tag, opts.asked) || barred(tag, opts.subjects)) continue;
    if (!meaning || !quoted(why, text) || proposed.some((p) => p.tag === tag)) continue;
    const parent = normalizeSegment(String(item.parent ?? ""));
    proposed.push({ tag, meaning, parent: names.has(parent) && !isMnemo(parent) && !ownWord(tag, parent) ? parent : null, why });
  }
  return { tags, proposed, asks };
}

function tagLines(own: OwnTag[]): string {
  return own.map((tag) => `- ${tag.name}${tag.meaning ? `: ${tag.meaning}` : ""}`).join("\n") || "(none yet)";
}

/** How a tag is judged against a note, the same for one note and for many. */
const JUDGE = `A tag fits only when the note is really about what the tag means. Judge by each tag's meaning, not its name: a word from the name appearing in the note proves nothing.

For every tag you consider, say how much of the note is about it — "main" (what the note is about), "part" (a real part of it), or "mention" (named in passing, as background, about someone else) — and copy a quote: one sentence, or a run of at least five words, copied character for character from the note. Never explain, paraphrase or summarise in the quote: if you cannot copy words that show it, the tag does not fit. A note can fit several tags or none; none is a fine answer. A tag starting "mnemo-" says what kind of material the note is (a story the person lived, someone's exact words…), not what it is about: it fits only when the whole note, or a story told in it, is that kind.`;

const FILE_RULES = (lang: Lang) => `Decide which of this person's tags fit a note.

${JUDGE}

If none of the tags fits, propose one new tag for what the note is mainly about; if some fit, propose one only when the note is plainly about a concrete subject none of them covers. A new tag is a field, an activity, a place or a project: one concept, one or two words, in ${LANGUAGE_NAMES[lang]}, with a one-line meaning in ${LANGUAGE_NAMES[lang]}, an existing tag it would sit under (or null), and a quote. The tag it sits under names the field it belongs to — "money" as society studies it sits under "sociology", the person's own money under "budgeting" — never a word of its own name. When the note is about another sense of a word one of the tags already uses, give it its own name ("my-money", not a second "money"). Never propose a description of the kind of note (idea, reflection, thoughts, update, plan), a person's or client's name, a date, or a word for the note's state (draft, done, published). A note too short or empty to be about anything gets no proposal.

Return JSON only: {"tags":[{"tag":"…","weight":"main|part|mention","quote":"…"}],"proposed":[{"tag":"…","meaning":"…","parent":null,"quote":"…"}]}`;

/** What the person's corrections have shown, as filing reads it (`lib/theories.ts`). */
export function learnedLines(theories: string[] | undefined): string {
  const lines = theoryLines("WHAT THIS PERSON'S OWN CORRECTIONS HAVE SHOWN ABOUT HOW THEY TAG (follow it; it never makes a tag fit a note it is not about):", theories ?? []);
  return lines ? `\n\n${lines}` : "";
}

/**
 * Which of the person's tags fit one note, and any new tag it seems to need.
 * `asked`: tags already proposed or skipped, never proposed again.
 * `theories`: what their corrections have shown, only usable ones.
 */
export async function tagNote(
  note: { text: string },
  own: OwnTag[],
  opts: { lang: Lang; subjects: string[]; asked: Set<string>; ctx: CostContext; theories?: string[] }
): Promise<{ tags: Earned[]; proposed: Proposal[]; asks: Earned[] }> {
  const text = note.text.slice(0, NOTE_CHARS);
  if (!text.trim()) return { tags: [], proposed: [], asks: [] };
  const reply = await generate({
    model: MODEL,
    operation: "tag-check",
    ctx: opts.ctx,
    // The note's own words only: its title is the app's, never a quote.
    parts: [FILE_RULES(opts.lang), `\n\nTHE PERSON'S TAGS:\n${tagLines(own)}${learnedLines(opts.theories)}${askedLines(opts.asked)}\n\nNOTE:\n${text}`],
    json: true,
  });
  const read = readJson(reply, FileReply) ?? {};
  return keepFitting(read, own, text, opts);
}

const Judged = z.object({ tag: z.unknown(), weight: z.unknown(), quote: z.unknown() });

const FileReply = z.object({
  tags: z.array(Judged).catch([]),
  proposed: z.array(z.object({ tag: z.unknown(), meaning: z.unknown(), parent: z.unknown(), quote: z.unknown() })).catch([]),
});

/** A tagging reply as read: nothing in it trusted until `keepFitting()`. */
export type Reply = z.infer<typeof FileReply>;

const Dropped = z.object({ tag: z.unknown(), reason: z.unknown() });

const CheckReply = z.object({
  notes: z.array(z.object({ id: z.unknown(), tags: z.array(Judged).catch([]), drop: z.array(Dropped).catch([]) })).catch([]),
});

/** One note read again: the tags that fit, each with its quote, and the ones it carries that do not, each with the reason. */
export interface Verdict {
  fits: Earned[];
  drops: Earned[];
}

/** How much text one re-check call reads before the next batch. */
const BATCH_CHARS = 120_000;

/**
 * A re-check reply as read: the tags that fit (`keepFitting()`), and a tag the
 * note carries that does not, only with a reason and never one that also
 * fits. Silence about a tag is no verdict on it.
 */
export function keepVerdict(
  said: { tags?: Reply["tags"]; drop?: { tag?: unknown; reason?: unknown }[] },
  has: string[],
  tags: OwnTag[],
  text: string,
  subjects: string[]
): Verdict {
  const fits = keepFitting({ tags: said.tags ?? [] }, tags, text, { subjects, asked: new Set() }).tags;
  const checked = new Set(tags.map((tag) => tag.name));
  const drops: Earned[] = [];
  for (const item of said.drop || []) {
    const tag = normalizeSegment(String(item.tag ?? ""));
    const why = String(item.reason ?? "").trim().slice(0, 300);
    if (!why || !checked.has(tag) || !has.includes(tag) || isMnemo(tag)) continue;
    if (fits.some((f) => f.tag === tag) || drops.some((d) => d.tag === tag)) continue;
    drops.push({ tag, why });
  }
  return { fits, drops };
}

/**
 * Which of `tags` fit each note, read again, and which of those it carries
 * do not and why. The verdict on `tags` only: a note's other tags are not in
 * question. A note the model skipped, or a reply that cannot be read, gets no
 * verdict at all, so a re-check only asks about what it read.
 */
export async function checkNotes(
  notes: { id: string; text: string; has: string[] }[],
  tags: OwnTag[],
  opts: { subjects: string[]; ctx: CostContext }
): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  if (tags.length === 0) return out;
  const names = new Set(tags.map((tag) => tag.name));
  const batches: (typeof notes)[] = [[]];
  let size = 0;
  for (const note of notes) {
    const text = note.text.slice(0, NOTE_CHARS);
    if (size + text.length > BATCH_CHARS && batches.at(-1)!.length) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1)!.push({ ...note, text });
    size += text.length;
  }
  for (const batch of batches.filter((b) => b.length)) {
    const reply = await generate({
      model: MODEL,
      operation: "tag-check",
      ctx: opts.ctx,
      parts: [
        `For each note below, decide which of these tags fit it.

${JUDGE}

Each note lists the tags it carries now ("carries"). One of those that does not fit goes in "drop" with the reason in one plain sentence: what the note is about instead. Drop a tag only when you are sure; when unsure, leave it out of both lists.

Return JSON only, every note once: {"notes":[{"id":"…","tags":[{"tag":"…","weight":"main|part|mention","quote":"…"}],"drop":[{"tag":"…","reason":"…"}]}]}`,
        `\n\nTAGS:\n${tagLines(tags)}\n\nNOTES:\n${batch
          .map((n) => `=== id: ${n.id}\ncarries: ${n.has.filter((tag) => names.has(tag)).join(", ") || "none of these"}\n${n.text}`)
          .join("\n\n")}`,
      ],
      json: true,
    });
    const read = readJson(reply, CheckReply);
    for (const note of batch) {
      const said = read?.notes.find((n) => String(n.id) === note.id);
      if (said) out.set(note.id, keepVerdict(said, note.has, tags, note.text, opts.subjects));
    }
  }
  return out;
}

/** What a tidy-up proposes for the person's tags as a whole. */
export interface Plan {
  /** For tags with none: written straight in, the person rewords them on Tags. */
  meanings: { tag: string; meaning: string }[];
  merges: { tag: string; into: string; why: string }[];
  parents: { tag: string; parent: string }[];
  /** A new top-level tag over top-level tags it gathers, each asked about. */
  groups: { tag: string; meaning: string; children: string[]; why: string }[];
  /** A note whose only tag is one of these, to another existing tag that fits it ("" = none). */
  moves: { ref: string; tag: string }[];
}

const PlanReply = z.object({
  meanings: z.array(z.object({ tag: z.unknown(), meaning: z.unknown() })).catch([]),
  merges: z.array(z.object({ tag: z.unknown(), into: z.unknown(), why: z.unknown() })).catch([]),
  parents: z.array(z.object({ tag: z.unknown(), parent: z.unknown() })).catch([]),
  groups: z.array(z.object({ tag: z.unknown(), meaning: z.unknown(), children: z.array(z.unknown()).catch([]), why: z.unknown() })).catch([]),
  moves: z.array(z.object({ note: z.unknown(), tag: z.unknown() })).catch([]),
});

/** A tag as the tidy-up reads it: what it means, where it sits, and what carries it. */
export interface TagSummary {
  name: string;
  meaning: string | null;
  /** Every tag it sits under now. */
  parents: string[];
  /** `ref` marks a note whose only tag this is, so the tidy-up can say where it would go. */
  notes: { title: string; summary: string; ref?: string }[];
}

/**
 * The plan, checked: only tags that exist are given meanings (only those
 * without one), merged or moved; a merge goes into a tag that stays; a
 * parent (a tag may get several) never makes a loop and is never a word of the tag's own name; a new
 * top-level tag is not barred, not one the person already skipped, and
 * gathers at least two top-level tags.
 */
export function keepPlan(reply: z.infer<typeof PlanReply>, tags: TagSummary[], opts: { subjects: string[]; asked: Set<string> }): Plan {
  // A `mnemo-` tag is the person's alone: no tidy-up names one, in any part of the plan.
  tags = tags.filter((t) => !isMnemo(t.name)).map((t) => ({ ...t, parents: t.parents.filter((p) => !isMnemo(p)) }));
  const names = new Set(tags.map((t) => t.name));
  const name = (raw: unknown) => normalizeSegment(String(raw ?? ""));
  const words = (raw: unknown) => String(raw ?? "").trim();

  const gone = new Set<string>();
  // No chains: a tag merged away takes nothing in, a tag taking one in is not merged away.
  const merges: Plan["merges"] = [];
  for (const m of reply.merges) {
    const tag = name(m.tag);
    const into = name(m.into);
    if (!names.has(tag) || !names.has(into) || tag === into || gone.has(tag) || gone.has(into)) continue;
    if (merges.some((n) => n.into === tag)) continue;
    merges.push({ tag, into, why: words(m.why) });
    gone.add(tag);
  }

  const living = new Set([...names].filter((n) => !gone.has(n)));

  const meanings = reply.meanings
    .map((m) => ({ tag: name(m.tag), meaning: words(m.meaning) }))
    .filter((m, i, all) => living.has(m.tag) && m.meaning && !tags.find((t) => t.name === m.tag)?.meaning && all.findIndex((n) => n.tag === m.tag) === i);

  // Parents among the tags that remain, several to a tag, applied in order and dropped where one would close a loop.
  const above = parentsOf(tags.map((t) => ({ name: t.name, parents: t.parents.filter((p) => living.has(p)) })));
  const parents: Plan["parents"] = [];
  for (const p of reply.parents) {
    const tag = name(p.tag);
    const parent = name(p.parent);
    if (!living.has(tag) || !living.has(parent) || tag === parent || above.get(tag)?.has(parent) || !canParent(tag, parent, above) || ownWord(tag, parent)) continue;
    above.set(tag, new Set([...(above.get(tag) ?? []), parent]));
    parents.push({ tag, parent });
  }

  // A new tag over tags still at the top once the parents above are placed; each tag in one group.
  const groups: Plan["groups"] = [];
  const gathered = new Set<string>();
  for (const g of reply.groups) {
    const tag = name(g.tag);
    const meaning = words(g.meaning);
    if (!tag || !meaning || isMnemo(tag) || names.has(tag) || alreadyAsked(tag, opts.asked) || barred(tag, opts.subjects) || groups.some((h) => h.tag === tag)) continue;
    const children = [...new Set(g.children.map(name))].filter((c) => living.has(c) && !above.has(c) && !gathered.has(c) && !ownWord(c, tag));
    if (children.length < 2) continue;
    children.forEach((c) => gathered.add(c));
    groups.push({ tag, meaning, children, why: words(g.why) });
  }

  // A note's new home is another tag of the person's that stays; one per note.
  const leaving = new Map(tags.flatMap((t) => t.notes.flatMap((n) => (n.ref ? [[n.ref, t.name] as const] : []))));
  const moves: Plan["moves"] = [];
  for (const m of reply.moves) {
    const ref = String(m.note ?? "").trim();
    const tag = name(m.tag);
    if (!leaving.has(ref) || moves.some((n) => n.ref === ref)) continue;
    moves.push({ ref, tag: names.has(tag) && !gone.has(tag) && tag !== leaving.get(ref) ? tag : "" });
  }
  return { meanings, merges, parents, groups, moves };
}

/**
 * A tidy-up: one look at every tag, its meaning, its place and the notes
 * carrying it. Writes meanings for tags without one; proposes merges of tags
 * that mean the same, a tree by field, and new top-level tags gathering
 * others. The shape is the model's to judge from what is there; the person
 * keeps, edits or skips each.
 */
export async function planTags(
  tags: TagSummary[],
  opts: { lang: Lang; subjects: string[]; asked: Set<string>; ctx: CostContext }
): Promise<Plan> {
  if (tags.length === 0) return { meanings: [], merges: [], parents: [], groups: [], moves: [] };
  const lines = tags.map((t) =>
    [
      `## ${t.name}${t.parents.length ? ` (under ${t.parents.join(", ")})` : ""}${t.meaning ? ` — means: ${t.meaning}` : " — no meaning yet"}`,
      ...t.notes.slice(0, 12).map((n) => `- ${n.ref ? `[${n.ref}] ` : ""}${n.title}: ${n.summary.slice(0, 240)}`),
      t.notes.length === 0 ? "- (no notes)" : t.notes.length > 12 ? `- …and ${t.notes.length - 12} more` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
  const reply = await generate({
    model: MODEL,
    operation: "tag-plan",
    ctx: opts.ctx,
    parts: [
      `You are tidying one person's note tags so that each tag means one clear thing, every note sits under the tags it is really about, and the tags form a tree by field. Below is every tag, with its meaning if it has one, where it sits, and the notes carrying it (title: summary).

Propose:
- "meanings": a one-line meaning for every tag that has none — what a note must be about to carry it, judged from its notes.
- "merges": tags that mean the same thing, or are spellings of one ("into" is the one that stays).
- "parents": a web where it helps — a tag under an existing broader tag naming the field it belongs to, under several when it belongs to several ("israel-palestine-war" under "war", "israel" and "palestine"), one entry each: "money" as society studies it under "sociology", the person's own money ("my-money") under "budgeting". Never a parent made of a word of the tag's own name ("money" over "my-money"). Only as deep as the notes need; flat is fine.
- "groups": new top-level tags, each gathering two or more of the tags listed with no parent, that belong to one field none of the listed tags names: the new tag (one concept, one or two words), its one-line meaning, the tags it gathers, and why. Never a word of a gathered tag's own name.
- "moves": for every note marked [n…] (that tag is its only one), the other tag listed here that the note is plainly about, or "" when none fits. Only tags already listed.
Judge the number of tags and the shape of the tree from these notes; different notes need different structures.

Everything in ${LANGUAGE_NAMES[opts.lang]}. Tag names lowercase, one concept, one or two words.

Return JSON only: {"meanings":[{"tag":"…","meaning":"…"}],"merges":[{"tag":"…","into":"…","why":"…"}],"parents":[{"tag":"…","parent":"…"}],"groups":[{"tag":"…","meaning":"…","children":["…"],"why":"…"}],"moves":[{"note":"n1","tag":"…"}]}`,
      `\n\n${opts.subjects.length ? `CLIENT NAMES (never tags): ${opts.subjects.join(", ")}\n\n` : ""}TAGS:\n${lines.join("\n\n")}${askedLines(opts.asked)}`,
    ],
    json: true,
  });
  const read = readJson(reply, PlanReply);
  return read ? keepPlan(read, tags, opts) : { meanings: [], merges: [], parents: [], groups: [], moves: [] };
}
