// [Writer]

import { z } from "zod";
import type { TEXT_MODELS } from "@/lib/ai/cost";

/** A piece's outline: what the person reads, changes and approves before a word of prose. */
export const Outline = z.object({
  title: z.string().trim().min(1).max(200),
  sections: z
    .array(z.object({ heading: z.string().trim().min(1).max(300), says: z.string().trim().min(1).max(4000), words: z.number().int().min(30).max(20_000) }))
    .min(1)
    .max(30),
});
export type Outline = z.infer<typeof Outline>;

/** The most opening words the person may give. */
export const OPENING_MAX = 4000;

/** The steps a piece is written in, each on a model of the person's choosing. */
export const STEPS = ["outline", "write", "edit"] as const;
export type Step = (typeof STEPS)[number];

/**
 * The models a step may run on: the text models of `cost.ts`, named here so
 * the screen can list them without reaching the server's code.
 */
export const WRITING_MODELS = ["gemini-3.8-flash", "gemini-3.1-flash-lite"] as const satisfies readonly (typeof TEXT_MODELS)[number][];
export type WritingModel = (typeof WRITING_MODELS)[number];

/**
 * Each step's model until the person picks another. 3.8 Flash everywhere
 * until the voice test of phase 4 shows a step holds up on a cheaper one.
 */
export const DEFAULT_MODELS: Record<Step, WritingModel> = { outline: "gemini-3.8-flash", write: "gemini-3.8-flash", edit: "gemini-3.8-flash" };

/** A model chosen per step; a step left out keeps the one it had, or its default. */
export const Models = z.object({ outline: z.enum(WRITING_MODELS).optional(), write: z.enum(WRITING_MODELS).optional(), edit: z.enum(WRITING_MODELS).optional() });
export type Models = z.infer<typeof Models>;

/** Every step's model: what was asked, over what the piece had, over the defaults. Anything unknown is dropped. */
export function modelsOf(...layers: (unknown | null | undefined)[]): Record<Step, WritingModel> {
  const known = (m: unknown): m is WritingModel => (WRITING_MODELS as readonly unknown[]).includes(m);
  const out = { ...DEFAULT_MODELS };
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    for (const step of STEPS) {
      const m = (layer as Record<string, unknown>)[step];
      if (known(m)) out[step] = m;
    }
  }
  return out;
}
