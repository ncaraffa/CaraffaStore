import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { storeStatusRedirectPath } from "@/lib/tenant/store-redirect";
import { requireVerifiedSession } from "@/lib/tenant/access-control";
import { LogoutButton } from "@/app/logout/logout-button";

export const dynamic = "force-dynamic";

/**
 * Seleção EXPLÍCITA de loja para usuários com mais de um membership —
 * nunca escolhe a primeira silenciosamente (docs/handoff.md, "Matriz de
 * estados e redirecionamentos"). Cada loja listada vem só de
 * `store_members` do próprio usuário (RLS: `user_id = auth.uid()`); os
 * links levam a rotas que revalidam a autorização de novo via
 * lib/tenant/access-control.ts antes de mostrar dados.
 *
 * requireVerifiedSession garante, além de sessão/verificação, que isto
 * não é uma sessão de recuperação de senha "vazando" para fora de
 * /reset-password (mesma checagem usada por toda página protegida).
 */
export default async function SelectStorePage() {
  const supabase = await createServerSupabaseClient();
  const { userId } = await requireVerifiedSession(supabase);

  const { data: memberships } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId);

  if (!memberships || memberships.length === 0) {
    redirect("/onboarding");
  }

  const storeIds = memberships.map((m) => m.store_id);
  const { data: stores } = await supabase
    .from("stores")
    .select("id, slug, name, status")
    .in("id", storeIds);

  if (!stores || stores.length === 0) {
    redirect("/onboarding");
  }

  if (stores.length === 1) {
    redirect(storeStatusRedirectPath(stores[0]!.status, stores[0]!.slug));
  }

  return (
    <main>
      <h1>Escolha uma loja</h1>
      <ul>
        {stores.map((store) => (
          <li key={store.id}>
            <Link href={storeStatusRedirectPath(store.status, store.slug)}>{store.name}</Link>{" "}
            <span>({store.status})</span>
          </li>
        ))}
      </ul>
      <LogoutButton />
    </main>
  );
}
