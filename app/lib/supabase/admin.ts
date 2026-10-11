// [utils]

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client, built once per process rather than once per call.
 *
 * A Supabase client is not free to construct: it stands up an auth client with
 * its own storage and refresh timers, a realtime socket and a storage client,
 * none of which a service-role query uses. On a serverless function that was
 * being paid several times per request. The options below switch off the parts
 * that only make sense for a browser session — there is no session here to
 * persist or refresh, only a key.
 */
let client: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (client) return client;
  client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }
  );
  return client;
}
