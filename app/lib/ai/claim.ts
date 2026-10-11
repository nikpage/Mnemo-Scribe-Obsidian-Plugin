// [utils]

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A lock on work that must be paid for once.
 *
 * Every expensive command in this app can be started twice - two tabs, a
 * reload in the middle of it, a cron run meeting a page load, a webhook
 * meeting a poll. A flag in the running function locks nothing, because the
 * second caller is a different function on a different machine. The primary
 * key of `ai_claims` is the lock: exactly one insert can win.
 *
 * `ttlMs` says what a claim means. With one, it is "somebody is doing this
 * right now" and a claim older than the ttl is treated as abandoned - the
 * work died with a timed-out function and may be taken over. Without one, it
 * is "this has been done and is never done again": that is what stops a week
 * whose report came back empty from being rebuilt on every page open.
 */
export async function claim(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  kind: string,
  ttlMs?: number
): Promise<boolean> {
  const now = new Date().toISOString();

  const { error } = await admin
    .from("ai_claims")
    .insert({ user_id: userId, kind, claimed_at: now });

  if (!error) return true;

  // Anything other than the key already existing is a real failure, and the
  // safe reading of "I do not know whether I hold this" is that I do not.
  if (error.code !== "23505") {
    console.error(`Claiming ${kind} failed:`, error);
    return false;
  }

  if (ttlMs === undefined) return false;

  // Held by someone, but for longer than the work can take. One conditional
  // update, so two callers arriving at an abandoned claim cannot both win.
  const stale = new Date(Date.now() - ttlMs).toISOString();
  const { data: taken } = await admin
    .from("ai_claims")
    .update({ claimed_at: now })
    .eq("user_id", userId)
    .eq("kind", kind)
    .lt("claimed_at", stale)
    .select("kind")
    .maybeSingle();

  return Boolean(taken);
}

/** Let go of a claim, so the work can be done again. */
export async function release(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  kind: string
): Promise<void> {
  const { error } = await admin
    .from("ai_claims")
    .delete()
    .eq("user_id", userId)
    .eq("kind", kind);

  if (error) console.error(`Releasing ${kind} failed:`, error);
}
