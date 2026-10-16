// [Guru]


/**
 * What stops an angle before anyone sees it. No model: every rule here is a
 * string compare, a date or a vector already paid for, so a weak angle costs
 * nothing to throw away — and one that reached the screen would cost trust.
 *
 * Every threshold is here and nowhere else. They are first guesses on
 * gemini-embedding-001 (a reworded sentence scores ~0.9, two notes on one
 * subject ~0.75); each drop is logged with its score so they can be moved on
 * evidence.
 */
export const ANGLE_LIMITS = {
  /** A shorter "quote" is a phrase any note could contain, not a source. */
  minQuote: 12,
  /** Two notes at least this alike (best chunk pair) may be one thought twice… */
  twinSimilarity: 0.85,
  /** …when also recorded this close together… */
  twinDays: 14,
  // …and filed in the same folder. All three, or it is not a twin.
  /** A claim this close to one already shown only rewords it. */
  echoOfAngle: 0.9,
  /** A claim this close to a passage of a done or published note was already said. */
  echoOfSaid: 0.8,
} as const;

export const ANGLE_TYPES = ["contradiction", "change-of-mind", "cross-domain", "open-question"] as const;
export type AngleType = (typeof ANGLE_TYPES)[number];

export interface AngleCite {
  id: string;
  quote: string;
}

export interface DraftAngle {
  type: AngleType;
  claim: string;
  cites: AngleCite[];
}

export interface FilterNote {
  id: string;
  text: string;
  path: string;
  recordedAt: string;
}

/**
 * Text as a quote is compared: case, curly quotes, dashes and runs of
 * whitespace are how a faithful copy still differs from its source, so they
 * are levelled; words are not.
 */
export function levelled(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** The quote appears in the note, word for word. */
export function quoteFound(quote: string, text: string): boolean {
  const q = levelled(quote).replace(/^["']+|["']+$/g, "").trim();
  return q.length >= ANGLE_LIMITS.minQuote && levelled(text).includes(q);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const DAY = 86_400_000;

/** Two notes that are one thought recorded twice: alike and close in time. */
export function twins(a: FilterNote, b: FilterNote, similarity: number): boolean {
  return (
    similarity >= ANGLE_LIMITS.twinSimilarity &&
    Math.abs(new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()) <= ANGLE_LIMITS.twinDays * DAY
  );
}

/**
 * Why an angle cannot be shown on its own evidence, or null when it can.
 *
 * Twins are grouped transitively and an angle needs two groups: three notes
 * where two are one thought and the third differs still hold a tension; two
 * notes that are one thought hold only a likeness.
 */
export function evidenceFault(
  angle: DraftAngle,
  notes: Map<string, FilterNote>,
  similarity: (a: string, b: string) => number
): string | null {
  for (const cite of angle.cites) {
    const note = notes.get(cite.id);
    if (!note) return `cites ${cite.id}, which was not sent`;
    if (!quoteFound(cite.quote, note.text)) return `quote not in ${cite.id}: "${cite.quote.slice(0, 80)}"`;
  }

  const ids = [...new Set(angle.cites.map((c) => c.id))];
  if (ids.length < 2) return `cites ${ids.length} note${ids.length === 1 ? "" : "s"}`;

  const group = new Map(ids.map((id) => [id, id]));
  const root = (id: string): string => (group.get(id) === id ? id : root(group.get(id)!));
  const scores: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const s = similarity(ids[i], ids[j]);
      scores.push(s.toFixed(2));
      if (twins(notes.get(ids[i])!, notes.get(ids[j])!, s)) group.set(root(ids[j]), root(ids[i]));
    }
  }
  return new Set(ids.map(root)).size < 2 ? `notes too alike (similarity ${scores.join(", ")})` : null;
}

/**
 * Why a claim only repeats something, or null. `said` is the best score
 * against any passage of a done or published note; `before` are the claims
 * already shown, and the ones kept earlier in this same reply.
 */
export function echoFault(claim: number[], before: number[][], said: number): string | null {
  if (said >= ANGLE_LIMITS.echoOfSaid) return `already said in a finished note (${said.toFixed(2)})`;
  const nearest = Math.max(0, ...before.map((v) => cosine(claim, v)));
  return nearest >= ANGLE_LIMITS.echoOfAngle ? `rewords an angle already shown (${nearest.toFixed(2)})` : null;
}
