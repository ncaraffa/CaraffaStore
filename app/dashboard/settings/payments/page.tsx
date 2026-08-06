import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getPaymentSettings } from "@/lib/payments/settings-service";
import { absoluteUrl } from "@/lib/auth/site-url";
import { PaymentSettingsForm } from "./payment-settings-form";

export const dynamic = "force-dynamic";

export default async function PaymentSettingsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  const settings = await getPaymentSettings(supabase, store.id);
  const webhookUrl = settings.webhookKey
    ? absoluteUrl(`/api/webhooks/mercado-pago?client=${settings.webhookKey}`)
    : null;

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="pagamentos"
      breadcrumbs={[{ label: "Painel", href: `/dashboard?store=${store.slug}` }, { label: "Pagamentos" }]}
    >
      <PaymentSettingsForm storeSlug={store.slug} settings={settings} webhookUrl={webhookUrl} />
    </DashboardShell>
  );
}
