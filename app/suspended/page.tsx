import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { LogoutButton } from "@/app/logout/logout-button";
import { StatusPage } from "@/components/onboarding/StatusPage";
import { IconAlertTriangle } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Estado reservado para suspensão futura — o fluxo público da TASK-002
 * nunca grava `suspended`; só seeds/testes, para validar este guard.
 * Sem operações comerciais aqui.
 *
 * requireStoreStatus exige uma loja `suspended` de verdade — uma loja
 * `pending_payment`/`active` não acessa esta página por URL direta
 * (corrige BUG-T2-001, qa/reports/TASK-002.md).
 */
export default async function SuspendedPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "suspended", storeSlug);

  return (
    <StatusPage icon={<IconAlertTriangle />} title="Loja suspensa" actions={<LogoutButton />}>
      <p>
        A loja &quot;{store.name}&quot; está suspensa. Nenhuma operação comercial está disponível enquanto este
        estado persistir.
      </p>
    </StatusPage>
  );
}
