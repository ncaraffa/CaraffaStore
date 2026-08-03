import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";
import { getPublicSupabaseEnv } from "./env";

/**
 * Server-side Supabase client bound to the current request's session
 * cookies. Uses the anon key, so every query still goes through RLS —
 * this client can never see more than the authenticated user is allowed
 * to see at the database level.
 */
export async function createServerSupabaseClient() {
  const env = getPublicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component without a mutable response —
            // safe to ignore when middleware handles session refresh.
          }
        },
      },
    },
  );
}
