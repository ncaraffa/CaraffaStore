import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getPublicSupabaseEnv, getServiceRoleEnv } from "./env";

/**
 * Service-role Supabase client. Bypasses RLS entirely.
 *
 * ONLY for trusted, local/dev-only scripts (seeding fixtures, test setup).
 * Never import this module from an API route, Server Action, or any code
 * that runs in response to a user request — that would defeat tenant
 * isolation. See docs/SECURITY.md.
 */
export function createAdminSupabaseClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServiceRoleEnv();

  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
