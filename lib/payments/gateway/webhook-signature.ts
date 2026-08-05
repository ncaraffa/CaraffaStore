import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validação da assinatura de webhook do Mercado Pago, seguindo o formato
 * documentado: header `x-signature: ts=<timestamp>,v1=<hash hex>`, HMAC-
 * SHA256 sobre o manifest `id:<data.id em minúsculas>;request-id:<x-
 * request-id>;ts:<ts>;` (a parte `request-id` é omitida do manifest se o
 * header não vier, o que a própria documentação prevê para alguns tipos
 * de notificação). Não lê nem armazena segredo algum — recebe o Webhook
 * Secret já descriptografado como parâmetro, chamado só por
 * app/api/webhooks/mercado-pago/route.ts.
 *
 * Comparação em tempo constante (timingSafeEqual) para não vazar o hash
 * esperado por diferença de tempo de resposta.
 */

export interface ParsedSignatureHeader {
  ts: string;
  v1: string;
}

export function parseSignatureHeader(header: string | null): ParsedSignatureHeader | null {
  if (!header) return null;
  const parts = header.split(",").map((part) => part.trim());
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

export function buildSignatureManifest(params: { dataId: string; requestId: string | null; ts: string }): string {
  const id = params.dataId.toLowerCase();
  const requestIdPart = params.requestId ? `request-id:${params.requestId};` : "";
  return `id:${id};${requestIdPart}ts:${params.ts};`;
}

export function computeSignature(manifest: string, secret: string): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

export function verifyMercadoPagoWebhookSignature(params: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}): boolean {
  if (!params.dataId) return false;
  const parsed = parseSignatureHeader(params.xSignature);
  if (!parsed) return false;

  const manifest = buildSignatureManifest({ dataId: params.dataId, requestId: params.xRequestId, ts: parsed.ts });
  const expected = computeSignature(manifest, params.secret);

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(parsed.v1, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
