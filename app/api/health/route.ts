import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

// Runtime Node.js explícito — mesma decisão das outras rotas sensíveis
// (webhook/cron); sem dependência real de Edge aqui, mas mantém o padrão.
export const runtime = "nodejs";

/**
 * Health/readiness check público e seguro: confirma que a aplicação está
 * respondendo e que o banco está alcançável, sem expor nada sensível
 * (sem versão de dependência, stack, segredos, dados de loja). Consulta
 * deliberadamente leve — uma única linha de uma tabela pública, nunca uma
 * varredura ou contagem pesada.
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  let databaseReachable = false;
  try {
    const env = getPublicSupabaseEnv();
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Tabela pública mínima (RLS permite select de lojas `active` a
    // qualquer um, supabase/migrations/0005_catalog.sql) — só prova que a
    // conexão/rede/autenticação com o Postgres funcionam.
    const { error } = await supabase.from("stores").select("id").limit(1);
    databaseReachable = !error;
  } catch {
    databaseReachable = false;
  }

  const checks = { app: true, database: databaseReachable };
  const healthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", timestamp, checks },
    { status: healthy ? 200 : 503 },
  );
}
