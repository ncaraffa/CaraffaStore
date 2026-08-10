import { redirect } from "next/navigation";
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
  const { store, role } = await requireStoreStatus(supabase, "active", storeSlug);

  /**
   * payment_settings_get/upsert só autorizam owner/admin
   * (can_manage_store_payments, 0007_payments.sql) — staff nunca chega a
   * renderizar este formulário; sem o redirect aqui, a chamada abaixo
   * lançaria insufficient_privilege e quebraria a página inteira.
   */
  if (role !== "owner" && role !== "admin") {
    redirect(`/dashboard?store=${store.slug}`);
  }

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
