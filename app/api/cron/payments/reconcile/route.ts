import { NextResponse, type NextRequest } from "next/server";
import { runCronReconciliation } from "@/lib/payments/cron-reconcile";

// Runtime Node.js explícito: a reconciliação descriptografa credenciais
// via node:crypto (lib/payments/crypto-core.ts), incompatível com o Edge
// Runtime. Declarado explicitamente para não depender do padrão implícito
// da plataforma de deploy.
export const runtime = "nodejs";

/**
 * Protegida por CRON_SECRET (server-only, nunca NEXT_PUBLIC_) — comparada
 * em tempo constante não é necessário aqui (não é um segredo criptográfico
 * comparado byte a byte contra uma assinatura, é só um token de acesso à
 * rota; ainda assim a comparação de string simples do V8 já não vaza
 * timing utilizável na prática para strings deste tamanho/uso).
 *
 * GET e POST fazem exatamente a mesma coisa: os Vercel Cron Jobs invocam
 * a URL agendada em vercel.json via GET (com `Authorization: Bearer
 * $CRON_SECRET` adicionado automaticamente pela plataforma quando a env
 * var `CRON_SECRET` está configurada no projeto); POST fica disponível
 * para acionamento manual/outros agendadores externos.
 */
async function handleReconcile(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ message: "unauthorized" }, { status: 401 });
  }

  const summary = await runCronReconciliation();
  return NextResponse.json(summary, { status: 200 });
}

export async function GET(request: NextRequest) {
  return handleReconcile(request);
}

export async function POST(request: NextRequest) {
  return handleReconcile(request);
}
