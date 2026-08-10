"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPriceCents } from "@/lib/catalog/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { IconCheck, IconClock, IconCopy, IconPix } from "@/components/ui/icons";
// Reaproveita literalmente o CSS Module da tela de pagamento Pix do
// pedido (TASK-005/008) — mesma linguagem visual, não uma paralela.
import styles from "@/app/loja/[storeSlug]/pedido/[publicCode]/pagamento/payment.module.css";

const STATUS_LABEL: Record<string, string> = {
  creating: "Gerando cobrança...",
  pending: "Aguardando pagamento",
  approved: "Pagamento aprovado",
  rejected: "Pagamento recusado",
  cancelled: "Pagamento cancelado",
  expired: "Pix expirado",
  error: "Não foi possível gerar o Pix",
  manual_review: "Em análise",
};

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Mesma lógica de contagem regressiva de payment-status-client.tsx (TASK-005) — sobre o expiresAt real, sem inventar tempo. */
function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const target = new Date(expiresAt).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  if (now === null) {
    return <span className={styles.expiresValue}>{new Date(expiresAt).toLocaleTimeString("pt-BR")}</span>;
  }

  const remaining = target - now;
  if (remaining <= 0) {
    return <span className={styles.expiresValue}>Expirando...</span>;
  }

  const urgent = remaining < 2 * 60 * 1000;
  return (
    <span className={styles.expiresValue} data-urgent={urgent || undefined}>
      {formatCountdown(remaining)}
    </span>
  );
}

/**
 * Equivalente de PaymentStatusClient (pedido→cliente) para o contexto de
 * billing (comerciante→CaraffaStore) — mesma estrutura/CSS, texto
 * próprio: aqui não há "pedido" nem estoque a devolver, e a aprovação
 * ativa a LOJA (Server Component reage no próximo `router.refresh()`,
 * já que requireStoreStatus redireciona sozinho assim que status vira
 * "active").
 */
export function BillingStatusClient({
  status,
  planLabel,
  amountCents,
  qrCode,
  qrCodeBase64,
  ticketUrl,
  expiresAt,
}: {
  status: string;
  planLabel: string;
  amountCents: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const isPending = status === "pending" || status === "creating";
  const isApproved = status === "approved";
  const isReview = status === "manual_review";
  const isFailed = status === "rejected" || status === "cancelled" || status === "expired" || status === "error";

  return (
    <Card className={styles.card}>
      <div className={styles.statusBanner} data-tone={isApproved ? "success" : isFailed || isReview ? "danger" : "pending"}>
        <span className={styles.statusIcon}>{isApproved ? <IconCheck /> : isFailed || isReview ? null : <IconPix />}</span>
        <span className={styles.statusText}>{STATUS_LABEL[status] ?? status}</span>
      </div>

      <div className={styles.amountBlock}>
        <span className={styles.amountLabel}>Assinatura mensal</span>
        <span className={styles.amount}>{formatPriceCents(amountCents)}</span>
        <span className={styles.orderCode}>Plano {planLabel}</span>
      </div>

      {isApproved && (
        <div className={styles.alertGap}>
          <Alert tone="success" title="Assinatura confirmada!">
            Sua loja foi ativada — atualize a página para entrar no painel.
          </Alert>
        </div>
      )}
      {isReview && (
        <div className={styles.alertGap}>
          <Alert tone="danger" title="Pagamento em análise">
            Identificamos uma divergência nesta cobrança. Nossa equipe vai revisar — nenhuma ação é necessária agora.
          </Alert>
        </div>
      )}
      {isFailed && (
        <div className={styles.alertGap}>
          <Alert tone="danger">
            Este Pix não foi concluído ({STATUS_LABEL[status] ?? status}). Atualize a página para gerar uma nova cobrança.
          </Alert>
        </div>
      )}

      {isPending && qrCodeBase64 && (
        <div className={styles.qrFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${qrCodeBase64}`} alt="QR Code do Pix" width={240} height={240} className={styles.qrImage} />
        </div>
      )}

      {isPending && expiresAt && (
        <div className={styles.expiresRow}>
          <IconClock />
          Expira em <ExpiryCountdown expiresAt={expiresAt} />
        </div>
      )}

      {isPending && qrCode && (
        <div className={styles.copyPaste}>
          <label htmlFor="qrCodeCopyPaste" className={styles.copyLabel}>
            Pix Copia e Cola
          </label>
          <div className={styles.copyField}>
            <input id="qrCodeCopyPaste" readOnly value={qrCode} onFocus={(e) => e.currentTarget.select()} className={styles.copyInput} />
          </div>
          <Button
            type="button"
            size="lg"
            fullWidth
            icon={copied ? <IconCheck /> : <IconCopy />}
            onClick={async () => {
              await navigator.clipboard.writeText(qrCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copiado!" : "Copiar código"}
          </Button>
        </div>
      )}

      {isPending && ticketUrl && (
        <p className={styles.ticketLink}>
          <a href={ticketUrl} target="_blank" rel="noreferrer">
            Abrir no app do banco
          </a>
        </p>
      )}

      {(isPending || isApproved || isFailed) && (
        <Button
          type="button"
          variant="ghost"
          fullWidth
          loading={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          Atualizar status
        </Button>
      )}
    </Card>
  );
}
