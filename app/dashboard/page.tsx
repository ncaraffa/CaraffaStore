import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveOptionalStoreName } from "@/lib/tenant/resolve-optional-store";
import { LogoutButton } from "@/app/logout/logout-button";

export const dynamic = "force-dynamic";

/**
 * Placeholder do painel operacional — o painel real (catálogo, pedidos,
 * configuração) é explicitamente fora do escopo da TASK-002. Esta rota
 * existe só para provar o guard de estado `active`: no fluxo público
 * desta tarefa nenhuma loja chega a `active` (só via seed/teste).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email_confirmed_at) redirect("/verify");

  const storeName = await resolveOptionalStoreName(supabase, user.id, storeSlug);

  return (
    <main>
      <h1>Painel</h1>
      <p>
        {storeName ? `Loja "${storeName}" ativa.` : "Loja ativa."} Painel operacional completo fora
        do escopo desta tarefa.
      </p>
      <LogoutButton />
    </main>
  );
}
