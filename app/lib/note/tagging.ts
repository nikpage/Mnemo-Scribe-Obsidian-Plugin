// [Filer]

import { z } from "zod";
import { generate, readJson } from "@/lib/ai/call";
import type { CostContext } from "@/lib/ai/cost";
import { type Lang, LANGUAGE_NAMES } from "@/lib/i18n";
import { normalizeSegment, singular } from "@/lib/note/filing";

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

/**
 * Whether `parent` is made from a word of the tag's own name (`money` over
 * `my-money`): a parent names the field a tag belongs to, never the word the
 * two share.
 */
export function ownWord(tag: string, parent: string): boolean {
  const words = (name: string) => name.split(/[-\s]+/).filter(Boolean).map(singular);
  const own = new Set(words(tag));
  return words(parent).some((word) => own.has(word));
}

/**
 * What survives of a filing reply: only the person's tags, each with a
 * sentence really in the note; only new tags never asked about before, not
 * barred, each with a sentence and a meaning.
 */
export function keepFitting(
  reply: { tags?: Reply["tags"]; proposed?: Reply["proposed"] },
  own: OwnTag[],
  text: string,
  opts: { subjects: string[]; asked: Set<string> }
): { tags: Earned[]; proposed: Proposal[] } {
  const names = new Set(own.map((tag) => tag.name));
  const tags: Earned[] = [];
  for (const item of reply.tags || []) {
    const tag = normalizeSegment(String(item.tag ?? ""));
    const why = String(item.quote ?? "").trim();
    // A note that only mentions what a tag means is not about it.
    if (item.weight !== "main" && item.weight !== "part") continue;
    if (!names.has(tag) || barred(tag, opts.subjects) || !quoted(why, text)) continue;
    if (!tags.some((t) => t.tag === tag)) tags.push({ tag, why });
  }
  const proposed: Proposal[] = [];
  for (const item of reply.proposed || []) {
    const tag = normalizeSegment(String(item.tag ?? ""));
    const why = String(item.quote ?? "").trim();
    const meaning = String(item.meaning ?? "").trim();
    if (!tag || names.has(tag) || opts.asked.has(tag) || barred(tag, opts.subjects)) continue;
    if (!meaning || !quoted(why, text) || proposed.some((p) => p.tag === tag)) continue;
    const parent = normalizeSegment(String(item.parent ?? ""));
    proposed.push({ tag, meaning, parent: names.has(parent) && !ownWord(tag, parent) ? parent : null, why });
  }
  return { tags, proposed };
}

function tagLines(own: OwnTag[]): string {
  return own.map((tag) => `- ${tag.name}${tag.meaning ? `: ${tag.meaning}` : ""}`).join("\n") || "(none yet)";
}

/** How a tag is judged against a note, the same for one note and for many. */
const JUDGE = `A tag fits only when the note is really about what the tag means. Judge by each tag's meaning, not its name: a word from the name appearing in the note proves nothing.

For every tag you consider, say how much of the note is about it — "main" (what the note is about), "part" (a real part of it), or "mention" (named in passing, as background, about someone else) — and copy a quote: one sentence, or a run of at least five words, copied character for character from the note. Never explain, paraphrase or summarise in the quote: if you cannot copy words that show it, the tag does not fit. A note can fit several tags or none; none is a fine answer.`;

const FILE_RULES = (lang: Lang) => `Decide which of this person's tags fit a note.

${JUDGE}

If none of the tags fits, propose one new tag for what the note is mainly about; if some fit, propose one only when the note is plainly about a concrete subject none of them covers. A new tag is a field, an activity, a place or a project: one concept, one or two words, in ${LANGUAGE_NAMES[lang]}, with a one-line meaning in ${LANGUAGE_NAMES[lang]}, an existing tag it would sit under (or null), and a quote. The tag it sits under names the field it belongs to — "money" as society studies it sits under "sociology", the person's own money under "budgeting" — never a word of its own name. When the note is about another sense of a word one of the tags already uses, give it its own name ("my-money", not a second "money"). Never propose a description of the kind of note (idea, reflection, thoughts, update, plan), a person's or client's name, a date, or a word for the note's state (draft, done, published). A note too short or empty to be about anything gets no proposal.

Return JSON only: {"tags":[{"tag":"…","weight":"main|part|mention","quote":"…"}],"proposed":[{"tag":"…","meaning":"…","parent":null,"quote":"…"}]}`;

/**
 * Which of the person's tags fit one note, and any new tag it seems to need.
 * `asked`: tags already proposed or skipped, never proposed again.
 */
export async function tagNote(
  note: { text: string },
  own: OwnTag[],
  opts: { lang: Lang; subjects: string[]; asked: Set<string>; ctx: CostContext }
): Promise<{ tags: Earned[]; proposed: Proposal[] }> {
  const text = note.text.slice(0, NOTE_CHARS);
  if (!text.trim()) return { tags: [], proposed: [] };
  const reply = await generate({
    model: MODEL,
    operation: "tag-check",
    ctx: opts.ctx,
    // The note's own words only: its title is the app's, never a quote.
    parts: [FILE_RULES(opts.lang), `\n\nTHE PERSON'S TAGS:\n${tagLines(own)}\n\nNOTE:\n${text}`],
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

const CheckReply = z.object({
  notes: z.array(z.object({ id: z.unknown(), tags: z.array(Judged).catch([]) })).catch([]),
});

/** How much text one re-check call reads before the next batch. */
const BATCH_CHARS = 120_000;

/**
 * Which of `tags` fit each note, read again. The verdict on `tags` only: a
 * note's other tags are not in question. Notes the model skipped come back
 * with nothing, so a re-check can only remove what it read.
 */
export async function checkNotes(
  notes: { id: string; text: string }[],
  tags: OwnTag[],
  opts: { subjects: string[]; ctx: CostContext }
): Promise<Map<string, Earned[]>> {
  const out = new Map<string, Earned[]>();
  if (tags.length === 0) return out;
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

Return JSON only: {"notes":[{"id":"…","tags":[{"tag":"…","weight":"main|part|mention","quote":"…"}]}]}`,
        `\n\nTAGS:\n${tagLines(tags)}\n\nNOTES:\n${batch.map((n) => `=== id: ${n.id}\n${n.text}`).join("\n\n")}`,
      ],
      json: true,
    });
    const read = readJson(reply, CheckReply);
    for (const note of batch) {
      const said = read?.notes.find((n) => String(n.id) === note.id);
      out.set(note.id, keepFitting({ tags: said?.tags ?? [] }, tags, note.text, { subjects: opts.subjects, asked: new Set() }).tags);
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
  parent: string | null;
  /** `ref` marks a note whose only tag this is, so the tidy-up can say where it would go. */
  notes: { title: string; summary: string; ref?: string }[];
}

/**
 * The plan, checked: only tags that exist are given meanings (only those
 * without one), merged or moved; a merge goes into a tag that stays; a
 * parent never makes a loop and is never a word of the tag's own name; a new
 * top-level tag is not barred, not one the person already skipped, and
 * gathers at least two top-level tags.
 */
export function keepPlan(reply: z.infer<typeof PlanReply>, tags: TagSummary[], opts: { subjects: string[]; asked: Set<string> }): Plan {
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

  // Parents among the tags that remain, applied in order and dropped where one would close a loop.
  const above = new Map<string, string>(tags.filter((t) => t.parent && living.has(t.parent)).map((t) => [t.name, t.parent!]));
  const loops = (tag: string, parent: string) => {
    for (let at: string | undefined = parent; at; at = above.get(at)) if (at === tag) return true;
    return false;
  };
  const parents: Plan["parents"] = [];
  for (const p of reply.parents) {
    const tag = name(p.tag);
    const parent = name(p.parent);
    if (!living.has(tag) || !living.has(parent) || tag === parent || above.get(tag) === parent || loops(tag, parent) || ownWord(tag, parent)) continue;
    if (parents.some((q) => q.tag === tag)) continue;
    above.set(tag, parent);
    parents.push({ tag, parent });
  }

  // A new tag over tags still at the top once the parents above are placed; each tag in one group.
  const groups: Plan["groups"] = [];
  const gathered = new Set<string>();
  for (const g of reply.groups) {
    const tag = name(g.tag);
    const meaning = words(g.meaning);
    if (!tag || !meaning || names.has(tag) || opts.asked.has(tag) || barred(tag, opts.subjects) || groups.some((h) => h.tag === tag)) continue;
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
      `## ${t.name}${t.parent ? ` (under ${t.parent})` : ""}${t.meaning ? ` — means: ${t.meaning}` : " — no meaning yet"}`,
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
- "parents": a tree where it helps — a tag under an existing broader tag naming the field it belongs to: "money" as society studies it under "sociology", the person's own money ("my-money") under "budgeting". Never a parent made of a word of the tag's own name ("money" over "my-money"). Only as deep as the notes need; flat is fine.
- "groups": new top-level tags, each gathering two or more of the tags listed with no parent, that belong to one field none of the listed tags names: the new tag (one concept, one or two words), its one-line meaning, the tags it gathers, and why. Never a word of a gathered tag's own name.
- "moves": for every note marked [n…] (that tag is its only one), the other tag listed here that the note is plainly about, or "" when none fits. Only tags already listed.
Judge the number of tags and the shape of the tree from these notes; different notes need different structures.

Everything in ${LANGUAGE_NAMES[opts.lang]}. Tag names lowercase, one concept, one or two words.

Return JSON only: {"meanings":[{"tag":"…","meaning":"…"}],"merges":[{"tag":"…","into":"…","why":"…"}],"parents":[{"tag":"…","parent":"…"}],"groups":[{"tag":"…","meaning":"…","children":["…"],"why":"…"}],"moves":[{"note":"n1","tag":"…"}]}`,
      `\n\n${opts.subjects.length ? `CLIENT NAMES (never tags): ${opts.subjects.join(", ")}\n\n` : ""}TAGS:\n${lines.join("\n\n")}`,
    ],
    json: true,
  });
  const read = readJson(reply, PlanReply);
  return read ? keepPlan(read, tags, opts) : { meanings: [], merges: [], parents: [], groups: [], moves: [] };
}
