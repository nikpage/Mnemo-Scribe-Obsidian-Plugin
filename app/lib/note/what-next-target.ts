// [Guru]

import { normalizeTags } from "@/lib/note/filing";

/**
 * What a What-next reading is of, spelled one way: pure, so the screen
 * builds the same target the server reads (`what-next.ts`).
 */

/**
 * What a person is about to do on a topic, and so what the reading prepares:
 * report how it is going (`log`), write about it (`inspiration`), try it
 * again better (`next-best`), be tested on it (`study`), or see what the
 * notes hold and where they lead (`picture`). The keys are the stored
 * targets' and never change; the screen names each job.
 */
export const KINDS = ["log", "inspiration", "next-best", "study", "picture"] as const;
export type Kind = (typeof KINDS)[number];

/** `tags` reads the notes carrying every tag in its target, comma-separated. */
export const SCOPES = ["overview", "tags", "item", "subject"] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * Which notes a subject reading may read at all: those carrying every `only`
 * tag, none of the `not` tags, recorded from `from` to `to` (dates, inclusive).
 * `centre`, a note's id, is read first and always, whatever else narrows:
 * every other note is read for what it says about it. `alone` reads only these
 * notes: no notes from elsewhere are added by a link, a subject or a theme.
 * `of`, a Brain output's id, reads only the notes that output read.
 * `pick`, the Web's trail, reads only those notes and the notes carrying
 * those tags (or a tag beneath them).
 */
export interface Narrow {
  only: string[];
  not: string[];
  from: string;
  to: string;
  centre?: string;
  alone?: boolean;
  of?: string;
  pick?: Trail;
}

/** Notes by id and tags by name, read as one subset: a note is in it when it is named or carries a tag named. */
export type Trail = { notes: string[]; tags: string[] };

/** One spelling per trail: ids and tags sorted, none twice; null when it names nothing. */
export function pickOf(raw: { notes?: string[]; tags?: string[] } | undefined): Trail | null {
  const notes = [...new Set((raw?.notes ?? []).map((id) => id.trim()).filter(Boolean))].sort();
  const tags = normalizeTags(raw?.tags ?? []).sort();
  return notes.length || tags.length ? { notes, tags } : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A subject reading's target: "<kind>:<subject>", then the narrowing on a
 * second line when there is any. One spelling per reading: tags sorted, the
 * same narrowing however it was set.
 */
export function subjectTarget(kind: Kind, subject: string, narrow?: Partial<Narrow>): string {
  const head = `${kind}:${subject.replace(/\s+/g, " ").trim()}`;
  const p = new URLSearchParams();
  const only = normalizeTags(narrow?.only || []).sort();
  const not = normalizeTags(narrow?.not || []).filter((tag) => !only.includes(tag)).sort();
  if (only.length) p.set("only", only.join(","));
  if (not.length) p.set("not", not.join(","));
  if (narrow?.from && DATE.test(narrow.from)) p.set("from", narrow.from);
  if (narrow?.to && DATE.test(narrow.to)) p.set("to", narrow.to);
  if (narrow?.centre) p.set("centre", narrow.centre);
  if (narrow?.alone) p.set("alone", "1");
  if (narrow?.of) p.set("of", narrow.of);
  const pick = pickOf(narrow?.pick);
  if (pick?.notes.length) p.set("notes", pick.notes.join(","));
  if (pick?.tags.length) p.set("any", pick.tags.join(","));
  const tail = p.toString();
  return tail ? `${head}\n${tail}` : head;
}

/** A subject reading's target read back; null when it is not one. */
export function subjectOf(target: string): { kind: Kind; subject: string; narrow: Narrow } | null {
  const [head, tail = ""] = target.split("\n");
  const at = head.indexOf(":");
  const kind = head.slice(0, at) as Kind;
  const subject = head.slice(at + 1).replace(/\s+/g, " ").trim();
  if (!(at > 0 && KINDS.includes(kind) && subject)) return null;
  const p = new URLSearchParams(tail);
  const list = (key: string) => normalizeTags((p.get(key) || "").split(","));
  const date = (key: string) => (DATE.test(p.get(key) || "") ? p.get(key)! : "");
  const centre = p.get("centre") || "";
  const alone = p.get("alone") === "1";
  const of = p.get("of") || "";
  const pick = pickOf({ notes: (p.get("notes") || "").split(","), tags: list("any") });
  return { kind, subject, narrow: { only: list("only"), not: list("not"), from: date("from"), to: date("to"), ...(centre ? { centre } : {}), ...(alone ? { alone } : {}), ...(of ? { of } : {}), ...(pick ? { pick } : {}) } };
}

/**
 * One spelling per reading target: a tag reading is the same reading
 * whichever order the tags were tapped in, a subject reading the same
 * whatever order its narrowing was set in. Empty when it names nothing.
 */
export function readingTarget(scope: Scope, raw: string): string {
  if (scope === "overview") return "";
  if (scope === "tags") return normalizeTags(raw.split(",")).sort().join(",");
  if (scope === "subject") {
    const asked = subjectOf(raw);
    return asked ? subjectTarget(asked.kind, asked.subject, asked.narrow) : "";
  }
  return raw;
}


/** What the Brain panel was asked: notes to read (topics, tags, dates, a centre note) and what for. */
export interface Choice {
  kind: Kind;
  /** Read as one subject, in the order added. */
  topics: string[];
  narrow: Narrow;
}

/** The subject of a reading that names none: all the notes it may read. */
export const EVERYTHING = "everything";

/**
 * The one reading a choice asks for. The big picture of everything, of some
 * tags, or of one note against the notes before it keeps the reading it always
 * was; anything else is a subject reading of its topics, or of the centre
 * note's title, or of the tags, when no topic is typed, or of everything the
 * narrowing leaves: every choice is a reading, so every choice has a price.
 */
export function readingOf(choice: Choice, centreTitle = ""): { scope: Scope; target: string } {
  const { kind, narrow } = choice;
  const topic = choice.topics.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ");
  const only = normalizeTags(narrow.only);
  const dated = Boolean(narrow.from || narrow.to);
  const picked = Boolean(pickOf(narrow.pick));
  const narrowed = only.length > 0 || normalizeTags(narrow.not).length > 0 || dated || Boolean(narrow.of) || picked;
  if (kind === "picture" && !topic) {
    if (narrow.centre && !narrowed) return { scope: "item", target: narrow.centre };
    if (!narrow.centre && !normalizeTags(narrow.not).length && !dated && !narrow.of && !picked) {
      return only.length ? { scope: "tags", target: [...only].sort().join(",") } : { scope: "overview", target: "" };
    }
  }
  // Nothing named: the reading is about everything the narrowing leaves.
  const about = topic || (narrow.centre ? centreTitle.trim() : "") || only.join(", ") || EVERYTHING;
  return { scope: "subject", target: subjectTarget(kind, about, narrow) };
}

/** A tag in the Brain's narrowing, in turn: read only notes with it, or none with it. */
export function flipTag(narrow: Narrow, tag: string): Narrow {
  return narrow.only.includes(tag)
    ? { ...narrow, only: narrow.only.filter((x) => x !== tag), not: [...narrow.not, tag] }
    : { ...narrow, not: narrow.not.filter((x) => x !== tag), only: [...narrow.only, tag] };
}

/**
 * The narrowing a reading is made of: tags struck through in the Brain stay on
 * screen but narrow nothing, so a reading's address and price ignore them.
 */
export function liveNarrow(narrow: Narrow, struck: string[]): Narrow {
  return { ...narrow, only: narrow.only.filter((x) => !struck.includes(x)), not: narrow.not.filter((x) => !struck.includes(x)) };
}

/**
 * What the Brain starts with. Opened from the Web it starts on the set: its
 * tags, the struck ones among them still shown but struck, and only those
 * notes read (`alone`). Opened anywhere else, `struck` and `alone` are empty.
 */
export function startOf(within: string[], opts: { struck?: string[]; alone?: boolean; centre?: string; of?: string; pick?: Trail } = {}): { narrow: Narrow; struck: string[] } {
  const struck = normalizeTags(opts.struck || []).filter((tag) => !within.includes(tag));
  const narrow: Narrow = {
    only: [...within, ...struck],
    not: [],
    from: "",
    to: "",
    ...(opts.centre ? { centre: opts.centre } : {}),
    ...(opts.alone ? { alone: true } : {}),
    ...(opts.of ? { of: opts.of } : {}),
    ...(pickOf(opts.pick) ? { pick: pickOf(opts.pick)! } : {}),
  };
  return { narrow, struck };
}

/** A tag taken out of the narrowing, whichever way it narrowed. */
export function dropTag(narrow: Narrow, tag: string): Narrow {
  return { ...narrow, only: narrow.only.filter((x) => x !== tag), not: narrow.not.filter((x) => x !== tag) };
}

/** The day `months` before `today`, as a narrowing's `from`, in the person's own calendar. */
export function monthsBefore(months: number, today = new Date()): string {
  const day = new Date(today.getFullYear(), today.getMonth() - months, today.getDate());
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
