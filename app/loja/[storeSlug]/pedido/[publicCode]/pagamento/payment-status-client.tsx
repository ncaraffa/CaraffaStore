"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPriceCents } from "@/lib/catalog/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { IconCheck, IconClock, IconCopy, IconPix } from "@/components/ui/icons";
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

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Contagem regressiva sobre o `expiresAt` real do pedido — não inventa
 *  tempo, só reformata o mesmo timestamp já exibido, atualizando a cada
 *  segundo em vez de ficar estático até a próxima atualização manual. */
function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const target = new Date(expiresAt).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Sem chamada síncrona a setNow aqui (regra react-hooks/set-state-in-
    // effect): o primeiro tick do relógio chega com o intervalo, até 1s
    // depois da montagem — troca imperceptível vinda do fallback estático.
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  // Antes da hidratação, mostra só a hora — evita mismatch de SSR (o
  // servidor não sabe "agora" do cliente).
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

export function PaymentStatusClient({
  publicCode,
  status,
  amountCents,
  qrCode,
  qrCodeBase64,
  ticketUrl,
  expiresAt,
}: {
  publicCode: string;
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
    <Card className={styles.card}>
      {/* Estado em destaque no topo — é a primeira coisa que precisa
          ficar óbvia numa tela onde há dinheiro real envolvido. */}
      <div className={styles.statusBanner} data-tone={isApproved ? "success" : isFailed ? "danger" : "pending"}>
        <span className={styles.statusIcon}>{isApproved ? <IconCheck /> : isFailed ? null : <IconPix />}</span>
        <span className={styles.statusText}>{STATUS_LABEL[status] ?? status}</span>
      </div>

      <div className={styles.amountBlock}>
        <span className={styles.amountLabel}>Valor do pedido</span>
        <span className={styles.amount}>{formatPriceCents(amountCents)}</span>
        <span className={styles.orderCode}>Pedido #{publicCode}</span>
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
