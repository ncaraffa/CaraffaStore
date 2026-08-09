import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { storeStatusRedirectPath } from "@/lib/tenant/store-redirect";
import { requireVerifiedSession } from "@/lib/tenant/access-control";
import { LogoutButton } from "@/app/logout/logout-button";
import { Badge } from "@/components/ui/Badge";
import { Logo } from "@/components/ui/Logo";
import styles from "./select-store.module.css";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "Ativa", tone: "success" },
  pending_payment: { label: "Pagamento pendente", tone: "warning" },
  suspended: { label: "Suspensa", tone: "danger" },
  onboarding: { label: "Configurando", tone: "neutral" },
};

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
    <div className={styles.shell}>
      <Link href="/" className={styles.logoLink}>
        <Logo size="md" compact />
      </Link>
      <div className={styles.card}>
        <h1 className={styles.title}>Escolha uma loja</h1>
        <p className={styles.subtitle}>Você faz parte de mais de uma loja. Selecione qual deseja acessar.</p>
        <ul className={styles.list}>
          {stores.map((store) => {
            const status = STATUS_LABEL[store.status] ?? { label: store.status, tone: "neutral" as const };
            return (
              <li key={store.id}>
                <Link href={storeStatusRedirectPath(store.status, store.slug)} className={styles.item}>
                  <span className={styles.itemName}>{store.name}</span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className={styles.actions}>
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
