import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/admin/access-control";
import { getPlatformPlan } from "@/lib/billing/plans";
import { formatPriceCents } from "@/lib/catalog/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconStore } from "@/components/ui/icons";
import type { Database, StoreStatus } from "@/lib/supabase/types";
import { StoreStatusActions } from "./store-status-actions";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

type StoreOverviewRow = Database["public"]["Functions"]["platform_admin_store_overview"]["Returns"][number];

const STATUS_LABEL: Record<StoreStatus, { label: string; tone: BadgeTone }> = {
  onboarding: { label: "Configurando", tone: "neutral" },
  pending_payment: { label: "Pagamento pendente", tone: "warning" },
  active: { label: "Ativa", tone: "success" },
  suspended: { label: "Suspensa", tone: "danger" },
};

const CHARGE_LABEL: Record<string, string> = {
  approved: "Em dia",
  pending: "Aguardando Pix",
  creating: "Gerando cobrança",
  manual_review: "Revisão manual",
  rejected: "Rejeitada",
  cancelled: "Cancelada",
  expired: "Expirada",
  error: "Erro",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

export default async function AdminPage() {
  const supabase = await createServerSupabaseClient();
  await requirePlatformAdmin(supabase);

  const { data, error } = await supabase.rpc("platform_admin_store_overview");
  const stores: StoreOverviewRow[] = error || !data ? [] : data;

  const activeCount = stores.filter((s) => s.status === "active").length;
  const suspendedCount = stores.filter((s) => s.status === "suspended").length;
  const payingCount = stores.filter((s) => s.latest_charge_status === "approved").length;
  const mrrCents = stores
    .filter((s) => s.latest_charge_status === "approved")
    .reduce((sum, s) => sum + (s.latest_charge_amount_cents ?? 0), 0);

  return (
    <div className={styles.page}>
      <div className={styles.summaryGrid}>
        <Card>
          <span className={styles.summaryLabel}>Lojas cadastradas</span>
          <span className={styles.summaryValue}>{stores.length}</span>
        </Card>
        <Card>
          <span className={styles.summaryLabel}>Ativas</span>
          <span className={styles.summaryValue}>{activeCount}</span>
        </Card>
        <Card>
          <span className={styles.summaryLabel}>Suspensas</span>
          <span className={styles.summaryValue}>{suspendedCount}</span>
        </Card>
        <Card>
          <span className={styles.summaryLabel}>Assinaturas em dia</span>
          <span className={styles.summaryValue}>{payingCount}</span>
        </Card>
        <Card>
          <span className={styles.summaryLabel}>Receita recorrente (período atual)</span>
          <span className={styles.summaryValue}>{formatPriceCents(mrrCents)}</span>
        </Card>
      </div>

      <Card>
        <CardHeader title="Todas as lojas" description="Cada linha é uma loja cadastrada na CaraffaStore, com o dono e a assinatura mais recente." />

        {stores.length === 0 ? (
          <EmptyState icon={<IconStore />} title="Nenhuma loja cadastrada ainda" description="Assim que um comerciante se cadastrar, ela aparece aqui." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Loja</th>
                <th>Status</th>
                <th>Plano</th>
                <th>Dono</th>
                <th>Assinatura</th>
                <th>Criada em</th>
                <th aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => {
                const status = STATUS_LABEL[store.status];
                return (
                  <tr key={store.store_id}>
                    <td>
                      <div className={styles.storeCell}>
                        <strong>{store.name}</strong>
                        <a href={`/loja/${store.slug}`} target="_blank" rel="noreferrer" className={styles.storeSlug}>
                          /loja/{store.slug}
                        </a>
                      </div>
                    </td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {store.status === "suspended" && store.pre_suspension_status && (
                        <div className={styles.subLabel}>era {STATUS_LABEL[store.pre_suspension_status].label.toLowerCase()}</div>
                      )}
                    </td>
                    <td>{store.plan_code ? getPlatformPlan(store.plan_code).label : "—"}</td>
                    <td>
                      <div className={styles.ownerCell}>
                        <span>{store.owner_display_name ?? "—"}</span>
                        <span className={styles.subLabel}>{store.owner_email ?? "—"}</span>
                        {store.whatsapp && <span className={styles.subLabel}>{store.whatsapp}</span>}
                      </div>
                    </td>
                    <td>
                      <div className={styles.ownerCell}>
                        <span>{store.latest_charge_status ? (CHARGE_LABEL[store.latest_charge_status] ?? store.latest_charge_status) : "Sem cobrança"}</span>
                        {store.latest_charge_amount_cents != null && (
                          <span className={styles.subLabel}>
                            {formatPriceCents(store.latest_charge_amount_cents)} · vence {formatDate(store.latest_charge_period_end)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{formatDate(store.store_created_at)}</td>
                    <td>
                      <StoreStatusActions storeId={store.store_id} storeName={store.name} isSuspended={store.status === "suspended"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
