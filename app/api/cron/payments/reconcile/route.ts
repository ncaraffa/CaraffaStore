import { NextResponse, type NextRequest } from "next/server";
import { runCronReconciliation } from "@/lib/payments/cron-reconcile";

/**
 * Protegida por CRON_SECRET (server-only, nunca NEXT_PUBLIC_) — comparada
 * em tempo constante não é necessário aqui (não é um segredo criptográfico
 * comparado byte a byte contra uma assinatura, é só um token de acesso à
 * rota; ainda assim a comparação de string simples do V8 já não vaza
 * timing utilizável na prática para strings deste tamanho/uso).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ message: "unauthorized" }, { status: 401 });
  }

  const summary = await runCronReconciliation();
  return NextResponse.json(summary, { status: 200 });
}
