import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getStoreQuotaUsage } from "@/lib/billing/entitlements";
import { quotaNotice } from "@/lib/billing/quota-messages";
import { listCoupons } from "@/lib/coupons/service";
import {
  COUPON_STATUS_LABEL,
  couponStatus,
  describeDiscount,
  describeUsage,
  describeValidity,
  formatCents,
} from "@/lib/coupons/format";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { CouponForm, ToggleCouponForm } from "./coupon-form";
import styles from "./coupons.module.css";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, BadgeTone> = {
  active: "success",
  inactive: "neutral",
  scheduled: "info",
  expired: "warning",
};

/**
 * Marketing → Cupons.
 *
 * No Essencial a tela vira upsell, não um formulário que falha depois: o
 * entitlement é lido do servidor e o formulário sequer é renderizado.
 * Isso é UX — quem recusa de verdade é coupon_upsert no banco, inclusive
 * para chamada direta à RPC.
 */
export default async function CouponsPage() {
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, ["active"]);

  const usage = await getStoreQuotaUsage(supabase, store.id);
  const couponsEnabled = usage?.couponsEnabled ?? false;
  const coupons = couponsEnabled ? await listCoupons(supabase, store.id) : [];
  const notice = usage && !couponsEnabled ? quotaNotice("coupons", usage.planKey) : null;

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="marketing"
      breadcrumbs={[{ label: "Marketing" }, { label: "Cupons" }]}
    >
      {!couponsEnabled ? (
        <Card>
          <h2 className={styles.upsellTitle}>Cupons de desconto</h2>
          <p className={styles.upsellBody}>
            Crie códigos promocionais para campanhas e ofertas — como <strong>NATAL10</strong> ou{" "}
            <strong>BEMVINDO20</strong> — e ofereça descontos aos seus clientes no checkout.
          </p>
          {notice && (
            <Alert tone="info">
              <strong>{notice.title}</strong>
              <p className={styles.noticeBody}>{notice.body}</p>
            </Alert>
          )}
          <a className={styles.upgradeLink} href={`/dashboard/assinatura?store=${store.slug}`}>
            Conhecer o Crescimento
          </a>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className={styles.sectionTitle}>Novo cupom</h2>
            <CouponForm />
          </Card>

          <Card>
            <h2 className={styles.sectionTitle}>Seus cupons</h2>
            {coupons.length === 0 ? (
              <EmptyState
                title="Nenhum cupom ainda"
                description="Crie o primeiro código promocional para usar nas suas campanhas."
              />
            ) : (
              <ul className={styles.list}>
                {coupons.map((coupon) => {
                  const status = couponStatus(coupon);
                  const validity = describeValidity(coupon);
                  return (
                    <li key={coupon.id} className={styles.item}>
                      <div className={styles.itemMain}>
                        <span className={styles.code}>{coupon.code}</span>
                        <span className={styles.meta}>{describeDiscount(coupon)}</span>
                        <span className={styles.meta}>{describeUsage(coupon)}</span>
                        {coupon.minimumOrderCents !== null && (
                          <span className={styles.meta}>
                            Pedido mínimo {formatCents(coupon.minimumOrderCents)}
                          </span>
                        )}
                        {coupon.maximumDiscountCents !== null && (
                          <span className={styles.meta}>
                            Desconto máximo {formatCents(coupon.maximumDiscountCents)}
                          </span>
                        )}
                        {validity && <span className={styles.meta}>{validity}</span>}
                      </div>
                      <div className={styles.itemActions}>
                        {/* Texto além da cor: o status nunca depende só do tom do badge. */}
                        <Badge tone={STATUS_TONE[status] ?? "neutral"}>{COUPON_STATUS_LABEL[status]}</Badge>
                        <ToggleCouponForm coupon={coupon} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </DashboardShell>
  );
}
