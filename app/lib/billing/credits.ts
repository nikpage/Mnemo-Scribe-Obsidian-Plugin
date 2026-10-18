// [utils]

import type { SupabaseClient } from "@supabase/supabase-js";
import { planOf } from "@/lib/billing/entitlements";

/**
 * Credits: what a person pays for AI with.
 *
 * One append-only ledger (`credit_ledger`, `056`): grants positive, spends
 * negative, the balance is the sum. Every row carries a `ref` unique per
 * account — the note, the reading, the Stripe event — so a retry, a second
 * webhook or a re-run writes nothing the second time.
 *
 * What an action costs lives in `credit_rates`, not here, so a price change
 * is a row edit. A spend is taken after the work is done and may take the
 * balance below zero by one action; the check before the work
 * (`assertBudget()`) stops the next one.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/**
 * `reading` (What next and Elaborate), `ask` and `import` are priced by tokens
 * read and quoted before the press; the person pays exactly the quote. `write`
 * (a piece, `lib/writing/piece.ts`) the same, its writing counted in.
 *
 * A credit buys tokens of ONE model (`gemini-3.8-flash`). If people ever
 * choose their model (not planned), a token stops being one price: tokenizers
 * and rates differ by model, so charging per token would overcharge on a cheap
 * model and lose money on a dear one. Charge then in a common unit, the
 * call's real dollar cost times one markup, before offering the choice.
 */
export type Spend = "record" | "import" | "reading" | "ask" | "write";

/**
 * The least a reading or an Ask takes: it covers the first 20,000 tokens read
 * and the few thousand the model writes, billed at five times the input rate.
 */
export const READ_MINIMUM = 2;

export class OutOfCredits extends Error {
  constructor() {
    super("Out of credits. Top up to keep going.");
    this.name = "OutOfCredits";
  }
}

/** Credits for `units` at a rate: `credits` per `per` units, rounded up. */
export function creditsFor(rate: { credits: number | string; per: number | string }, units: number): number {
  if (!(units > 0)) return 0;
  return Math.ceil((units / Number(rate.per)) * Number(rate.credits));
}

export async function creditBalance(admin: Admin, userId: string): Promise<number> {
  const { data, error } = await admin.rpc("credit_balance", { uid: userId });
  // Closed, like the spend: a balance that cannot be read is not assumed.
  if (error) throw new Error(`Cannot read credits: ${error.message}`);
  return Number(data ?? 0);
}

/**
 * Adds credits once per `ref`. True when added, false when that ref was
 * already granted; throws on anything else, so a webhook is retried.
 */
export async function grantCredits(admin: Admin, userId: string, credits: number, reason: string, ref: string): Promise<boolean> {
  if (!Number.isInteger(credits) || credits === 0) throw new Error(`Not a grant: ${credits}`);
  const { error } = await admin.from("credit_ledger").insert({ user_id: userId, delta: credits, reason, ref });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`Granting credits failed: ${error.message}`);
}

/**
 * Takes what `units` of `operation` cost, once per `ref`. Never throws: the
 * work is already done and paid for, and losing a charge must not lose the
 * note. Returns the credits taken (0 for a repeat or a failure).
 */
export async function spendCredits(admin: Admin, userId: string, operation: Spend, units: number, ref: string): Promise<number> {
  try {
    if (!(await paysInCredits(admin, userId))) return 0;
    return await chargeCredits(admin, userId, operation, await priceOf(admin, operation, units), ref);
  } catch (err) {
    console.error(`Charging ${operation} ${ref} failed (non-fatal):`, err);
    return 0;
  }
}

/** What `units` of `operation` cost at today's rate. Throws when the rate is missing. */
export async function priceOf(admin: Admin, operation: Spend, units: number): Promise<number> {
  const { data: rate, error } = await admin.from("credit_rates").select("credits, per").eq("operation", operation).maybeSingle();
  if (error) throw new Error(error.message);
  if (!rate) throw new Error(`No credit rate for ${operation}`);
  // PRICING.md: a recording pays its rate for the first 15 minutes, 1 credit for the second.
  if (operation === "record") return units > 0 ? Number(rate.credits) + Math.ceil(units / Number(rate.per)) - 1 : 0;
  if (operation === "reading" || operation === "ask" || operation === "write") return Math.max(READ_MINIMUM, creditsFor(rate, units));
  return creditsFor(rate, units);
}

/**
 * Takes a set number of credits — the quote the person saw — once per `ref`.
 * Never throws, as `spendCredits()`. An own-key account pays nothing.
 */
export async function chargeCredits(admin: Admin, userId: string, operation: Spend, credits: number, ref: string): Promise<number> {
  try {
    if (!(credits > 0) || !(await paysInCredits(admin, userId))) return 0;
    const { error } = await admin
      .from("credit_ledger")
      .insert({ user_id: userId, delta: -credits, reason: operation, ref: `${operation}:${ref}` });
    if (!error) return credits;
    if (error.code !== "23505") throw new Error(error.message);
    return 0;
  } catch (err) {
    console.error(`Charging ${operation} ${ref} failed (non-fatal):`, err);
    return 0;
  }
}

/**
 * A press's price before it is pressed: the credits it will take (0 on an
 * own-key plan) and the balance they come from.
 */
export async function quote(admin: Admin, userId: string, operation: Spend, units: number): Promise<{ credits: number; balance: number }> {
  const [pays, credits, balance] = await Promise.all([paysInCredits(admin, userId), priceOf(admin, operation, units), creditBalance(admin, userId)]);
  return { credits: pays ? credits : 0, balance };
}

/**
 * Whether this account pays in credits: every account but an own-key plan.
 * The owner pays too, so the owner sees what everyone else sees.
 */
export async function paysInCredits(admin: Admin, userId: string): Promise<boolean> {
  return !(await planOf(admin, userId)).grants.ownKey;
}

/**
 * Throws `OutOfCredits` when an account that pays in credits has none left,
 * or fewer than `need`, the quoted price of what is about to run.
 */
export async function assertCredits(admin: Admin, userId: string, need = 1): Promise<void> {
  if (!(await paysInCredits(admin, userId))) return;
  if ((await creditBalance(admin, userId)) < Math.max(1, need)) throw new OutOfCredits();
}
