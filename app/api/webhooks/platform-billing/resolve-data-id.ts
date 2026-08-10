/**
 * Lógica pura de resolução do `data.id` da notificação de billing —
 * separada de route.ts (que importa `next/server`) pelo mesmo motivo de
 * lib/payments/gateway/select-mode.ts: fica testável fora do runtime do
 * Next.js.
 *
 * QA-FINAL-005 (achado no QA independente): o `data.id` do QUERY
 * PARAMETER é a fonte de verdade — alinhado ao formato real de
 * notificação do Mercado Pago. Query e body presentes e DIVERGENTES
 * nunca são resolvidos escolhendo um dos dois: `inconsistent: true`
 * sinaliza pra route.ts rejeitar a notificação inteira, antes de
 * qualquer validação de assinatura ou reconciliação.
 */
export interface ResolvedWebhookDataId {
  dataId: string | null;
  inconsistent: boolean;
}

export function resolveWebhookDataId(queryDataId: string | null, bodyDataId: string | null): ResolvedWebhookDataId {
  if (queryDataId && bodyDataId && queryDataId !== bodyDataId) {
    return { dataId: null, inconsistent: true };
  }
  return { dataId: queryDataId ?? bodyDataId, inconsistent: false };
}
