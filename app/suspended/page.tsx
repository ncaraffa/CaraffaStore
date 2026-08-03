import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveOptionalStoreName } from "@/lib/tenant/resolve-optional-store";
import { LogoutButton } from "@/app/logout/logout-button";

export const dynamic = "force-dynamic";

/**
 * Estado reservado para suspensão futura — o fluxo público da TASK-002
 * nunca grava `suspended`; só seeds/testes, para validar este guard.
 * Sem operações comerciais aqui.
 */
export default async function SuspendedPage({
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
      <h1>Loja suspensa</h1>
      <p>
        {storeName ? `A loja "${storeName}"` : "Sua loja"} está suspensa. Nenhuma operação
        comercial está disponível enquanto este estado persistir.
      </p>
      <LogoutButton />
    </main>
  );
}
