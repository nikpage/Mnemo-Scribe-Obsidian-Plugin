// [utils]

import { type GenerationConfig, GoogleGenerativeAI, type Part, type ResponseSchema, type UsageMetadata } from "@google/generative-ai";
import type { z } from "zod";
import { assertBudget } from "@/lib/ai/budget";
import { type CostContext, type Operation, type TextModel, recordTokenCost } from "@/lib/ai/cost";
import { type AppSettings, DEFAULT_SETTINGS, getAppSettings } from "@/lib/settings";

/** The reply-shape types, so a caller describes its JSON without touching the SDK. */
export { SchemaType, type ResponseSchema } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * Every Gemini text call in this app goes through here.
 *
 * Not for tidiness: the budget check and the cost row are the two things
 * that must never be forgotten at a call site, and the only way to be sure
 * of that is for there to be one call site. Adding a new kind of call means
 * calling this, and a call that skips it is visible as a direct use of the
 * SDK anywhere outside this file.
 *
 * The budget is asked first, before a token is sent, so a runaway caller is
 * stopped rather than merely recorded. It throws; every caller in this
 * codebase already treats a throw as "this part of the note did not happen".
 */
export async function generate(opts: {
  model: TextModel;
  operation: Operation;
  ctx: CostContext;
  parts: (string | Part)[];
  /**
   * Ask for JSON and nothing else. The model then returns bare JSON — no
   * fences, no commentary — so the reply is read with `readJson()` instead
   * of being cut out of prose by hand.
   */
  json?: boolean;
  /**
   * The JSON's shape, enforced by Google: a field marked required is always
   * there. Implies `json`.
   */
  schema?: ResponseSchema;
  /**
   * How long the model may think before it answers. Unset is Google's
   * default (medium on 3.8 Flash). Thinking is billed as output and is
   * the likeliest cause of a minutes-long call, so a caller that needs
   * speed names it; the timing line below says whether it mattered.
   */
  thinking?: "low" | "medium" | "high";
  /**
   * The person chose this model for this call: it runs as named, not as
   * whatever /admin puts its tier on, so it costs what they were shown.
   */
  exact?: boolean;
}): Promise<string> {
  const { text } = await generateWithUsage(opts);
  return text;
}

/** What a call reported about itself: what was read, cached and written. */
export interface Usage {
  model: TextModel;
  promptTokens: number;
  cachedTokens: number;
  /** Everything billed as output: the answer plus the thinking. */
  outputTokens: number;
  /** The thinking part of `outputTokens`. */
  thoughtTokens: number;
  /** From sending to the first word of the answer: reading plus thinking. */
  firstTokenMs: number;
  /** From sending to the last word. */
  totalMs: number;
}

/**
 * How many tokens `parts` are to `model`, counted by Google's own tokenizer:
 * exact in every language (Czech runs far more tokens per character than
 * English) and free — no budget, no cost row. Prices a press before it runs.
 */
export async function countTokens(model: TextModel, parts: (string | Part)[], exact = false): Promise<number> {
  const chosen = runsOn(model, await getAppSettings(), exact);
  const { totalTokens } = await genAI.getGenerativeModel({ model: chosen }).countTokens(parts);
  return totalTokens;
}

/** `generate()`, with the token counts it was billed on. */
export async function generateWithUsage(opts: Parameters<typeof generate>[0]): Promise<{ text: string; usage: Usage }> {
  await assertBudget(opts.ctx);

  const chosen = runsOn(opts.model, await getAppSettings(), opts.exact);
  // `thinkingConfig` is newer than this SDK's types; the SDK sends the
  // config as it is given.
  const config = {
    ...(opts.json || opts.schema ? { responseMimeType: "application/json" } : {}),
    ...(opts.schema ? { responseSchema: opts.schema } : {}),
    ...(opts.thinking ? { thinkingConfig: { thinkingLevel: opts.thinking } } : {}),
  } as GenerationConfig;
  const generationConfig = Object.keys(config).length ? { generationConfig: config } : {};

  const model = genAI.getGenerativeModel({ model: chosen, ...generationConfig });
  // Streamed only to time it: the first chunk arrives once the model has
  // read and thought, the rest is writing. Thinking is not streamed, so
  // reading and thinking cannot be told apart by time — the thought count
  // says which it was.
  const started = Date.now();
  const result = await model.generateContentStream(opts.parts);
  await result.stream[Symbol.asyncIterator]().next();
  const firstTokenMs = Date.now() - started;
  const response = await result.response;
  const totalMs = Date.now() - started;
  const usage = response.usageMetadata as ReportedUsage | undefined;
  const thoughtTokens = usage?.thoughtsTokenCount ?? 0;
  const outputTokens = (usage?.candidatesTokenCount ?? 0) + thoughtTokens;

  console.log(
    `[gemini] ${opts.operation} ${chosen}${opts.thinking ? ` thinking=${opts.thinking}` : ""}: ` +
      `read ${usage?.promptTokenCount ?? 0} (cached ${usage?.cachedContentTokenCount ?? 0}), ` +
      `thought ${thoughtTokens}, wrote ${usage?.candidatesTokenCount ?? 0}; ` +
      `first word ${(firstTokenMs / 1000).toFixed(1)}s, done ${(totalMs / 1000).toFixed(1)}s`
  );

  await recordTokenCost(opts.ctx, opts.operation, chosen, usage);

  const refused = declineReason(response);
  if (refused) throw new AiDeclined(refused);

  return {
    text: response.text(),
    usage: {
      model: chosen,
      promptTokens: usage?.promptTokenCount ?? 0,
      cachedTokens: usage?.cachedContentTokenCount ?? 0,
      outputTokens,
      thoughtTokens,
      firstTokenMs,
      totalMs,
    },
  };
}

/** The SDK's usage, plus the thinking count its types predate. */
type ReportedUsage = UsageMetadata & { thoughtsTokenCount?: number };

/**
 * Google read the text and would not answer — explicit sex, most often.
 *
 * Named, because it is not a failure to retry: the same text is refused
 * again, and paid for again. A caller that sees this marks the note and
 * moves on; the cost row is already written, since the prompt was billed.
 */
export class AiDeclined extends Error {
  constructor(readonly reason: string) {
    super(`The AI declined this text (${reason})`);
    this.name = "AiDeclined";
  }
}

/** The finishes that mean "would not", as opposed to "ran out" or "done". */
const REFUSALS = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]);

function declineReason(response: {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string }[];
}): string | null {
  // Any block of the prompt itself, including reasons newer than this SDK.
  if (response.promptFeedback?.blockReason) return response.promptFeedback.blockReason;
  const finish = response.candidates?.[0]?.finishReason;
  return finish && REFUSALS.has(finish) ? finish : null;
}

/**
 * A call site names the default model of its tier; /admin decides what that
 * tier actually runs on. The synthesis default stands for the answer, report
 * and themes; anything else is an everyday call.
 */
export function resolveModel(asked: TextModel, settings: AppSettings): TextModel {
  return asked === DEFAULT_SETTINGS.synthesisModel ? settings.synthesisModel : settings.standardModel;
}

/** The model a call runs on: the one the person chose, as named; otherwise its tier's. */
export function runsOn(asked: TextModel, settings: AppSettings, exact = false): TextModel {
  return exact ? asked : resolveModel(asked, settings);
}

/**
 * A JSON reply, checked against the shape the caller expects. Null when the
 * reply is not JSON or not that shape: every caller already treats an
 * unreadable reply as "nothing found".
 */
export function readJson<S extends z.ZodType>(text: string, schema: S): z.infer<S> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
