import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveOptionalStoreName } from "@/lib/tenant/resolve-optional-store";
import { LogoutButton } from "@/app/logout/logout-button";

export const dynamic = "force-dynamic";

/**
 * T2-DEC-006/007: onboarding concluído termina aqui — só informativa,
 * sem Pix/QR Code/cobrança simulada. Painel operacional permanece
 * bloqueado (nem esta página nem nenhuma outra desta tarefa expõe
 * catálogo/pedidos/configuração de loja).
 */
export default async function PendingPaymentPage({
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
      <h1>Cadastro concluído — pagamento pendente</h1>
      <p>
        {storeName ? `A loja "${storeName}"` : "Sua loja"} está com o cadastro concluído. O painel
        operacional será liberado após a ativação da cobrança, em uma etapa futura. Nenhuma cobrança
        foi gerada nesta etapa.
      </p>
      <LogoutButton />
    </main>
  );
}
