/**
 * Cookie HttpOnly que carrega o token de recibo bruto (nunca o hash) —
 * escopo (`path`) restrito à rota do próprio pedido, então nenhuma outra
 * página do navegador consegue lê-lo nem enviá-lo sem querer. Only o
 * HASH do valor é persistido (orders.receipt_token_hash,
 * supabase/migrations/0007_payments.sql) — comparado server-side por
 * lib/payments/service-only/payment-page-reader.ts.
 */
export const RECEIPT_COOKIE_NAME = "pix_receipt";
export const RECEIPT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

export function receiptCookiePath(storeSlug: string, publicCode: string): string {
  return `/loja/${storeSlug}/pedido/${publicCode}`;
}
