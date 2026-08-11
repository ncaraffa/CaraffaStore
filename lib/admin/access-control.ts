import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { requireVerifiedSession } from "@/lib/tenant/access-control";

type Client = SupabaseClient<Database>;

export interface PlatformAdminSession {
  userId: string;
}

/**
 * Porta de entrada única do painel do dono da plataforma — nunca
 * reimplementar esta checagem em outra página/Server Action. A fonte de
 * verdade é `is_platform_admin()` (tabela `platform_admins`, gravação só
 * via service_role, sem função de auto-concessão): mesmo um usuário
 * autenticado e com sessão válida é redirecionado pro dashboard normal
 * se não estiver nessa allowlist.
 */
export async function requirePlatformAdmin(supabase: Client): Promise<PlatformAdminSession> {
  const session = await requireVerifiedSession(supabase);

  const { data: isAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error || !isAdmin) {
    redirect("/dashboard");
  }

  return { userId: session.userId };
}
