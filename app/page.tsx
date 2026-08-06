import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveUserDestination } from "@/lib/tenant/membership";
import { requireVerifiedSession } from "@/lib/tenant/access-control";
import { LandingPage } from "@/components/marketing/LandingPage";

export const dynamic = "force-dynamic";

/**
 * Ponto central da matriz de redirecionamento (docs/handoff.md) para
 * quem já tem sessão. Anônimo agora vê a landing pública da
 * CaraffaStore em vez de ser redirecionado — "/" foi adicionada a
 * PUBLIC_PATHS (lib/auth/middleware-policy.ts) só para esse caso;
 * autenticado não verificado/sessão de recuperação continuam sendo
 * barrados antes daqui pelo próprio middleware.
 */
export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <LandingPage />;
  }

  const { userId } = await requireVerifiedSession(supabase);
  const destination = await resolveUserDestination(supabase, userId);
  redirect(destination.path);
}
