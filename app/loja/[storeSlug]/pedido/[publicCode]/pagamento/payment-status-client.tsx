"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPriceCents } from "@/lib/catalog/format";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Textarea } from "@/components/ui/Textarea";
import { IconCopy, IconCheck } from "@/components/ui/icons";
import styles from "./payment.module.css";

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

const STATUS_TONE: Record<string, BadgeTone> = {
  creating: "warning",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  expired: "neutral",
  error: "danger",
  manual_review: "danger",
};

export function PaymentStatusClient({
  status,
  amountCents,
  qrCode,
  qrCodeBase64,
  ticketUrl,
  expiresAt,
}: {
  status: string;
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
  const isFailed = status === "rejected" || status === "cancelled" || status === "expired" || status === "error";

  return (
    <Card>
      <div className={styles.amountRow}>
        <span className={styles.amountLabel}>Valor</span>
        <span className={styles.amount}>{formatPriceCents(amountCents)}</span>
      </div>

      <div className={styles.statusRow}>
        <span className={styles.amountLabel}>Status</span>
        <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>
      </div>

      {isApproved && (
        <div className={styles.alertGap}>
          <Alert tone="success" title="Pagamento confirmado!">
            O comerciante já foi avisado.
          </Alert>
        </div>
      )}
      {isFailed && (
        <div className={styles.alertGap}>
          <Alert tone="danger">
            Este Pix não foi concluído ({STATUS_LABEL[status] ?? status}). O estoque reservado já foi devolvido.
          </Alert>
        </div>
      )}

      {isPending && qrCodeBase64 && (
        <div className={styles.qrWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${qrCodeBase64}`} alt="QR Code do Pix" width={240} height={240} className={styles.qrImage} />
        </div>
      )}

      {isPending && qrCode && (
        <div className={styles.copyPaste}>
          <label htmlFor="qrCodeCopyPaste" className={styles.copyLabel}>
            Pix Copia e Cola
          </label>
          <Textarea id="qrCodeCopyPaste" readOnly value={qrCode} rows={3} onFocus={(e) => e.currentTarget.select()} />
          <Button
            type="button"
            variant="outline"
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

      {isPending && expiresAt && (
        <p className={styles.expiresAt}>Expira em: {new Date(expiresAt).toLocaleString("pt-BR")}</p>
      )}

      {isPending && (
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
