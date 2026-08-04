import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { LogoutButton } from "@/app/logout/logout-button";
import { DashboardNav } from "@/app/dashboard/dashboard-nav";

export const dynamic = "force-dynamic";

/**
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
      <p>
        Loja &quot;{store.name}&quot; ativa. Catálogo público em{" "}
        <a href={`/loja/${store.slug}`}>/loja/{store.slug}</a>.
      </p>
      <DashboardNav storeSlug={store.slug} />
      <LogoutButton />
    </main>
  );
}
