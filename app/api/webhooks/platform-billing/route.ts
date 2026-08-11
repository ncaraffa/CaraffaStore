import { NextResponse, type NextRequest } from "next/server";
import { handlePlatformBillingWebhook } from "@/lib/billing/webhook-handler";
import { resolveWebhookDataId } from "./resolve-data-id";

// Runtime Node.js explícito: a validação de assinatura HMAC usa
// node:crypto, incompatível com o Edge Runtime — mesmo motivo de
// app/api/webhooks/mercado-pago/route.ts.
export const runtime = "nodejs";

/**
 * Notificação de pagamento Pix da assinatura da PRÓPRIA CaraffaStore
 * (cobrança ao comerciante) — URL dedicada, nunca a mesma de
 * /api/webhooks/mercado-pago (que é o Pix da loja para o cliente final).
 * Rota pública por natureza (o provedor não tem sessão nossa); a
 * autenticidade real vem da validação de `x-signature` dentro de
 * handlePlatformBillingWebhook, com o Webhook Secret da própria
 * plataforma. Nunca loga headers, corpo, Access Token nem Webhook
 * Secret — qualquer erro aqui só produz um status HTTP.
 */
export async function POST(request: NextRequest) {
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  let action: string | null = null;
  let bodyDataId: string | null = null;
  try {
    const body = (await request.json()) as { action?: string; type?: string; data?: { id?: string | number } };
    action = body.action ?? body.type ?? null;
    bodyDataId = body.data?.id !== undefined && body.data?.id !== null ? String(body.data.id) : null;
  } catch {
    return NextResponse.json({ message: "invalid_request" }, { status: 400 });
  }

  const queryDataId = request.nextUrl.searchParams.get("data.id") ?? request.nextUrl.searchParams.get("id");
  const { dataId, inconsistent } = resolveWebhookDataId(queryDataId, bodyDataId);
  if (inconsistent) {
    return NextResponse.json({ message: "invalid_request" }, { status: 400 });
  }

  const result = await handlePlatformBillingWebhook({ xSignature, xRequestId, action, dataId });
  return NextResponse.json(result.body, { status: result.status });
}
