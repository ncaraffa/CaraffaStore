import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { QuotaMeter } from "@/components/dashboard/QuotaMeter";
import { getStoreQuotaUsage } from "@/lib/billing/entitlements";
import { quotaNotice } from "@/lib/billing/quota-messages";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { NewStoreForm } from "./new-store-form";
import styles from "./stores.module.css";

export const dynamic = "force-dynamic";

/**
 * Lojas do comerciante — lista o que a assinatura já cobre e, quando o
 * plano permite, deixa criar a próxima sem refazer o onboarding da conta.
 *
 * O formulário só aparece quando ainda há vaga. Isso é conveniência, não
 * segurança: workspace_create_store recusa a loja excedente mesmo que a
 * Server Action seja chamada diretamente.
 */
export default async function StoresPage() {
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, ["active"]);

  const usage = await getStoreQuotaUsage(supabase, store.id);

  // Lojas do mesmo workspace. A RLS já limita ao que o usuário pode ver —
  // não há como listar loja de outro comerciante daqui. O workspace vem
  // da própria loja em sessão, nunca da URL.
  const { data: current } = await supabase
    .from("stores")
    .select("workspace_id")
    .eq("id", store.id)
    .maybeSingle();

  const { data: stores } = current
    ? await supabase
        .from("stores")
        .select("id, slug, name, status")
        .eq("workspace_id", current.workspace_id)
        .order("created_at", { ascending: true })
    : { data: [] };

  const canCreate = usage ? usage.stores.used < usage.stores.limit : false;
  const notice = usage && !canCreate ? quotaNotice("stores", usage.planKey) : null;

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="assinatura"
      breadcrumbs={[{ label: "Assinatura", href: "/dashboard/assinatura" }, { label: "Lojas" }]}
    >
      {usage && (
        <Card>
          <div className={styles.meter}>
            <QuotaMeter label="Lojas" used={usage.stores.used} limit={usage.stores.limit} />
          </div>
          <p className={styles.hint}>
            Sua assinatura é uma só: todas as lojas abaixo são cobertas pela mesma mensalidade.
          </p>
        </Card>
      )}

      <Card>
        <ul className={styles.list}>
          {(stores ?? []).map((item) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemName}>{item.name}</span>
                <span className={styles.itemSlug}>/{item.slug}</span>
              </div>
              <Badge tone={item.status === "active" ? "success" : "neutral"}>
                {item.status === "active" ? "Ativa" : item.status === "pending_payment" ? "Aguardando pagamento" : "Suspensa"}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      {canCreate ? (
        <Card>
          <h2 className={styles.sectionTitle}>Criar nova loja</h2>
          <p className={styles.sectionHint}>
            A nova loja entra na mesma assinatura — nenhuma cobrança adicional é gerada.
          </p>
          <NewStoreForm />
        </Card>
      ) : (
        notice && (
          <Alert tone="info">
            <strong>{notice.title}</strong>
            <p className={styles.noticeBody}>{notice.body}</p>
            {notice.upgradeTo && (
              <a className={styles.upgradeLink} href="/dashboard/assinatura">
                Fazer upgrade para o {notice.upgradeTo.label}
              </a>
            )}
          </Alert>
        )
      )}
    </DashboardShell>
  );
}
