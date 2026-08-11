import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/admin/access-control";
import { getPlatformPlan } from "@/lib/billing/plans";
import { formatPriceCents } from "@/lib/catalog/format";
import { whatsappHref } from "@/lib/admin/format";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconMail,
  IconStore,
  IconWhatsapp,
} from "@/components/ui/icons";
import type { Database, StoreStatus } from "@/lib/supabase/types";
import { StoreStatusActions } from "./store-status-actions";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

type StoreOverviewRow = Database["public"]["Functions"]["platform_admin_store_overview"]["Returns"][number];

const STORES_PER_PAGE = 10;

const STATUS_LABEL: Record<StoreStatus, string> = {
  onboarding: "Configurando",
  pending_payment: "Pagamento pendente",
  active: "Ativa",
  suspended: "Suspensa",
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

/** approved é o único estado que representa período pago de fato. */
const CHARGE_TONE: Record<string, "paid" | "waiting" | "failed"> = {
  approved: "paid",
  pending: "waiting",
  creating: "waiting",
  manual_review: "failed",
  rejected: "failed",
  cancelled: "failed",
  expired: "failed",
  error: "failed",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const supabase = await createServerSupabaseClient();
  await requirePlatformAdmin(supabase);

  const { data, error } = await supabase.rpc("platform_admin_store_overview");
  const stores: StoreOverviewRow[] = error || !data ? [] : data;

  const activeCount = stores.filter((s) => s.status === "active").length;
  const suspendedCount = stores.filter((s) => s.status === "suspended").length;
  const payingStores = stores.filter((s) => s.latest_charge_status === "approved");
  const mrrCents = payingStores.reduce((sum, s) => sum + (s.latest_charge_amount_cents ?? 0), 0);

  // Paginação server-side por fatia: mantém a página utilizável com
  // qualquer número de lojas sem virar um scroll infinito.
  const totalPages = Math.max(1, Math.ceil(stores.length / STORES_PER_PAGE));
  const parsedPage = Number.parseInt(pageParam ?? "1", 10);
  const currentPage = Math.min(Math.max(Number.isNaN(parsedPage) ? 1 : parsedPage, 1), totalPages);
  const firstIndex = (currentPage - 1) * STORES_PER_PAGE;
  const pageStores = stores.slice(firstIndex, firstIndex + STORES_PER_PAGE);

  return (
    <>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Controle geral da plataforma</p>
        <h1 className={styles.heroTitle}>Todas as lojas, um lugar só.</h1>
        <p className={styles.heroSubtitle}>
          Visão completa de quem está vendendo na CaraffaStore, quanto está entrando e o que precisa da sua atenção.
        </p>

        <div className={styles.kpiGrid}>
          <div className={styles.kpi} data-accent="revenue">
            <span className={styles.kpiLabel}>Receita recorrente</span>
            <span className={styles.kpiValue}>{formatPriceCents(mrrCents)}</span>
            <span className={styles.kpiFoot}>
              {payingStores.length} assinatura{payingStores.length === 1 ? "" : "s"} em dia
            </span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>Lojas cadastradas</span>
            <span className={styles.kpiValue}>{stores.length}</span>
            <span className={styles.kpiFoot}>desde o início</span>
          </div>
          <div className={styles.kpi} data-accent="active">
            <span className={styles.kpiLabel}>Ativas</span>
            <span className={styles.kpiValue}>{activeCount}</span>
            <span className={styles.kpiFoot}>vendendo agora</span>
          </div>
          <div className={styles.kpi} data-accent="danger">
            <span className={styles.kpiLabel}>Suspensas</span>
            <span className={styles.kpiValue}>{suspendedCount}</span>
            <span className={styles.kpiFoot}>bloqueadas por você</span>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Lojas da plataforma</h2>
            <p className={styles.panelDescription}>
              Cada linha traz o dono, o contato direto e a assinatura mais recente.
            </p>
          </div>
          {stores.length > 0 && (
            <span className={styles.panelCount}>
              {stores.length} loja{stores.length === 1 ? "" : "s"}
            </span>
          )}
        </header>

        {stores.length === 0 ? (
          <div className={styles.emptyWrap}>
            <EmptyState
              icon={<IconStore />}
              title="Nenhuma loja cadastrada ainda"
              description="Assim que um comerciante concluir o cadastro, ela aparece aqui."
            />
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Loja</th>
                    <th>Status</th>
                    <th>Plano</th>
                    <th>Dono</th>
                    <th>Assinatura</th>
                    <th>Criada em</th>
                    <th>
                      <span className="visually-hidden">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageStores.map((store) => {
                    const plan = store.plan_code ? getPlatformPlan(store.plan_code) : null;
                    const chargeTone = store.latest_charge_status ? CHARGE_TONE[store.latest_charge_status] : undefined;
                    const waHref = whatsappHref(store.whatsapp);

                    return (
                      <tr key={store.store_id} data-suspended={store.status === "suspended" || undefined}>
                        <td>
                          <div className={styles.storeCell}>
                            <span className={styles.monogram} aria-hidden="true">
                              {store.name.trim().charAt(0).toUpperCase()}
                            </span>
                            <span className={styles.storeText}>
                              <strong className={styles.storeName}>{store.name}</strong>
                              <a
                                href={`/loja/${store.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className={styles.storeSlug}
                              >
                                /loja/{store.slug}
                                <IconExternalLink />
                              </a>
                            </span>
                          </div>
                        </td>

                        <td>
                          <span className={styles.statusPill} data-status={store.status}>
                            <span className={styles.statusDot} aria-hidden="true" />
                            {STATUS_LABEL[store.status]}
                          </span>
                          {store.status === "suspended" && store.pre_suspension_status && (
                            <span className={styles.subLabel}>
                              volta como {STATUS_LABEL[store.pre_suspension_status].toLowerCase()}
                            </span>
                          )}
                        </td>

                        <td>
                          {plan ? (
                            <span className={styles.planCell}>
                              <strong>{plan.label}</strong>
                              <span className={styles.subLabel}>R$ {plan.price}/mês</span>
                            </span>
                          ) : (
                            <span className={styles.subLabel}>—</span>
                          )}
                        </td>

                        <td>
                          <div className={styles.ownerCell}>
                            <strong className={styles.ownerName}>{store.owner_display_name ?? "—"}</strong>
                            {store.owner_email && (
                              <a href={`mailto:${store.owner_email}`} className={styles.contactLink}>
                                <IconMail />
                                {store.owner_email}
                              </a>
                            )}
                            {store.whatsapp &&
                              (waHref ? (
                                <a
                                  href={waHref}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={styles.contactLink}
                                  data-whatsapp="true"
                                >
                                  <IconWhatsapp />
                                  {store.whatsapp}
                                </a>
                              ) : (
                                <span className={styles.contactLink}>
                                  <IconWhatsapp />
                                  {store.whatsapp}
                                </span>
                              ))}
                          </div>
                        </td>

                        <td>
                          <div className={styles.chargeCell}>
                            <span className={styles.chargeStatus} data-tone={chargeTone}>
                              {store.latest_charge_status
                                ? (CHARGE_LABEL[store.latest_charge_status] ?? store.latest_charge_status)
                                : "Sem cobrança"}
                            </span>
                            {store.latest_charge_amount_cents != null && (
                              <span className={styles.subLabel}>
                                {formatPriceCents(store.latest_charge_amount_cents)} · vence{" "}
                                {formatDate(store.latest_charge_period_end)}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className={styles.dateCell}>{formatDate(store.store_created_at)}</td>

                        <td className={styles.actionCell}>
                          <StoreStatusActions
                            storeId={store.store_id}
                            storeName={store.name}
                            isSuspended={store.status === "suspended"}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <footer className={styles.pagination}>
              <span className={styles.paginationInfo}>
                Mostrando <strong>{firstIndex + 1}</strong>–<strong>{firstIndex + pageStores.length}</strong> de{" "}
                <strong>{stores.length}</strong>
              </span>

              <div className={styles.paginationControls}>
                <span className={styles.paginationPage}>
                  Página {currentPage} de {totalPages}
                </span>
                {currentPage > 1 ? (
                  <Link
                    href={`/admin?page=${currentPage - 1}`}
                    className={styles.pageButton}
                    aria-label="Página anterior"
                  >
                    <IconChevronLeft />
                    Anterior
                  </Link>
                ) : (
                  <span className={styles.pageButton} aria-disabled="true">
                    <IconChevronLeft />
                    Anterior
                  </span>
                )}
                {currentPage < totalPages ? (
                  <Link
                    href={`/admin?page=${currentPage + 1}`}
                    className={styles.pageButton}
                    aria-label="Próxima página"
                  >
                    Próxima
                    <IconChevronRight />
                  </Link>
                ) : (
                  <span className={styles.pageButton} aria-disabled="true">
                    Próxima
                    <IconChevronRight />
                  </span>
                )}
              </div>
            </footer>
          </>
        )}
      </section>
    </>
  );
}
