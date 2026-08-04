import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveUserDestination } from "@/lib/tenant/membership";
import { requireVerifiedSession } from "@/lib/tenant/access-control";

export const dynamic = "force-dynamic";

/**
 * Ponto central da matriz de redirecionamento (docs/handoff.md).
 * Anônimo/não verificado/sessão de recuperação já são barrados pelo
 * middleware antes de chegar aqui, mas esta página revalida por conta
 * própria via requireVerifiedSession — nunca confia só no middleware
 * (docs/security.md).
 */
export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const { userId } = await requireVerifiedSession(supabase);

  const destination = await resolveUserDestination(supabase, userId);
  redirect(destination.path);
}
