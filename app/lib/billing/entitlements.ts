// [utils]

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/** Subscription states Stripe still counts as paying. */
export const LIVE_STATUSES = ["active", "trialing", "past_due"];

/**
 * What a product gives, read from its Stripe metadata — the one place a new
 * kind of upgrade is declared. Unknown keys are kept, unread.
 *
 * - `credits`: credits per period (a plan) or once (a bundle).
 * - `own_key`: "true" when the account brings its own AI keys and is never
 *   charged credits.
 */
export interface Grants {
  credits: number;
  ownKey: boolean;
}

export function grantsOf(metadata: Record<string, unknown> | null | undefined): Grants {
  const credits = Number(metadata?.credits);
  return {
    credits: Number.isInteger(credits) && credits > 0 ? credits : 0,
    ownKey: String(metadata?.own_key ?? "").toLowerCase() === "true",
  };
}

export interface Plan {
  /** The product's name, or null with no live subscription. */
  name: string | null;
  status: string | null;
  renews: string | null;
  cancelling: boolean;
  grants: Grants;
}

/** The account's live plan, from the mirrored subscription and product. */
export async function planOf(admin: Admin, userId: string): Promise<Plan> {
  const { data, error } = await admin
    .from("billing_subscriptions")
    .select("status, current_period_end, cancel_at_period_end, quantity, billing_prices(billing_products(name, metadata))")
    .eq("user_id", userId)
    .in("status", LIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Cannot read the plan: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const product = (data as any)?.billing_prices?.billing_products as { name: string; metadata: Record<string, unknown> } | undefined;
  if (!data || !product) return { name: null, status: null, renews: null, cancelling: false, grants: grantsOf(null) };
  return {
    name: product.name,
    status: data.status,
    renews: data.current_period_end,
    cancelling: Boolean(data.cancel_at_period_end),
    grants: grantsOf(product.metadata),
  };
}
