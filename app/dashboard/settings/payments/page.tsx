import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardNav } from "@/app/dashboard/dashboard-nav";
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
    <main>
      <h1>Pagamentos — {store.name}</h1>
      <DashboardNav storeSlug={store.slug} />

      <PaymentSettingsForm storeSlug={store.slug} settings={settings} webhookUrl={webhookUrl} />
    </main>
  );
}
