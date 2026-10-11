// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { release } from "@/lib/ai/claim";
import { WRITING_TOKENS, chargeCredits } from "@/lib/billing/credits";
import { AiDeclined, type ResponseSchema, SchemaType, countTokens, generate, generateWithUsage, readJson } from "@/lib/ai/call";
import { type CostContext, type TextModel, spentOf } from "@/lib/ai/cost";
import { type StoreNote, loadStore } from "@/lib/note/angles";
import { renderStore } from "@/lib/note/render-store";
import { AIM_TOKENS, selectForSubject } from "@/lib/note/what-next-select";
import { LINK_KINDS, addLinks } from "@/lib/note/links";
import { EVERYTHING, KINDS, type Kind, type Narrow, type Scope, subjectOf } from "@/lib/note/what-next-target";

export { KINDS, type Kind, type Narrow, SCOPES, type Scope, readingTarget, subjectOf, subjectTarget } from "@/lib/note/what-next-target";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/**
 * What next: the whole store read in one call and asked what lines of
 * thought run through it and which pieces of work follow. Three short
 * readings — the whole store, the notes carrying some tags, one note against everything
 * before it — and "Elaborate", one part of a reading written out.
 *
 * The prompts are the ones judged in `tests-live/what-next.test.ts`, which
 * imports them from here so the app and the test can never differ.
 *
 * The store goes with every call, uncached: holding it cost more than half
 * a press and pays off only over several follow-ups in 15 minutes.
 */

export const WHAT_NEXT_MODEL: TextModel = "gemini-3.8-flash";

export const LAYOUT = `The notes run oldest first. Notes marked "part N" that stand together are the instalments of one work, in that order: read them as one piece, say what the whole of it argues, and never present its parts as separate notes that agree with each other.`;

export const VOICE = `Voice. You are a peer who knows these fields and has read all of it, talking it through the way a good radio host does with a guest whose work they respect: informed, direct, worth listening to. Use the vocabulary the notes use and assume the knowledge they assume; explain nothing the person plainly knows. Open with the finding itself, stated as a plain claim about the notes: no framing phrase before it ("The most striking…", "What stands out…", "The key tension…"), no preamble. Write to the person as "you", in English, in running prose under short headings: no lists of labelled fields, no flattery, no hype, no note-by-note summary.`;

export const RULES = `Rules. Rest every statement about what the person thinks on the notes: name the note by its title, and when you rely on its words quote them exactly. Attribute nothing to the person that the notes do not say; a step of your own must read as your suggestion. The notes are voice transcripts: where words were plainly mis-heard, do not quote that sentence. Spoken notes are compressed: read each statement for what the speaker plainly means, not its literal wording. Where a phrase taken literally would give the person a position no reasonable person holds, take the meaning that fits the rest of the note, and state that meaning in your own words before quoting the original.`;

/**
 * What next earns its place by adding what the notes alone cannot: left to
 * the notes, it handed the person their own to-dos back, and once a tag.
 */
export const NEXT = `What next is where you add what the notes alone cannot. Bring what you know beyond them: thinkers, evidence, precedents, the strongest argument against. Name it, and make plain it comes from you, not the notes. Never hand back a plan, task or intention the notes already state; take it further or leave it out. Nothing about filing, tagging, folders or organising the notes.`;

/**
 * The opening is its own field of the reply, required by the reply's
 * schema: asked for in the prose alone, the model sometimes skipped it.
 */
export const REPLY = `Reply as JSON with three fields. "opening": one or two sentences, the finding itself stated as a plain claim about the notes, the way a good host opens a segment. "reading": everything after it, in Markdown, from its first heading on, never repeating the opening. "links": the pairs of notes above that plainly relate, for the person's Related list; most pairs do not, and an empty array is a normal answer.

${LINK_KINDS}

Each link: {"later": the later note's id, "earlier": the earlier note's id, "type": one of the five, "confidence": 0 to 1, below 0.4 when it is a guess from topic alone, above 0.8 only when the notes say it themselves, "reason": one short sentence, in the language of the note titles, naming the evidence}.`;

export const SHORT = `This is the short version: the person can ask for any part of it to be written out in full. Keep every part asked for below, each at its sharpest: the finding and the one quote or note that best carries it, not the whole case. Cut words, never the thinking.`;

export const OVERVIEW = (notes: number) => `Above is everything one person has recorded in their notes: ${notes} notes, each with its id, title, tags and date. The notes are transcribed, filed and searchable. Their question now is: WHAT NEXT?

${LAYOUT}

${VOICE}

PART 1 — WHAT IS HERE
The main lines of thought that run through these notes (three to six): what you actually argue, in which notes, and how it has moved over time. How the lines connect: where one depends on another, strengthens it, or undermines it. What is strongest and most your own; what is asserted but not yet argued; what the argument needs and does not yet have.

PART 2 — WHAT NEXT
Three pieces of work you are now in a position to make (an essay, a decision, a project, a chapter), the most promising first, each as one short paragraph under its working title in bold: what it would argue or decide, why now, and where you would begin.

${NEXT}

${SHORT}

${RULES} About 300 words.

${REPLY}`;

/** The notes carrying every one of these tags: what a tag view or a saved group shows. */
export const TAGGED = (notes: number, tags: string[]) => {
  const work = tags.map((tag) => `"${tag}"`).join(" + ");
  return `Above is everything one person has recorded in their notes: ${notes} notes, each with its id, title, tags and date. They are now working on the notes tagged ${work}, and their question is about that work: WHAT NEXT?

${LAYOUT}

${VOICE}

Every note without ${tags.length > 1 ? "all of those tags" : "that tag"} is background. Bring one in only where it bears on this work — supports it, contradicts it, or supplies something it lacks — and say which it does.

PART 1 — WHAT IS HERE
What the work tagged ${work} argues or builds, as one body: how it has moved over time, what is strongest in it, what is asserted but not yet argued, and what it needs and does not yet have. Then what the rest of the notes add to it or hold against it.

PART 2 — WHAT NEXT
Three next pieces of this work, the most promising first, each as one short paragraph under its working title in bold: what it would argue or decide, why now, and where you would begin.

${NEXT}

${SHORT}

${RULES} About 250 words.

${REPLY}`;
};

export const ITEM = (notes: number, item: StoreNote) => `Above is everything one person has recorded in their notes: ${notes} notes, each with its id, title, tags and date. The NEW ITEM is the note "${item.label}" [${item.id}]; every other note was recorded before it. Their question: what does my past work make of this new item?

${LAYOUT}

${VOICE}

Read the new item through the past work, not the other way round: what in it recurs from earlier notes, what is new, and where a position has actually moved. Coming back to a subject is normal, and looking at it from another side is not a change of view: call it a change only where the new item itself says the earlier view was wrong, and then quote both. A note need not use everything said before it; never call something dropped or missing.
Then what next: the line of work it belongs to, and what it opens there.

${NEXT}

${SHORT}

${RULES} About 200 words.

${REPLY}`;

export const MORE = (short: string, part: string) => `Above is everything one person has recorded in their notes. You have already given them this short reading of it:

---
${short}
---

They now ask for more on one part of it: ${part}.

${LAYOUT}

${VOICE}

Write that part out in full, and only that part: the whole case for it from the notes, what stands against it, what is still to be worked out, and how to begin. Repeat nothing from the short reading that you do not build on.

${RULES} About 400 words.`;


/** What the store above a subject's question is: everything, or the notes chosen for it. */
function subjectStore(subject: string, notes: number, whole: boolean) {
  if (subject === EVERYTHING) return `Above are ${notes} of one person's notes, each with its id, title, tags and date. Their focus is no one subject but all of these notes, taken together.`;
  return whole
    ? `Above is everything one person has recorded in their notes: ${notes} notes, each with its id, title, tags and date. Their focus now is one subject: "${subject}". Every note not about it is background.`
    : `Above are ${notes} of one person's notes, each with its id, title, tags and date, chosen from their store as the ones nearest one subject: "${subject}". Some may turn out to be about something else; leave those out. A note marked as excerpts holds only its passages nearest the subject.`;
}

/** Log: the record of what was done on the subject, in order. */
const LOG = `They ask for the LOG: the record of what they have done on this subject, in order, from the notes.

Write it oldest first, one entry per thing done or decided: the date it was recorded, what was done, with what (quantities, materials, settings, people, as the notes give them) and what came of it where the notes say. Only what was done or decided on this subject; a note that merely mentions it stays out. Where the record has a gap (a result never noted, a step without a date), say so in its entry. After the entries, two or three sentences on what the record shows: what has changed over time and what keeps recurring. No advice.

${RULES}`;

/** Inspiration: material for the next piece of writing, never the piece. */
const INSPIRATION = `They are about to write their next piece on this subject (a blog post, a chapter, an article) and ask for INSPIRATION: material to get their thinking going. Not the piece, not its outline, not its form.

Give them what to think with, each as a short paragraph under a short heading: the ideas in the notes on this subject that are strongest and least used yet; where notes pull against each other and something is unresolved; the questions the notes raise and never answer; the concrete moments, examples and phrases of their own worth building on. Then what you know beyond the notes that bears on it: a thinker, a piece of evidence, a precedent, the strongest objection, named and marked as yours. Never write the piece, its opening, its title or its structure.

${RULES} About 500 words.`;

/** Next best: the next experiment or step not yet done. */
const NEXT_BEST = `They ask for the NEXT BEST step: the next experiment, recipe or step on this subject they have not yet done, drawn from what the notes record.

First, in two or three sentences, what the notes record so far and where it stands. Then the one next step you would take, concrete enough to do: what exactly, with what, how they will tell whether it worked, and what in the notes points to it. Never a step the notes show as already done. Then one or two alternatives, a sentence each. Where the notes on this subject are thin, say so in one sentence and work with what there is, bringing in what you know beyond the notes, marked as yours.

${RULES} About 350 words.`;

/** Study: what to learn on the subject from the notes, and questions to test it. */
const STUDY = `They are about to be tested on this subject, or want to master it, and ask for a STUDY GUIDE built from their notes.

First the key ideas, in the order they build on each other, each under a short heading: what it is, in plain words, and the note it comes from, quoting it where the wording matters. Then the terms they must know, each with its meaning in one line. Then where the notes are confused, contradict each other or stay thin, so they know what to read up on. Then what you know beyond the notes that a test on this subject would expect and the notes leave out, named and marked as yours. End with eight questions that test understanding rather than recall, each followed by a short answer drawn from the notes.

${RULES} About 600 words.`;

/** Big picture: what the notes on the subject hold, and the work they lead to. */
const PICTURE = `They ask for the BIG PICTURE of this subject: what their notes on it hold, and what to do next.

${VOICE}

PART 1 — WHAT IS HERE
What the notes on this subject argue or build, as one body: how it has moved over time, what is strongest and most their own, what is asserted but not yet argued, and what it needs and does not yet have.

PART 2 — WHAT NEXT
Three pieces of work they are now in a position to make on it, the most promising first, each as one short paragraph under its working title in bold: what it would argue or decide, why now, and where to begin.

${NEXT}

${SHORT}

${RULES} About 250 words.`;

/** The note a reading is centred on, when it is: read first, the rest read against it. */
const CENTRE = (note: StoreNote) =>
  `The note "${note.label}" [${note.id}] is the one they are working from. Read it first; read every other note for what it says about it (supports it, contradicts it, or supplies something it lacks) and say which.`;

/** The question after a subject's notes, for one fixed button. */
export function subjectPrompt(kind: Kind, subject: string, notes: number, whole: boolean, centre?: StoreNote): string {
  const question = { log: LOG, inspiration: INSPIRATION, "next-best": NEXT_BEST, study: STUDY, picture: PICTURE }[kind];
  return `${subjectStore(subject, notes, whole)}

${LAYOUT}
${centre ? `\n${CENTRE(centre)}\n` : ""}
${question}

${REPLY}`;
}

/** Each note as the suggestion call sees it: its title and tags, never its text. */
export function suggestList(store: StoreNote[], tags: Map<string, string[]>): string {
  return store
    .map((n) => {
      const noteTags = tags.get(n.id) || [];
      return `${n.label} (${n.recordedAt.slice(0, 10)})${noteTags.length ? ` — tags: ${noteTags.join(", ")}` : ""}`;
    })
    .join("\n");
}

export const SUGGEST = `Above are the titles and tags of every note one person has recorded, oldest first. Suggest the three topics they are most likely to want to work on next, each a different subject they keep coming back to.

Each suggestion has: "label", the topic as a button label of two to four words in the language of the titles; "subject", what it is about in a few words, as they would type it; "jobs", what their notes on it would let them do next, one or more of: "log" (review their progress: only where the notes record the same practice or measurement repeatedly, on different days), "inspiration" (write more about it: a line of thought they develop), "next-best" (improve it: a practice, recipe or experiment they repeat and could do better next time), "study" (learn it: material they are studying or taking in). Give only the jobs the notes on that subject plainly support, the best fit first.

Reply as JSON: {"suggestions": [{"label": "…", "subject": "…", "jobs": ["…"]}]}, exactly three.`;

export const SUGGEST_MODEL: TextModel = "gemini-3.1-flash-lite";

const Suggestions = z.object({
  suggestions: z
    .array(z.object({ label: z.string().trim().min(1), subject: z.string().trim().min(1), jobs: z.array(z.enum(KINDS)).min(1) }))
    .length(3),
});
export type Suggestion = z.infer<typeof Suggestions>["suggestions"][number];

const Kept = z.array(
  z.object({ label: z.string(), subject: z.string(), jobs: z.array(z.enum(KINDS)).optional(), kind: z.enum(KINDS).optional() })
);

/** A day's kept suggestions read back, none when unreadable; a day kept before jobs carried one `kind`. */
export function keptSuggestions(raw: string): Suggestion[] {
  return (readJson(raw, Kept) ?? []).map(({ label, subject, jobs, kind }) => ({ label, subject, jobs: jobs ?? (kind ? [kind] : []) }));
}

/** The three dynamic buttons: one light call over titles and tags. Throws on a reply without three. */
export async function suggestButtons(store: StoreNote[], tags: Map<string, string[]>, ctx: CostContext): Promise<Suggestion[]> {
  const reply = await generate({ model: SUGGEST_MODEL, operation: "what-next", ctx, json: true, parts: [suggestList(store, tags), SUGGEST] });
  const parsed = readJson(reply, Suggestions);
  if (!parsed) throw new Error("Suggestions without three buttons");
  return parsed.suggestions;
}

export { partOf, renderStore } from "@/lib/note/render-store";

/** Every note a reading may read, with its tags. */
export async function readStore(admin: Admin, userId: string) {
  const store = await loadStore(admin, userId);
  const { data: tagged } = await admin.from("recordings").select("id, tags").eq("user_id", userId);
  const tags = new Map(((tagged || []) as { id: string; tags: string[] | null }[]).map((r) => [r.id, r.tags || []]));
  return { store, tags, ...renderStore(store, tags) };
}


/** What one reading asks: the store it reads and the question after it. */
export function readingPrompt(
  scope: Exclude<Scope, "subject">,
  target: string,
  store: StoreNote[],
  tags: Map<string, string[]>
): { text: string; prompt: string; notes: number; read: StoreNote[] } {
  if (scope === "item") {
    const item = store.find((n) => n.id === target);
    if (!item) throw new Error("Note not in the store");
    // "Every other note was recorded before it": an older note is read
    // against its own past, never against what came after.
    const before = store.filter((n) => n.id === item.id || n.recordedAt <= item.recordedAt);
    return { text: renderStore(before, tags).text, prompt: ITEM(before.length, item), notes: before.length, read: before };
  }
  const { text } = renderStore(store, tags);
  return { text, prompt: scope === "tags" ? TAGGED(store.length, target.split(",")) : OVERVIEW(store.length), notes: store.length, read: store };
}

/** The notes a narrowing leaves; the centre note always stays. */
export function narrowStore(store: StoreNote[], tags: Map<string, string[]>, narrow: Narrow): StoreNote[] {
  if (narrow.centre && !store.some((n) => n.id === narrow.centre)) throw new Error("Note not in the store");
  return store.filter((n) => {
    if (n.id === narrow.centre) return true;
    const own = tags.get(n.id) || [];
    const day = n.recordedAt.slice(0, 10);
    return (
      narrow.only.every((tag) => own.includes(tag)) &&
      !narrow.not.some((tag) => own.includes(tag)) &&
      (!narrow.from || day >= narrow.from) &&
      (!narrow.to || day <= narrow.to)
    );
  });
}

/** What a subject reading asks: the notes chosen for the subject and the button's question. */
export async function subjectReadingPrompt(admin: Admin, userId: string, target: string, store: StoreNote[], tags: Map<string, string[]>, ctx: CostContext) {
  const asked = subjectOf(target);
  if (!asked) throw new Error("Not a subject reading");
  const narrowed = narrowStore(store, tags, asked.narrow);
  if (narrowed.length === 0) throw new Error("No notes left by the narrowing");
  const chosen = await selectForSubject(admin, userId, asked.subject, narrowed, tags, ctx);
  // A centre note is read whole even when the subject's nearest passages left it out.
  const centre = narrowed.find((n) => n.id === asked.narrow.centre);
  const notes = centre && !chosen.notes.some((n) => n.id === centre.id) ? [centre, ...chosen.notes] : chosen.notes;
  return {
    text: renderStore(notes, tags).text,
    prompt: subjectPrompt(asked.kind, asked.subject, notes.length, chosen.whole, centre),
    notes: notes.length,
    read: notes,
  };
}

/**
 * How big one press is, in tokens, worked out before it is pressed and with
 * no paid call: what it reads and its question, counted by Gemini's own
 * tokenizer (`countTokens()`, free), and its writing. A subject reading over
 * the reading's aim reads about the aim (`what-next-select.ts`), so it is
 * quoted at the aim. An Elaborate reads what its reading read, plus the
 * reading. Null when there is nothing to read.
 */
export async function readingSize(
  admin: Admin,
  userId: string,
  asked: { scope: Exclude<Scope, "subject"> | "subject"; target: string; parent?: { scope: Scope; target: string; reading: string } }
): Promise<{ tokens: number; notes: number } | null> {
  const { store, tags } = await readStore(admin, userId);
  const read = asked.parent ?? asked;
  let parts: string[];
  let notes: number;
  let cap = Infinity;
  if (read.scope === "subject") {
    const subject = subjectOf(read.target);
    if (!subject) return null;
    const narrowed = narrowStore(store, tags, subject.narrow);
    if (narrowed.length === 0) return null;
    const { text } = renderStore(narrowed, tags);
    // Without the subject's own words, so its price does not move as it is typed.
    // Whole or chosen as `selectNotes()` decides it, by its own four characters a token.
    parts = [text, subjectPrompt(subject.kind, "", narrowed.length, text.length / 4 <= AIM_TOKENS)];
    notes = narrowed.length;
    cap = AIM_TOKENS;
  } else {
    if (store.length === 0) return null;
    const { text, prompt, notes: n } = readingPrompt(read.scope, read.target, store, tags);
    parts = [text, prompt];
    notes = n;
  }
  // Elaborate's question carries the reading; the part asked for is a heading of it.
  if (asked.parent) parts.push(MORE(asked.parent.reading, ""));
  // The notes and the question counted apart: only the notes are held to the aim.
  const [notesTokens, questionTokens] = await Promise.all([countTokens(WHAT_NEXT_MODEL, parts.slice(0, 1)), countTokens(WHAT_NEXT_MODEL, parts.slice(1))]);
  return { tokens: Math.min(notesTokens, cap) + questionTokens + WRITING_TOKENS, notes };
}

/** One call: the store first, then the question. Budgeted and costed by `generate`. */
export async function ask(storeText: string, prompt: string, ctx: CostContext) {
  return generateWithUsage({ model: WHAT_NEXT_MODEL, operation: "what-next", ctx, parts: [storeText, prompt] });
}

const READING_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    opening: { type: SchemaType.STRING },
    reading: { type: SchemaType.STRING },
    links: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          later: { type: SchemaType.STRING },
          earlier: { type: SchemaType.STRING },
          type: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER },
          reason: { type: SchemaType.STRING },
        },
        required: ["later", "earlier", "type", "confidence", "reason"],
      },
    },
  },
  required: ["opening", "reading"],
};

const Reading = z.object({ opening: z.string().trim().min(1), reading: z.string().trim().min(1) });

const Links = z.object({
  links: z
    .array(z.object({ later: z.string(), earlier: z.string(), type: z.string(), confidence: z.number(), reason: z.string() }))
    .catch([]),
});

/** The links a reading noticed; none when it named none or named them badly. A bad list never costs the reading. */
export function readingLinks(reply: string) {
  return readJson(reply, Links)?.links ?? [];
}

/** The reading as stored and shown: the opening, then the rest. Throws on a reply without both. */
export function readingText(reply: string): string {
  const parsed = readJson(reply, Reading);
  if (!parsed) throw new Error("Reading without its opening");
  return `${parsed.opening.trim()}\n\n${parsed.reading.trim()}`;
}

/** A short reading: one call, its opening required by the reply's schema. */
export async function askReading(storeText: string, prompt: string, ctx: CostContext) {
  const { text, usage } = await generateWithUsage({ model: WHAT_NEXT_MODEL, operation: "what-next", ctx, parts: [storeText, prompt], schema: READING_SCHEMA });
  return { text: readingText(text), usage, links: readingLinks(text) };
}

/** Netlify's ceiling for a background function: a run older than this died. */
export const RUN_LIMIT_MS = 15 * 60 * 1000;

/** One press at a time per account: a double tap or a second tab would pay twice. */
export const WHAT_NEXT_CLAIM = "what-next";

/** Paid readings one account gets a calendar month, Elaborate included. */
export const READINGS_PER_MONTH = 30;

/** Whether the account may press again this month (UTC). A failed reading got nothing and is not counted. */
export async function readingAllowed(admin: Admin, userId: string, now = new Date()): Promise<boolean> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await admin
    .from("what_next_readings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "failed")
    // The day's suggested subjects are not a reading.
    .neq("scope", "suggest")
    .gte("created_at", monthStart);
  return (count ?? 0) < READINGS_PER_MONTH;
}

export type ReadingStatus = "running" | "done" | "failed";

/** What the screen is told: a run the ceiling killed reads as failed. */
export function readingStatus(row: { status: ReadingStatus; created_at: string }, now = Date.now()): ReadingStatus {
  return row.status === "running" && now - Date.parse(row.created_at) > RUN_LIMIT_MS ? "failed" : row.status;
}

/**
 * Writes one recorded reading. Never throws: Netlify runs a background
 * function again when it throws, and a second run pays again.
 */
export async function runReading(admin: Admin, readingId: string): Promise<void> {
  try {
    const { data: row } = await admin
      .from("what_next_readings")
      .select("id, user_id, scope, target, parent_id, part, status, credits")
      .eq("id", readingId)
      .maybeSingle();
    if (!row || row.status !== "running") return;

    const finish = (fields: { status: ReadingStatus; reading?: string; notes?: number; error?: string; cost_usd?: number; read_tokens?: number; wrote_tokens?: number }) =>
      admin
        .from("what_next_readings")
        .update({ ...fields, finished_at: new Date().toISOString() })
        .eq("id", readingId)
        .eq("user_id", row.user_id);

    try {
      const { store, tags } = await readStore(admin, row.user_id);
      const ctx: CostContext = { userId: row.user_id, ...(row.scope === "item" ? { recordingId: row.target } : {}) };
      let asked: { text: string; prompt: string; notes: number; read: StoreNote[] };
      if (row.parent_id) {
        const { data: parent } = await admin
          .from("what_next_readings")
          .select("scope, target, reading")
          .eq("id", row.parent_id)
          .eq("user_id", row.user_id)
          .maybeSingle();
        if (!parent?.reading) throw new Error("No reading to elaborate");
        // The same store the reading read, then the part asked for.
        const read =
          parent.scope === "subject"
            ? await subjectReadingPrompt(admin, row.user_id, parent.target, store, tags, ctx)
            : readingPrompt(parent.scope as Exclude<Scope, "subject">, parent.target, store, tags);
        asked = { ...read, prompt: MORE(parent.reading, row.part) };
      } else if (row.scope === "subject") {
        asked = await subjectReadingPrompt(admin, row.user_id, row.target, store, tags, ctx);
      } else {
        asked = readingPrompt(row.scope as Exclude<Scope, "subject">, row.target, store, tags);
      }
      const { text, usage, links } = row.parent_id
        ? { ...(await ask(asked.text, asked.prompt, ctx)), links: null }
        : await askReading(asked.text, asked.prompt, ctx);
      if (!text.trim()) throw new Error("Empty reading");
      // What it really cost, kept for the owner's eyes only (the route strips it for anyone else).
      const spent = spentOf(usage);
      await finish({
        status: "done",
        reading: text.trim(),
        notes: asked.notes,
        ...(spent ? { cost_usd: spent.costUsd, read_tokens: spent.readTokens, wrote_tokens: spent.wroteTokens } : {}),
      });
      // Exactly the price shown before the press, fixed on the row by the route.
      await chargeCredits(admin, row.user_id, "reading", row.credits ?? 0, readingId);
      // Related, at no extra price: every note read is marked looked at. An
      // Elaborate is asked for prose only and changes nothing here.
      if (links) await addLinks(admin, row.user_id, asked.read, links);
    } catch (err) {
      console.error(`What-next reading ${readingId} failed:`, err);
      // "declined" is read by the screen; any other reason is for the log.
      const error = err instanceof AiDeclined ? "declined" : err instanceof Error ? err.message : String(err);
      await finish({ status: "failed", error });
    } finally {
      await release(admin, row.user_id, WHAT_NEXT_CLAIM);
    }
  } catch (err) {
    console.error(`What-next reading ${readingId} could not be recorded:`, err);
  }
}
