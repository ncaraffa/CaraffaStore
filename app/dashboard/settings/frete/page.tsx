import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getShippingSettings } from "@/lib/shipping/service";
import { ShippingSettingsForm } from "./shipping-settings-form";

export const dynamic = "force-dynamic";

export default async function ShippingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; salvo?: string }>;
}) {
  const { store: storeSlug, salvo } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store, role } = await requireStoreStatus(supabase, "active", storeSlug);

  /**
   * Diferente de Pagamentos (que redireciona o staff, porque
   * payment_settings_get só autoriza owner/admin e a página quebraria),
   * aqui o staff PODE ver: shipping_settings_get autoriza qualquer
   * membro, e saber quanto a loja cobra de frete é informação
   * operacional de quem atende pedido. O que ele não pode é alterar —
   * e quem recusa isso é shipping_settings_upsert no banco, não o
   * formulário.
   */
  const canEdit = role === "owner" || role === "admin";
  const settings = await getShippingSettings(supabase, store.id);

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="frete"
      breadcrumbs={[{ label: "Painel", href: `/dashboard?store=${store.slug}` }, { label: "Frete" }]}
    >
      <ShippingSettingsForm storeSlug={store.slug} settings={settings} canEdit={canEdit} justSaved={salvo === "1"} />
    </DashboardShell>
  );
}
