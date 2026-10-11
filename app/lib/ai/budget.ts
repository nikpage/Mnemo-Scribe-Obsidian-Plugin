// [utils]

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CostContext } from "@/lib/ai/cost";
import { DEFAULT_SETTINGS, getAppSettings } from "@/lib/settings";
import { assertCredits } from "@/lib/billing/credits";

/**
 * The ceiling on what one account can spend in a day.
 *
 * Every paid call in this app is guarded at its own door - a claim, an owner
 * check, a button instead of an effect. This is what stands behind all of
 * them: whatever door is left open next, it can only be walked through until
 * the day's money is gone. It is not a budget the user manages and it is not
 * meant to be reached; a normal day of heavy use is cents.
 *
 * The ceiling, the stop-everything switch and per-account blocks are set on
 * /admin (`app_settings`, `account_controls`). `AI_DAILY_CAP_USD` is only
 * the ceiling before the settings row exists.
 */
const DEFAULT_CAP_USD = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The whole app's ceiling per 24 h, across every account: many accounts each
 * under their own ceiling can still add up to a bill. `AI_APP_DAILY_CAP_USD`,
 * else 50.
 */
export function appDailyCapUsd(): number {
  const parsed = Number(process.env.AI_APP_DAILY_CAP_USD);
  return process.env.AI_APP_DAILY_CAP_USD && Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
}

export class BudgetExceeded extends Error {
  constructor(spent: number, cap: number) {
    super(
      `Daily AI budget reached: $${spent.toFixed(2)} of $${cap.toFixed(2)} in the last 24h`
    );
    this.name = "BudgetExceeded";
  }
}

export class AccountPaused extends Error {
  constructor() {
    super("This account is paused. Contact the app's owner.");
    this.name = "AccountPaused";
  }
}

export class PaidAiOff extends Error {
  constructor() {
    super("AI is switched off for now. Your recording is saved.");
    this.name = "PaidAiOff";
  }
}

async function accountControl(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>
): Promise<{ status: string; daily_cap_usd: number | string | null } | null> {
  const { data, error } = await client
    .from("account_controls")
    .select("status, daily_cap_usd")
    .eq("user_id", userId)
    .maybeSingle();
  // Closed for the same reason as the spend: a block that cannot be read
  // cannot be assumed lifted.
  if (error) throw new Error(`Cannot read account controls: ${error.message}`);
  return data;
}

export function dailyCapUsd(): number {
  const raw = process.env.AI_DAILY_CAP_USD;
  if (raw === undefined || raw === "") return DEFAULT_CAP_USD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CAP_USD;
}

export async function spentToday(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin?: SupabaseClient<any, any, any>
): Promise<number> {
  const client = admin ?? createAdminClient();
  const { data, error } = await client.rpc("ai_spend_since", {
    uid: userId,
    since: new Date(Date.now() - DAY_MS).toISOString(),
  });

  // Failing closed on purpose. Not knowing what has been spent is exactly
  // the state a runaway loop produces, and every call this guards is
  // bracketed by writes to the same database - if it cannot be read, the
  // note was not going to be saved either.
  if (error) throw new Error(`Cannot read today's AI spend: ${error.message}`);

  return Number(data ?? 0);
}

/**
 * Called before any external call that costs money. Throws rather than
 * returning a flag: every caller here already treats a throw as "this part
 * of the note did not happen", which is the behaviour wanted.
 */
export async function assertBudget(
  ctx: CostContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin?: SupabaseClient<any, any, any>
): Promise<void> {
  const client = admin ?? createAdminClient();
  const [settings, control] = await Promise.all([getAppSettings(), accountControl(ctx.userId, client)]);

  if (settings.paidAiOff) throw new PaidAiOff();
  if (control?.status === "blocked") throw new AccountPaused();

  // A throttled account's own ceiling; otherwise the one set on /admin. The
  // env value only matters before the settings row exists.
  const cap =
    control?.status === "throttled" && control.daily_cap_usd !== null
      ? Number(control.daily_cap_usd)
      : settings === DEFAULT_SETTINGS
        ? dailyCapUsd()
        : settings.dailyCapUsd;
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { data: appSpent, error: appErr } = await client.rpc("ai_spend_total_since", { since });
  if (appErr) throw new Error(`Cannot read today's AI spend: ${appErr.message}`);
  if (Number(appSpent ?? 0) >= appDailyCapUsd()) {
    console.error(`AI app-wide stop: $${Number(appSpent).toFixed(4)} in 24h`);
    throw new PaidAiOff();
  }

  const spent = await spentToday(ctx.userId, client);

  if (spent >= cap) {
    console.error(
      `AI budget stop for ${ctx.userId}: $${spent.toFixed(4)} spent in 24h, cap $${cap}`
    );
    throw new BudgetExceeded(spent, cap);
  }

  // Last: the account's own money. Out of credits stops paid work, never
  // reading, search or export.
  await assertCredits(client, ctx.userId);
}
