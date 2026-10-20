// [utils]

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What each provider charges, in US dollars.
 *
 * These are list prices, kept in one place so a repricing is one edit. They
 * are not fetched from anywhere — check them against the provider's pricing
 * page before trusting a total to the cent.
 */
const RATES = {
  // Gemini text models, per 1M tokens in / out. Checked 2026-09-24.
  // `cached` is a token read from the cache Google applies by itself.
  // Flash-lite's is 10% of input, not checked.
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cached: 0.025, context: 1_048_576 },
  // Reserved for the calls whose output is the product: the written answer,
  // the weekly report, themes and Brain readings. Promotional until 31 Dec 2026;
  // `from` is the list price, applied by itself to every call from that day.
  // Cache rate checked 2026-09-30.
  "gemini-3.8-flash": {
    input: 0.75,
    output: 3.75,
    cached: 0.075,
    context: 1_048_576,
    from: { day: "2027-01-01", input: 1.5, output: 7.5, cached: 0.15 },
  },
  // Embeddings, per 1M input tokens. No output side.
  "gemini-embedding-001": { input: 0.15, output: 0, cached: 0, context: 2_048 },
} as const;

/**
 * Transcription is billed by audio time, per hour.
 *
 * AssemblyAI, checked 2026-09-24: Universal-2 is $0.15/hr and speaker
 * diarization adds $0.02/hr, which this app buys on every note — see
 * `transcription/assemblyai.ts`. The $0.27 sitting here before was stale and
 * overstated every note by more than half again.
 *
 * Speechmatics has not been re-checked; it is not the configured provider.
 */
const AUDIO_RATES = {
  assemblyai: 0.17,
  speechmatics: 1.04,
  // whisper-large-v3-turbo on Groq's free tier, checked 2026-09-25: no
  // charge, capped instead at 20 requests a minute and 28,800 seconds of
  // audio a day. A row is still written, so the count of notes transcribed
  // stays complete and a move onto a paid tier is one number here.
  groq: 0,
} as const;

/** The text models this app is allowed to call, and their prices. */
export type TextModel = keyof typeof RATES;

/** The models /admin may choose between for writing text; embeddings excluded. */
export const TEXT_MODELS = ["gemini-3.1-flash-lite", "gemini-3.8-flash"] as const satisfies readonly TextModel[];

export type Operation =
  | "transcription"
  | "analysis"
  | "subject"
  | "tags"
  | "tag-parents"
  | "tag-check"
  | "tag-plan"
  | "publish"
  | "index"
  | "search"
  | "answer"
  | "subject-match"
  | "extract"
  | "facts"
  | "links"
  | "series"
  | "insights"
  | "themes"
  | "what-next"
  | "writing"
  | "theories";

/** The user a call is billed to, and the note it belongs to when there is one. */
export interface CostContext {
  userId: string;
  recordingId?: string;
}

type Prices = { input: number; output: number; cached: number };
type Rate = Prices & { long?: { over: number; input: number; output: number; cached: number }; from?: Prices & { day: string } };

/** A model's prices on the day of the call: a promotion ends by itself on its `from` day (UTC). */
function pricesOn(model: keyof typeof RATES, at: Date): Rate {
  const base: Rate = RATES[model];
  return base.from && at.toISOString().slice(0, 10) >= base.from.day ? { ...base, ...base.from, long: undefined } : base;
}

/**
 * What one call costs. `cached` is the part of `input` read from a cache,
 * which Gemini counts inside the prompt total and bills at its own rate.
 */
export function tokenCost(model: keyof typeof RATES, input: number, output: number, cached = 0, at = new Date()): number {
  const base = pricesOn(model, at);
  const rate = base.long && input > base.long.over ? base.long : base;
  return ((input - cached) * rate.input + cached * rate.cached + output * rate.output) / 1_000_000;
}

/**
 * What reading `read` and writing `wrote` tokens on `model` costs, counted in
 * tokens read by `as` on the day: how steps on different models are priced
 * in one unit.
 */
export function asReadTokens(model: keyof typeof RATES, read: number, wrote: number, as: keyof typeof RATES, at = new Date()): number {
  const rate = pricesOn(model, at);
  return (read * rate.input + wrote * rate.output) / pricesOn(as, at).input;
}

/** How many tokens the model reads in one call. */
export function contextTokens(model: keyof typeof RATES): number {
  return RATES[model].context;
}

/**
 * What one call spent, as the owner sees it under a reading or an answer:
 * dollars at today's prices, tokens read and written (thinking included).
 */
export type Spent = { costUsd: number; readTokens: number; wroteTokens: number };

/** Null when the model has no price here: an accounting gap, never a lost reading. */
export function spentOf(usage: { model: keyof typeof RATES; promptTokens: number; outputTokens: number; cachedTokens: number }): Spent | null {
  if (!RATES[usage.model]) return null;
  return {
    costUsd: tokenCost(usage.model, usage.promptTokens, usage.outputTokens, usage.cachedTokens),
    readTokens: usage.promptTokens,
    wroteTokens: usage.outputTokens,
  };
}

/**
 * Records what one call cost. Never throws and never blocks: a missing cost
 * row is an accounting gap, not a lost note.
 */
async function write(row: {
  ctx: CostContext;
  operation: Operation;
  provider: string;
  model: string;
  input: number;
  output: number;
  unit: "tokens" | "seconds";
  cost: number;
  providerRef?: string;
}) {
  try {
    await createAdminClient().from("ai_costs").insert({
      user_id: row.ctx.userId,
      recording_id: row.ctx.recordingId ?? null,
      operation: row.operation,
      provider: row.provider,
      model: row.model,
      input_units: Math.round(row.input),
      output_units: Math.round(row.output),
      unit: row.unit,
      cost_usd: row.cost,
      ...(row.providerRef ? { provider_ref: row.providerRef } : {}),
    });
  } catch (err) {
    console.error("Cost not recorded (non-fatal):", err);
  }
}

/** The token counts the SDK reports for one call. */
export type ReportedTokens =
  | {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      cachedContentTokenCount?: number;
      thoughtsTokenCount?: number;
    }
  | undefined;

/**
 * A Gemini text call, priced from the token counts the SDK reports. Cached
 * tokens are part of the prompt count and priced at the cache rate.
 * Thinking is billed as output but reported apart from it; leaving it out
 * under-counted every thinking call and let the ceiling run late.
 */
export function callCost(model: keyof typeof RATES, usage: ReportedTokens) {
  const input = usage?.promptTokenCount ?? 0;
  const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  const cached = Math.min(usage?.cachedContentTokenCount ?? 0, input);
  return { input, output, cost: tokenCost(model, input, output, cached) };
}

/** Records one Gemini text call, priced by `callCost()`. */
export async function recordTokenCost(ctx: CostContext, operation: Operation, model: keyof typeof RATES, usage: ReportedTokens) {
  await write({ ctx, operation, provider: "google", model, unit: "tokens", ...callCost(model, usage) });
}

/**
 * An embedding call. The REST endpoint returns no token count, so input is
 * estimated at the usual four characters per token — the sums are fractions
 * of a cent either way.
 */
export function embeddingCost(characters: number) {
  const input = Math.ceil(characters / 4);
  return { input, output: 0, cost: tokenCost("gemini-embedding-001", input, 0) };
}

/** Records one embedding call, priced by `embeddingCost()`. */
export async function recordEmbeddingCost(ctx: CostContext, operation: Operation, characters: number) {
  await write({ ctx, operation, provider: "google", model: "gemini-embedding-001", unit: "tokens", ...embeddingCost(characters) });
}

/** A transcription, priced on the length of the audio. */
export async function recordAudioCost(
  ctx: CostContext,
  provider: keyof typeof AUDIO_RATES,
  seconds: number,
  /** The provider's id for the job, to look it up in their dashboard. */
  providerRef?: string
) {
  await write({
    providerRef,
    ctx,
    operation: "transcription",
    provider,
    model: provider,
    input: seconds,
    output: 0,
    unit: "seconds",
    cost: (seconds / 3600) * AUDIO_RATES[provider],
  });
}
