import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { LogoutButton } from "@/app/logout/logout-button";
import { StatusPage } from "@/components/onboarding/StatusPage";
import { IconCreditCard } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * T2-DEC-006/007: onboarding concluído termina aqui — só informativa,
 * sem Pix/QR Code/cobrança simulada. Painel operacional permanece
 * bloqueado (nem esta página nem nenhuma outra desta tarefa expõe
 * catálogo/pedidos/configuração de loja).
 *
 * requireStoreStatus exige uma loja `pending_payment` de verdade — uma
 * loja `active` não acessa esta página por URL direta (corrige
 * BUG-T2-001, qa/reports/TASK-002.md).
 */
export default async function PendingPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "pending_payment", storeSlug);

  return (
    <StatusPage icon={<IconCreditCard />} title="Cadastro concluído — pagamento pendente" actions={<LogoutButton />}>
      <p>
        A loja &quot;{store.name}&quot; está com o cadastro concluído. O painel operacional será liberado após a
        ativação da cobrança, em uma etapa futura. Nenhuma cobrança foi gerada nesta etapa.
      </p>
    </StatusPage>
  );
}
