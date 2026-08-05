import { NextResponse, type NextRequest } from "next/server";
import { handleMercadoPagoWebhook } from "@/lib/payments/webhook-handler";

// Runtime Node.js explícito: a validação de assinatura HMAC usa
// node:crypto (lib/payments/gateway/webhook-signature.ts), incompatível
// com o Edge Runtime. Declarado explicitamente para não depender do
// padrão implícito da plataforma de deploy.
export const runtime = "nodejs";

/**
 * Notificação de pagamento Pix do Mercado Pago. Rota pública por natureza
 * (o provedor não tem sessão nossa) — `client` (webhook_key) na query só
 * localiza a config candidata; a autenticidade real vem da validação de
 * `x-signature` dentro de handleMercadoPagoWebhook (nunca confia no corpo
 * sozinho). Nunca loga headers, corpo, Access Token nem Webhook Secret —
 * qualquer erro aqui só produz um status HTTP, nenhum detalhe interno.
 */
export async function POST(request: NextRequest) {
  const webhookKey = request.nextUrl.searchParams.get("client");
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  let action: string | null = null;
  let dataId: string | null = null;
  try {
    const body = (await request.json()) as { action?: string; type?: string; data?: { id?: string | number } };
    action = body.action ?? body.type ?? null;
    dataId = body.data?.id !== undefined && body.data?.id !== null ? String(body.data.id) : null;
  } catch {
    return NextResponse.json({ message: "invalid_request" }, { status: 400 });
  }

  // O Mercado Pago também manda o id do pagamento como query string
  // (`data.id`/`id`) em alguns formatos de notificação — usa como reserva
  // quando o corpo não traz `data.id`.
  if (!dataId) {
    dataId = request.nextUrl.searchParams.get("data.id") ?? request.nextUrl.searchParams.get("id");
  }

  const result = await handleMercadoPagoWebhook({ webhookKey, xSignature, xRequestId, action, dataId });
  return NextResponse.json(result.body, { status: result.status });
}
