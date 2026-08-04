import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";
import { getPublicSupabaseEnv } from "./env";

/**
 * Browser-side Supabase client (anon key only, respects RLS). Use from
 * Client Components that need interactive auth (e.g. submitting a
 * signup/login form without a full page reload). Server-side code
 * should keep using createServerSupabaseClient (lib/supabase/server.ts).
 */
export function createBrowserSupabaseClient() {
  const env = getPublicSupabaseEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
