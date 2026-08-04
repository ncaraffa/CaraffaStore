import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Logout é POST-only (nunca GET) para não ser disparado por prefetch de
 * link/crawler. Invalida a sessão local e redireciona para login — ver
 * app/logout/logout-button.tsx para o form que chama esta rota.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url));
}
