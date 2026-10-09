// [Guru]

import type { Lang } from "@/lib/i18n";
import { formatFactDate } from "@/lib/format";

/** A fact found by a search, with the note it came from. */
export interface FactHit {
  id: string;
  recordingId: string;
  noteLabel: string;
  notePath: string;
  subject: string;
  variable: string;
  valueText: string;
  unit: string | null;
  happenedOn: string | null;
  saidOn: string | null;
  saidAt: number | null;
  quote: string;
}

/**
 * Labels that name a kind of measurement rather than what was measured. "12
 * or 15" means something as an age; as a "count" it is a random number, and
 * "percentage" only repeats the % already in the value. Facts read before the
 * prompt forbade these still carry them.
 */
const GENERIC = new Set([
  "count", "number", "percentage", "percent", "value", "amount", "total", "quantity",
  "počet", "číslo", "procento", "procenta", "hodnota", "množství", "celkem",
]);

/**
 * What goes between a fact's subject and its value: the property and the
 * date, each only when it says something the value does not.
 * "age · " for "me: age · 12 or 15", nothing for "israel: 1948".
 */
export function factMeta(
  fact: { subject: string; variable: string; valueText: string; happenedOn: string | null },
  lang: Lang
): string {
  const parts: string[] = [];
  const variable = fact.variable.trim();
  if (variable && !GENERIC.has(variable.toLowerCase()) && variable.toLowerCase() !== fact.subject.toLowerCase()) {
    parts.push(variable);
  }
  if (fact.happenedOn && !fact.valueText.includes(fact.happenedOn)) {
    parts.push(formatFactDate(fact.happenedOn, lang));
  }
  return parts.length ? `${parts.join(" · ")} · ` : "";
}
