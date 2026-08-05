"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPriceCents } from "@/lib/catalog/format";

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
    <section>
      <p>Valor: {formatPriceCents(amountCents)}</p>
      <p>
        Status: <span className="badge">{STATUS_LABEL[status] ?? status}</span>
      </p>

      {isApproved && <p className="form-status" data-tone="success">Pagamento confirmado! O comerciante já foi avisado.</p>}
      {isFailed && (
        <p className="form-status" data-tone="error">
          Este Pix não foi concluído ({STATUS_LABEL[status] ?? status}). O estoque reservado já foi devolvido.
        </p>
      )}

      {isPending && qrCodeBase64 && (
        <div>
          <img
            src={`data:image/png;base64,${qrCodeBase64}`}
            alt="QR Code do Pix"
            width={240}
            height={240}
          />
        </div>
      )}

      {isPending && qrCode && (
        <div className="form-field">
          <label htmlFor="qrCodeCopyPaste">Pix Copia e Cola</label>
          <textarea id="qrCodeCopyPaste" readOnly value={qrCode} rows={4} onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(qrCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copiado!" : "Copiar código"}
          </button>
        </div>
      )}

      {isPending && ticketUrl && (
        <p>
          <a href={ticketUrl} target="_blank" rel="noreferrer">
            Abrir no app do banco
          </a>
        </p>
      )}

      {isPending && expiresAt && <p>Expira em: {new Date(expiresAt).toLocaleString("pt-BR")}</p>}

      {isPending && (
        <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
          {pending ? "Atualizando..." : "Atualizar status"}
        </button>
      )}
    </section>
  );
}
