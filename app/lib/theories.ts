// [Filer, Writer]

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { type Lang, LANGUAGE_NAMES } from "@/lib/i18n";
import { isMnemo, normalizeTags } from "@/lib/note/filing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/**
 * What the app learns about the person, as theories: short sentences about
 * how they tag, or how one voice of theirs writes, each counted for and
 * against by the corrections they make. Not a trained model: the sentences
 * are read by filing and the writer like any instruction, and the person
 * sees and deletes them in Settings. Learning itself is
 * `lib/theories-learn.ts`; here, what it reads and the rules it keeps.
 */

/** Active theories one area keeps; past that, the weakest is retired. */
export const AREA_MAX = 20;
/** Corrections kept per area, newest first. */
export const EVIDENCE_KEPT = 20;
/** New corrections that start a learning run by themselves, paid by the app. */
export const LEARN_AFTER = 5;

export interface Theory {
  id: string;
  sentence: string;
  support: number;
  against: number;
  status: "active" | "retired";
  last_seen: string;
}

export type EvidenceKind = "tags" | "tag-skipped" | "piece";

/** One correction, as written. `voice_id` null is the tags area. */
export interface EvidenceRow {
  kind: EvidenceKind;
  note_id: string | null;
  before: string | null;
  after: string | null;
}

/** Read by filing or the writer: active, borne out at least twice, and more often than not. */
export function usable(theory: Pick<Theory, "status" | "support" | "against">): boolean {
  return theory.status === "active" && theory.support >= 2 && theory.support > theory.against;
}

/** The tag lists of one hand change, `mnemo-` tags left out (they are asked, never learned); null when nothing else changed. */
export function tagChange(before: string[] | null, after: string[] | null): Pick<EvidenceRow, "before" | "after"> | null {
  const was = normalizeTags(before || []).filter((t) => !isMnemo(t));
  const now = normalizeTags(after || []).filter((t) => !isMnemo(t));
  if (was.length === now.length && was.every((t) => now.includes(t))) return null;
  return { before: was.join(", "), after: now.join(", ") };
}

/** One area's rows: the voice's, or with none, the tags'. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inArea(query: any, voiceId: string | null): any {
  return voiceId ? query.eq("voice_id", voiceId) : query.is("voice_id", null);
}

/**
 * Writes the person's corrections in one area and keeps only the newest
 * `EVIDENCE_KEPT`. Never throws: a correction not remembered must not undo
 * the save it came from.
 */
export async function recordEvidence(admin: Admin, userId: string, voiceId: string | null, rows: EvidenceRow[]): Promise<void> {
  if (!rows.length) return;
  try {
    const { error } = await admin.from("theory_evidence").insert(rows.map((row) => ({ ...row, user_id: userId, voice_id: voiceId })));
    if (error) throw new Error(error.message);
    const { data: old } = await inArea(admin.from("theory_evidence").select("id").eq("user_id", userId), voiceId)
      .order("created_at", { ascending: false })
      .range(EVIDENCE_KEPT, EVIDENCE_KEPT + 999);
    const ids = ((old || []) as { id: string }[]).map((r) => r.id);
    if (ids.length) await admin.from("theory_evidence").delete().eq("user_id", userId).in("id", ids);
  } catch (err) {
    console.error("Correction not remembered (non-fatal):", err);
  }
}

/** One area's theories, the active ones first, strongest first. */
export async function theoriesOf(admin: Admin, userId: string, voiceId: string | null): Promise<Theory[]> {
  const { data, error } = await inArea(admin.from("theories").select("id, sentence, support, against, status, last_seen").eq("user_id", userId), voiceId);
  if (error) throw new Error(error.message);
  return ((data || []) as Theory[]).sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.support - b.against - (a.support - a.against));
}

/** The sentences filing or the writer reads: only usable ones. Never throws; none on a failure. */
export async function theoriesFor(admin: Admin, userId: string, voiceId: string | null): Promise<string[]> {
  try {
    return (await theoriesOf(admin, userId, voiceId)).filter(usable).map((t) => t.sentence);
  } catch (err) {
    console.error("Theories not read (non-fatal):", err);
    return [];
  }
}

/** Theories as a prompt reads them: nothing at all when there are none. */
export function theoryLines(heading: string, sentences: string[]): string {
  return sentences.length ? `${heading}\n${sentences.map((s) => `- ${s}`).join("\n")}` : "";
}

/** A learning reply as read: nothing in it trusted until `applyOps()`. */
export const LearnReply = z.object({
  ops: z.array(z.object({ op: z.unknown(), id: z.unknown().optional(), sentence: z.unknown().optional() })).catch([]),
});
export type Op = z.infer<typeof LearnReply>["ops"][number];

/** A theory's longest sentence, in characters. */
const SENTENCE_MAX = 300;

/**
 * What a learning reply changes. Only four operations exist: add (a new
 * sentence, counted once), strengthen and weaken (one more for or against),
 * retire. Anything else, an unknown id or a retired theory touched again is
 * dropped. `ids` maps the short ids the prompt showed to real ones. Past
 * `AREA_MAX` active, the weakest go: fewest for over against, then the
 * longest unseen, a theory just added before an old one at a tie.
 */
export function applyOps(theories: Theory[], ops: Op[], ids: Map<string, string>, now: string): { added: Omit<Theory, "id">[]; changed: Theory[] } {
  const byId = new Map(theories.map((t) => [t.id, { ...t }]));
  const touched = new Set<string>();
  const added: (Omit<Theory, "id"> & { id: string })[] = [];
  for (const op of ops) {
    const kind = String(op.op ?? "");
    if (kind === "add") {
      const sentence = String(op.sentence ?? "").trim().replace(/\s+/g, " ");
      if (!sentence || sentence.length > SENTENCE_MAX) continue;
      const same = (t: { sentence: string; status: string }) => t.status === "active" && t.sentence.toLowerCase() === sentence.toLowerCase();
      if ([...byId.values()].some(same) || added.some(same)) continue;
      added.push({ id: `new:${added.length}`, sentence, support: 1, against: 0, status: "active", last_seen: now });
      continue;
    }
    const theory = byId.get(ids.get(String(op.id ?? "")) ?? "");
    if (!theory || theory.status !== "active") continue;
    if (kind === "strengthen") theory.support += 1;
    else if (kind === "weaken") theory.against += 1;
    else if (kind === "retire") theory.status = "retired";
    else continue;
    theory.last_seen = now;
    touched.add(theory.id);
  }
  const active = [...[...byId.values()].filter((t) => t.status === "active"), ...added];
  const weakestFirst = active.sort(
    (a, b) => a.support - a.against - (b.support - b.against) || Number(b.id.startsWith("new:")) - Number(a.id.startsWith("new:")) || a.last_seen.localeCompare(b.last_seen)
  );
  for (const theory of weakestFirst.slice(0, Math.max(0, active.length - AREA_MAX))) {
    theory.status = "retired";
    if (!theory.id.startsWith("new:")) touched.add(theory.id);
  }
  return {
    added: added.filter((t) => t.status === "active").map((t) => ({ sentence: t.sentence, support: t.support, against: t.against, status: t.status, last_seen: t.last_seen })),
    changed: [...touched].map((id) => byId.get(id)!),
  };
}

/** A correction as the learning call reads it. */
export interface ShownEvidence {
  kind: EvidenceKind;
  /** The note's title and what it is about, for a tag correction. */
  note: string;
  before: string;
  after: string;
}

function shownEvidence(e: ShownEvidence, i: number): string {
  if (e.kind === "tags") return `--- Correction ${i + 1}: the person changed a note's tags by hand ---\nNote: ${e.note}\nTags before: ${e.before || "(none)"}\nTags after: ${e.after || "(none)"}`;
  if (e.kind === "tag-skipped") return `--- Correction ${i + 1}: the app suggested a tag and the person said no ---\nNote: ${e.note}\nIts tags: ${e.before || "(none)"}\nSuggested and refused: ${e.after}`;
  return `--- Correction ${i + 1}: a piece the app wrote in this voice, then as the author left it after editing ---\nAS THE APP WROTE IT:\n${e.before}\n\nAS THE AUTHOR LEFT IT:\n${e.after}`;
}

/**
 * The one learning call: the theories so far under short ids, the new
 * corrections, and only four operations to answer with.
 */
export function learnPrompt(p: { voice: boolean; lang: Lang; theories: { id: string; theory: Theory }[]; evidence: ShownEvidence[] }): string {
  const what = p.voice
    ? "how this author writes in one voice of theirs: their wording, rhythm, what they cut, add or soften, how they open and close. Never what a piece says."
    : "how this person tags their notes: which tags they put on what kind of note, which they never use for what, what a tag of theirs really means to them.";
  const listed = p.theories.length
    ? p.theories.map(({ id, theory }) => `${id}: ${theory.sentence} (borne out ${theory.support}, against ${theory.against})`).join("\n")
    : "(none yet)";
  return `You keep a short list of theories about ${what}

Each theory is one plain sentence a ${p.voice ? "writer" : "filing assistant"} can follow, in ${LANGUAGE_NAMES[p.lang]}. A theory is earned by corrections, never guessed: add one only when a correction below shows it, and never a theory about a single note's subject.

THEORIES SO FAR
${listed}

NEW CORRECTIONS
${p.evidence.map(shownEvidence).join("\n\n")}

For each correction: strengthen every theory it bears out, weaken every theory it goes against, add a theory it shows that none says yet, retire a theory now plainly wrong or saying the same as another. Nothing else.

Return JSON only: {"ops":[{"op":"add","sentence":"…"},{"op":"strengthen","id":"t1"},{"op":"weaken","id":"t2"},{"op":"retire","id":"t3"}]}`;
}
