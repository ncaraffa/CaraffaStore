import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicPaymentView } from "@/lib/payments/service-only/payment-page-reader";
import { RECEIPT_COOKIE_NAME } from "@/lib/payments/receipt-cookie";
import { formatPriceCents } from "@/lib/catalog/format";
import { formatCityState, formatPostalCode } from "@/lib/shipping/format";
import { PaymentStatusClient } from "./payment-status-client";
import styles from "./payment.module.css";

export const dynamic = "force-dynamic";

const PUBLIC_CODE_FORMAT = /^[0-9A-Z]{8}$/;

/**
 * publicCode sozinho NUNCA é suficiente aqui — getPublicPaymentView exige
 * também o cookie de recibo (HttpOnly, escopo desta rota) batendo com o
 * hash guardado no pedido. Sem os dois, 404 — nenhum dado do pedido, QR
 * Code ou status vaza por tentativa de adivinhar/enumerar publicCode.
 */
export default async function PaymentPage({
  params,
}: {
  params: Promise<{ storeSlug: string; publicCode: string }>;
}) {
  const { storeSlug, publicCode } = await params;
  if (!PUBLIC_CODE_FORMAT.test(publicCode)) {
    notFound();
  }

  const cookieStore = await cookies();
  const receiptToken = cookieStore.get(RECEIPT_COOKIE_NAME)?.value;

  const view = await getPublicPaymentView({ storeSlug, publicCode, receiptToken });
  if (!view) {
    notFound();
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1 className={styles.title}>Pagamento via Pix</h1>
        <p className={styles.subtitle}>Pague abaixo para confirmar seu pedido. O comerciante será avisado automaticamente.</p>
      </div>

      <PaymentStatusClient
        publicCode={view.publicCode}
        status={view.status}
        amountCents={view.amountCents}
        qrCode={view.qrCode}
        qrCodeBase64={view.qrCodeBase64}
        ticketUrl={view.ticketUrl}
        expiresAt={view.expiresAt}
      />

      {/* TASK-013 — a conferência antes de pagar: de onde saiu o valor e
          para onde vai. Tudo é snapshot do pedido; mudar a tabela de
          frete da loja depois não reescreve nada disto. */}
      <section className={styles.orderSummary} aria-label="Resumo do pedido">
        <div className={styles.summaryRow}>
          <span>Produtos</span>
          <span className={styles.summaryValue}>{formatPriceCents(view.order.subtotalCents)}</span>
        </div>
        {view.order.discountCents > 0 && (
          <div className={styles.summaryRow}>
            <span>Desconto</span>
            <span className={styles.summaryValue}>−{formatPriceCents(view.order.discountCents)}</span>
          </div>
        )}
        {view.order.shippingRule && (
          <div className={styles.summaryRow}>
            <span>Frete</span>
            <span className={styles.summaryValue} data-free={view.order.shippingRule === "free" || undefined}>
              {view.order.shippingRule === "free" ? "Grátis" : formatPriceCents(view.order.shippingAmountCents)}
            </span>
          </div>
        )}
        <div className={styles.summaryTotalRow}>
          <span>Total</span>
          <span className={styles.summaryValue}>{formatPriceCents(view.order.totalCents)}</span>
        </div>

        {view.order.fulfillmentMethod === "delivery" && (
          <div className={styles.addressBlock}>
            <p className={styles.addressLabel}>Entrega em</p>
            {view.order.shippingPostalCode ? (
              <address className={styles.address}>
                {[view.order.shippingStreet, view.order.shippingNumber].filter(Boolean).join(", ")}
                {view.order.shippingComplement ? ` — ${view.order.shippingComplement}` : ""}
                <br />
                {view.order.shippingNeighborhood ? (
                  <>
                    {view.order.shippingNeighborhood}
                    <br />
                  </>
                ) : null}
                {formatCityState(view.order.shippingCity, view.order.shippingState)}
                <br />
                CEP {formatPostalCode(view.order.shippingPostalCode)}
              </address>
            ) : (
              <address className={styles.address}>{view.order.deliveryAddress}</address>
            )}
          </div>
        )}
      </section>

      <p className={styles.backLink}>
        <a href={`/loja/${storeSlug}`}>← Voltar para a loja</a>
      </p>
    </main>
  );
}
