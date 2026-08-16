import { NextResponse, type NextRequest } from "next/server";
import { runBillingSuspendOverdueStores } from "@/lib/billing/suspend-overdue";

export const runtime = "nodejs";

/**
 * Mesmo padrão de app/api/cron/payments/reconcile/route.ts — protegida por
 * CRON_SECRET (server-only, nunca NEXT_PUBLIC_), GET e POST fazem a mesma
 * coisa (Vercel Cron chama via GET com `Authorization: Bearer
 * $CRON_SECRET` automático; POST fica disponível para acionamento
 * manual/outros agendadores). Roda 1x/dia (vercel.json) — a suspensão em
 * si é idempotente (billing_suspend_overdue_stores só casa lojas
 * status=active), então rodar de novo no mesmo dia não tem efeito extra.
 */
async function handleSuspendOverdue(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ message: "unauthorized" }, { status: 401 });
  }

  const summary = await runBillingSuspendOverdueStores();
  return NextResponse.json(summary, { status: 200 });
}

export async function GET(request: NextRequest) {
  return handleSuspendOverdue(request);
}

export async function POST(request: NextRequest) {
  return handleSuspendOverdue(request);
}
