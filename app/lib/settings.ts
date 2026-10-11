// [utils]

import { createAdminClient } from "@/lib/supabase/admin";
import { TEXT_MODELS, type TextModel } from "@/lib/ai/cost";

export const TRANSCRIBERS = ["groq", "assemblyai", "speechmatics"] as const;
export type Transcriber = (typeof TRANSCRIBERS)[number];

/**
 * App-wide choices, changed by the owner on /admin instead of by a deploy.
 * One row in `app_settings`.
 */
export interface AppSettings {
  transcriber: Transcriber;
  standardModel: TextModel;
  synthesisModel: TextModel;
  dailyCapUsd: number;
  paidAiOff: boolean;
  /** Vonage unavailable: sign-up is by invite link only (`/api/admin/invites`). */
  smsOff: boolean;
}

// What the app ran on before the settings row existed, and what a missing
// row still means.
export const DEFAULT_SETTINGS: AppSettings = {
  transcriber: "groq",
  standardModel: "gemini-3.1-flash-lite",
  synthesisModel: "gemini-3.8-flash",
  dailyCapUsd: 5,
  paidAiOff: false,
  smsOff: false,
};

// Read on every paid call, so held for a minute: a change on /admin reaches
// every running function within that.
const TTL_MS = 60_000;
let cached: { at: number; value: AppSettings } | null = null;

export function forgetSettings() {
  cached = null;
}

export async function getAppSettings(): Promise<AppSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const { data, error } = await createAdminClient()
    .from("app_settings")
    .select("transcriber, standard_model, synthesis_model, daily_cap_usd, paid_ai_off, sms_off")
    .eq("id", 1)
    .maybeSingle();

  // Failing closed, as the budget does: if the kill switch cannot be read,
  // it cannot be trusted to be off.
  if (error) throw new Error(`Cannot read app settings: ${error.message}`);

  const value = data ? fromRow(data) : DEFAULT_SETTINGS;
  cached = { at: Date.now(), value };
  return value;
}

// A value the code no longer knows (a model since removed from cost.ts)
// falls back to the default rather than billing at an unknown price.
function fromRow(row: {
  transcriber: string;
  standard_model: string;
  synthesis_model: string;
  daily_cap_usd: number | string;
  paid_ai_off: boolean;
  sms_off?: boolean;
}): AppSettings {
  const model = (m: string, fallback: TextModel) =>
    (TEXT_MODELS as readonly string[]).includes(m) ? (m as TextModel) : fallback;
  const cap = Number(row.daily_cap_usd);
  return {
    transcriber: (TRANSCRIBERS as readonly string[]).includes(row.transcriber)
      ? (row.transcriber as Transcriber)
      : DEFAULT_SETTINGS.transcriber,
    standardModel: model(row.standard_model, DEFAULT_SETTINGS.standardModel),
    synthesisModel: model(row.synthesis_model, DEFAULT_SETTINGS.synthesisModel),
    dailyCapUsd: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_SETTINGS.dailyCapUsd,
    paidAiOff: Boolean(row.paid_ai_off),
    smsOff: Boolean(row.sms_off),
  };
}
