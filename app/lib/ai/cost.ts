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
  // `cached` is a token read from a context cache (explicit, or the implicit
  // reuse Google applies by itself); `storage` is per 1M cached tokens per
  // hour held. Flash-lite's two are 10% and the flash rate, not checked:
  // this app never caches on it explicitly.
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cached: 0.025, storage: 1.0, context: 1_048_576 },
  // Reserved for the calls whose output is the product: the written answer,
  // the weekly report, themes and angles. Promotional until 31 Dec 2026;
  // `from` is the list price, applied by itself to every call from that day.
  // Cache rates checked 2026-09-30 (0.075 read, 0.50/h).
  "gemini-3.8-flash": {
    input: 0.75,
    output: 3.75,
    cached: 0.075,
    storage: 0.5,
    context: 1_048_576,
    from: { day: "2027-01-01", input: 1.5, output: 7.5, cached: 0.15, storage: 1.0 },
  },
  // Embeddings, per 1M input tokens. No output side.
  "gemini-embedding-001": { input: 0.15, output: 0, cached: 0, storage: 0, context: 2_048 },
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
  | "angles"
  | "what-next";

/** The user a call is billed to, and the note it belongs to when there is one. */
export interface CostContext {
  userId: string;
  recordingId?: string;
}

type Prices = { input: number; output: number; cached: number; storage: number };
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

/** Holding `tokens` in a context cache for `seconds`. */
export function storageCost(model: keyof typeof RATES, tokens: number, seconds: number, at = new Date()): number {
  return (tokens / 1_000_000) * pricesOn(model, at).storage * (seconds / 3600);
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

/**
 * A Gemini text call, priced from the token counts the SDK reports. Cached
 * tokens are part of the prompt count and priced at the cache rate.
 * Thinking is billed as output but reported apart from it; leaving it out
 * under-counted every thinking call and let the ceiling run late.
 */
export async function recordTokenCost(
  ctx: CostContext,
  operation: Operation,
  model: keyof typeof RATES,
  usage:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
        thoughtsTokenCount?: number;
      }
    | undefined
) {
  const input = usage?.promptTokenCount ?? 0;
  const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  const cached = Math.min(usage?.cachedContentTokenCount ?? 0, input);
  await write({
    ctx,
    operation,
    provider: "google",
    model,
    input,
    output,
    unit: "tokens",
    cost: tokenCost(model, input, output, cached),
  });
}

/**
 * Putting text into a context cache: the tokens written, priced at the full
 * input rate, plus holding them for the cache's whole life, paid up front.
 * Google may bill the write lower; a ceiling that fails closed would rather
 * over-count.
 */
export async function recordCacheCost(
  ctx: CostContext,
  operation: Operation,
  model: keyof typeof RATES,
  tokens: number,
  ttlSeconds: number
) {
  await write({
    ctx,
    operation,
    provider: "google",
    model,
    input: tokens,
    output: 0,
    unit: "tokens",
    cost: tokenCost(model, tokens, 0) + storageCost(model, tokens, ttlSeconds),
  });
}

/**
 * An embedding call. The REST endpoint returns no token count, so input is
 * estimated at the usual four characters per token — the sums are fractions
 * of a cent either way.
 */
export async function recordEmbeddingCost(
  ctx: CostContext,
  operation: Operation,
  characters: number
) {
  const model = "gemini-embedding-001";
  const input = Math.ceil(characters / 4);
  await write({
    ctx,
    operation,
    provider: "google",
    model,
    input,
    output: 0,
    unit: "tokens",
    cost: tokenCost(model, input, 0),
  });
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
