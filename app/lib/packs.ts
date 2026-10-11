// [Guru]

/**
 * Trade packs: the names and units a trade measures, so that "one twenty
 * over eighty" in a doctor's note lands as the same series every time.
 *
 * Defined here and nowhere else. A user picks a pack and can switch items
 * off; they never author one, because a pack is a promise that two notes
 * name the same number the same way.
 */

type Words = { en: string; cs: string };

export interface WatchItem {
  key: string;
  /** Null when the subject is the thing named — the drug, the exercise. */
  subject: Words | null;
  variable: Words;
  unit: string;
  /** What a speaker or model might write instead of `unit`. */
  unitAliases: string[];
  /** What to say so the number lands here — shown as the user's instructions. */
  example: Words;
}

export interface Pack {
  id: string;
  clientWord: Words;
  /**
   * One word per language that, said first, makes a note a client note:
   * "Patient Jan Novák, …". Both languages are heard whatever the UI is in.
   * Unambiguous only because an account holds one pack (LATER.md).
   */
  keyword: Words;
  items: WatchItem[];
}

export function validatePack(pack: Pack): Pack {
  for (const item of pack.items) {
    if (!item.unit.trim()) throw new Error(`${pack.id}.${item.key}: no unit`);
    if (!item.variable.en.trim() || !item.variable.cs.trim()) {
      throw new Error(`${pack.id}.${item.key}: no name`);
    }
    if (!item.example.en.trim() || !item.example.cs.trim()) {
      throw new Error(`${pack.id}.${item.key}: no example`);
    }
    if (item.subject && (!item.subject.en.trim() || !item.subject.cs.trim())) {
      throw new Error(`${pack.id}.${item.key}: no name`);
    }
  }
  return pack;
}

const KG = ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramů", "kila"];

export const PACKS: Pack[] = [
  validatePack({
    id: "doctor",
    clientWord: { en: "Patients", cs: "Pacienti" },
    keyword: { en: "patient", cs: "pacient" },
    items: [
      {
        key: "dose",
        subject: null,
        variable: { en: "dose", cs: "dávka" },
        unit: "mg",
        example: { en: "ibuprofen 400 mg", cs: "ibuprofen 400 mg" },
        unitAliases: ["milligram", "milligrams", "miligram", "miligramů", "miligramy"],
      },
      {
        key: "systolic",
        subject: { en: "blood pressure", cs: "krevní tlak" },
        variable: { en: "systolic", cs: "systolický" },
        unit: "mmHg",
        example: { en: "blood pressure 120 over 80", cs: "tlak 120 na 80" },
        unitAliases: ["mmhg", "mm hg", "millimetres of mercury", "milimetrů rtuti"],
      },
      {
        key: "diastolic",
        subject: { en: "blood pressure", cs: "krevní tlak" },
        variable: { en: "diastolic", cs: "diastolický" },
        unit: "mmHg",
        example: { en: "blood pressure 120 over 80", cs: "tlak 120 na 80" },
        unitAliases: ["mmhg", "mm hg", "millimetres of mercury", "milimetrů rtuti"],
      },
      {
        key: "weight",
        subject: null,
        variable: { en: "weight", cs: "hmotnost" },
        unit: "kg",
        example: { en: "weight 82 kilos", cs: "váha 82 kilo" },
        unitAliases: KG,
      },
    ],
  }),
  validatePack({
    id: "trainer",
    clientWord: { en: "Clients", cs: "Klienti" },
    keyword: { en: "client", cs: "klient" },
    items: [
      {
        key: "weight",
        subject: null,
        variable: { en: "weight", cs: "hmotnost" },
        unit: "kg",
        example: { en: "weight 82 kilos", cs: "váha 82 kilo" },
        unitAliases: KG,
      },
      {
        key: "reps",
        subject: null,
        variable: { en: "reps", cs: "opakování" },
        unit: "reps",
        example: { en: "bench press 12 reps", cs: "bench 12 opakování" },
        unitAliases: ["rep", "repetition", "repetitions", "opakování", "x"],
      },
      {
        key: "resting-hr",
        subject: { en: "resting heart rate", cs: "klidový tep" },
        variable: { en: "rate", cs: "frekvence" },
        unit: "bpm",
        example: { en: "resting heart rate 58", cs: "klidový tep 58" },
        unitAliases: ["beats per minute", "beats/min", "tepů za minutu", "tepů"],
      },
    ],
  }),
];

export function findPack(id: string | null | undefined): Pack | null {
  return PACKS.find((p) => p.id === id) ?? null;
}

/** The spoken phrases that make a pack work, one per watched number. */
export function guideExamples(pack: Pack, lang: "en" | "cs", off: string[] = []): string[] {
  const seen = new Set<string>();
  for (const item of pack.items) if (!off.includes(item.key)) seen.add(item.example[lang]);
  return [...seen];
}
