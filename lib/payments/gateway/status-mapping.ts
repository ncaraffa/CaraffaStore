import type { InternalPaymentStatus } from "./types";

/**
 * Mapeia o status bruto do Mercado Pago para o vocabulário interno
 * (order_payments.status, supabase/migrations/0007_payments.sql — só a
 * fatia que representa "onde o dinheiro está", nunca creating/error/
 * manual_review, que são decididos pela orquestração, não pelo provedor).
 *
 * O Pix expirado não tem status próprio na API do Mercado Pago — chega
 * como status=cancelled com status_detail mencionando expiração. Essa
 * distinção é best-effort (substring case-insensitive); se a API mudar o
 * texto exato, o pior caso é classificar como "cancelled" em vez de
 * "expired" — o pedido ainda é cancelado e o estoque ainda é devolvido
 * corretamente, só o rótulo interno fica menos preciso. Documentado como
 * limitação não bloqueante (ver relatório final da TASK-005).
 *
 * refunded/charged_back/status desconhecido: fora do escopo desta tarefa
 * (sem reembolso/chargeback) — nunca decide um estado terminal sozinho,
 * fica "pending" (a reconciliação seguinte tenta de novo; se a divergência
 * for real, amount/external_reference/terminal-conflict em
 * pix_payment_apply_provider_state cobre o caso como manual_review).
 */
export function mapProviderStatusToInternal(status: string, statusDetail: string | null): InternalPaymentStatus {
  const detail = (statusDetail ?? "").toLowerCase();

  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return detail.includes("expired") || detail.includes("expir") ? "expired" : "cancelled";
    case "pending":
    case "in_process":
    case "authorized":
    case "in_mediation":
      return "pending";
    default:
      return "pending";
  }
}
