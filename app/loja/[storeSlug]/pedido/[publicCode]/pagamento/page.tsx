import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicPaymentView } from "@/lib/payments/service-only/payment-page-reader";
import { RECEIPT_COOKIE_NAME } from "@/lib/payments/receipt-cookie";
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

      <p className={styles.backLink}>
        <a href={`/loja/${storeSlug}`}>← Voltar para a loja</a>
      </p>
    </main>
  );
}
