/**
 * Regressão real (Supabase local, sem mock) para TASK008-RETEST-DATA-001
 * (qa/reports/TASK-008-PROPAGATION-RETEST.md): `sumRevenueLast30d`
 * (lib/dashboard/service.ts) pagina pedidos em blocos de 1000 via
 * `.range()`, mas sem `ORDER BY` estável — sob escrita concorrente,
 * OFFSET sem ordenação determinística pode pular ou repetir linha entre
 * páginas.
 *
 * Este teste insere 2000 pedidos reais (não mock) diretamente via
 * service_role, incluindo um lote com `created_at` IDÊNTICO (para
 * estressar o empate que só `created_at` sozinho não resolve — por isso
 * a correção desempata com `id`), mede o delta de
 * `getDashboardSummary().revenueLast30dCents` antes/depois, e confirma
 * que bate exatamente com `2000 * 100` centavos — nem a mais (duplicação
 * de página) nem a menos (omissão de página). Cobre >1000 (força pelo
 * menos 3 páginas de 1000 já que aqui são 2000 linhas).
 *
 * Como rodar:
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *   npx tsx supabase/tests/dashboard-revenue-pagination-check.ts
 */
import { randomUUID } from "node:crypto";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getDashboardSummary } from "../../lib/dashboard/service";

const ORDER_COUNT = 2000;
const SAME_TIMESTAMP_COUNT = 400; // força empate real de created_at entre páginas
const CENTS_PER_ORDER = 100;
const MARKER = `qa-data-001-${Date.now()}`;

const results: { label: string; pass: boolean; detail: string }[] = [];
function record(label: string, pass: boolean, detail: string) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}: ${detail}`);
}

async function main() {
  loadLocalEnv();
  const admin = createAdminSupabaseClient();

  const { data: storeA, error: storeAError } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (storeAError || !storeA) throw new Error("store-a não encontrada — rode npm run seed:local");

  const before = await getDashboardSummary(admin, storeA.id);

  const now = Date.now();
  const sharedTimestampIso = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

  const rows = Array.from({ length: ORDER_COUNT }, (_, i) => {
    // Os primeiros SAME_TIMESTAMP_COUNT compartilham o MESMO created_at —
    // é exatamente o cenário em que OFFSET sem desempate por `id` pode
    // pular ou repetir linha entre páginas de 1000.
    const createdAt =
      i < SAME_TIMESTAMP_COUNT ? sharedTimestampIso : new Date(now - (3 + (i % 20)) * 24 * 60 * 60 * 1000).toISOString();
    return {
      store_id: storeA.id,
      public_code: `Q${MARKER.slice(-6)}${i.toString(36).padStart(4, "0")}`.toUpperCase().slice(0, 20),
      idempotency_key: randomUUID(),
      request_fingerprint: MARKER,
      customer_name: `Cliente ${MARKER}`,
      customer_phone: "+5511999990000",
      fulfillment_method: "pickup" as const,
      status: "confirmed" as const,
      payment_mode: "manual" as const,
      subtotal_cents: CENTS_PER_ORDER,
      total_cents: CENTS_PER_ORDER,
      created_at: createdAt,
      updated_at: createdAt,
    };
  });

  console.log(`Inserindo ${ORDER_COUNT} pedidos temporários (marcador ${MARKER})...`);
  const INSERT_BATCH = 500;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const { error } = await admin.from("orders").insert(batch);
    if (error) throw new Error(`insert falhou no lote ${i}: ${error.message}`);
  }

  try {
    const after = await getDashboardSummary(admin, storeA.id);
    const delta = after.revenueLast30dCents - before.revenueLast30dCents;
    const expectedDelta = ORDER_COUNT * CENTS_PER_ORDER;

    record(
      `revenueLast30dCents inclui exatamente os ${ORDER_COUNT} pedidos inseridos (>1000, 3+ páginas de 1000, com ${SAME_TIMESTAMP_COUNT} created_at empatados)`,
      delta === expectedDelta,
      `delta=${delta} esperado=${expectedDelta}`,
    );

    const { count: directCount, error: countError } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("request_fingerprint", MARKER);
    if (countError) throw countError;
    record(
      `todas as ${ORDER_COUNT} linhas inseridas existem no banco (sem falha silenciosa de insert)`,
      directCount === ORDER_COUNT,
      `banco=${directCount}`,
    );
  } finally {
    console.log("Removendo pedidos temporários...");
    const { error: deleteError } = await admin.from("orders").delete().eq("request_fingerprint", MARKER);
    if (deleteError) {
      console.error(`ATENÇÃO: cleanup falhou (marcador ${MARKER}): ${deleteError.message}`);
    } else {
      console.log("cleanup=ok");
    }
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log(
    "\nPASS - paginação de receita com ORDER BY estável (created_at, id) não pula nem duplica linha sob volume >1000 com timestamps empatados.",
  );
}

main().catch((error) => {
  console.error(`Teste de paginação de receita falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
