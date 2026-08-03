import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { LogoutButton } from "@/app/logout/logout-button";

export const dynamic = "force-dynamic";

/**
 * Placeholder do painel operacional — o painel real (catálogo, pedidos,
 * configuração) é explicitamente fora do escopo da TASK-002. Esta rota
 * existe só para provar o guard de estado `active`: no fluxo público
 * desta tarefa nenhuma loja chega a `active` (só via seed/teste).
 *
 * requireStoreStatus exige uma loja `active` de verdade — sem `?store=`
 * resolve pela situação real de memberships (nunca libera acesso
 * genérico por ausência do parâmetro; corrige BUG-T2-001,
 * qa/reports/TASK-002.md).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  return (
    <main>
      <h1>Painel</h1>
      <p>Loja &quot;{store.name}&quot; ativa. Painel operacional completo fora do escopo desta tarefa.</p>
      <LogoutButton />
    </main>
  );
}
