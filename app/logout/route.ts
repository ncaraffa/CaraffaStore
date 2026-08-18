import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { endAppSession } from "@/lib/auth/app-session";

/**
 * Logout é POST-only (nunca GET) para não ser disparado por prefetch de
 * link/crawler. Invalida a sessão local e redireciona para login — ver
 * app/logout/logout-button.tsx para o form que chama esta rota.
 *
 * TASK-012: revoga a sessão da CaraffaStore ANTES do signOut. A ordem
 * importa — depois do signOut não há mais JWT, e é o claim session_id
 * dele que identifica qual linha de app_sessions revogar. Sem isso a
 * sessão continuaria ocupando a vaga única do Essencial até virar stale.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  await endAppSession(supabase);
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url));
}
