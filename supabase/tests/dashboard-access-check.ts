/**
 * Regressão real (Supabase local, sem mock) para TASK008-PROP-001
 * (qa/reports/TASK-008-PROPAGATION-REVIEW.md): a home do dashboard
 * (app/dashboard/page.tsx) passou a chamar payment_settings_get para
 * QUALQUER membro da loja, mas a função só autoriza owner/admin
 * (can_manage_store_payments, supabase/migrations/0007_payments.sql) —
 * um membro staff (merchant-multi@example.test em Mercado Aurora,
 * scripts/seed-local.ts) sempre recebia `insufficient_privilege` e a
 * página inteira quebrava.
 *
 * Este teste NÃO mocka a parte que quebrou: assina de verdade como o
 * usuário staff contra o Supabase local e chama as MESMAS funções de
 * lib/ que a página usa (getDashboardSummary, getPaymentSettings),
 * documentando o contrato do qual a correção (role gating em
 * app/dashboard/page.tsx e app/dashboard/settings/payments/page.tsx)
 * depende:
 *   - getDashboardSummary precisa funcionar para QUALQUER role (staff
 *     inclusive) — é dado operacional do dia a dia, não financeiro.
 *   - getPaymentSettings continua propositalmente restrito a
 *     owner/admin; se algum dia deixar de lançar para staff, este teste
 *     falha e sinaliza que a checagem de role no app pode ter ficado
 *     desnecessária ou, pior, que a fronteira de privilégio mudou sem
 *     que o app soubesse.
 *
 * Também cobre TASK008-PROP-003 (agregação truncada em 300 pedidos):
 * confirma que getDashboardSummary devolve contagens/soma consistentes
 * com uma consulta direta ao banco, sem depender de nenhum `limit()`
 * artificial no meio do caminho.
 *
 * Como rodar:
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *   npx tsx supabase/tests/dashboard-access-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import { getDashboardSummary } from "../../lib/dashboard/service";
import { getPaymentSettings, PaymentSettingsError } from "../../lib/payments/settings-service";
import type { Database } from "../../lib/supabase/types";

const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";

const results: { label: string; pass: boolean; detail: string }[] = [];
function record(label: string, pass: boolean, detail: string) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}: ${detail}`);
}

function anonClient() {
  const env = getPublicSupabaseEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

async function signIn(email: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: DEV_ONLY_PASSWORD });
  if (error) throw new Error(`login falhou para ${email}: ${error.message}`);
  return client;
}

async function staffCanReadDashboardButNotPayments(storeAId: string) {
  const staff = await signIn("merchant-multi@example.test");

  const summary = await getDashboardSummary(staff, storeAId).catch((error) => {
    record(
      "staff (merchant-multi) consegue carregar getDashboardSummary de store-a",
      false,
      `lançou: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  });
  if (summary) {
    record(
      "staff (merchant-multi) consegue carregar getDashboardSummary de store-a",
      true,
      `ordersLast24h=${summary.ordersLast24h} pendingPixCount=${summary.pendingPixCount} revenueLast30dCents=${summary.revenueLast30dCents}`,
    );
  }

  let staffBlocked = false;
  let staffErrorCode = "";
  try {
    await getPaymentSettings(staff, storeAId);
  } catch (error) {
    staffBlocked = error instanceof PaymentSettingsError;
    staffErrorCode = error instanceof PaymentSettingsError ? error.code : String(error);
  }
  record(
    "staff (merchant-multi) NÃO consegue ler getPaymentSettings de store-a (can_manage_store_payments exige owner/admin)",
    staffBlocked,
    `code=${staffErrorCode}`,
  );
}

async function adminCanReadPayments(storeAId: string) {
  const admin = await signIn("admin-a@example.test");
  const settings = await getPaymentSettings(admin, storeAId).catch((error) => {
    record(
      "admin (admin-a) consegue ler getPaymentSettings de store-a",
      false,
      `lançou: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  });
  if (settings) {
    record(
      "admin (admin-a) consegue ler getPaymentSettings de store-a",
      true,
      `isConfigured=${settings.isConfigured} isEnabled=${settings.isEnabled}`,
    );
  }
}

async function revenueMatchesDirectQuery(adminClient: ReturnType<typeof createAdminSupabaseClient>, storeAId: string) {
  const admin = await signIn("admin-a@example.test");
  const summary = await getDashboardSummary(admin, storeAId);

  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: revenueRows, error } = await adminClient
    .from("orders")
    .select("total_cents")
    .eq("store_id", storeAId)
    .in("status", ["confirmed", "preparing", "ready", "completed"])
    .gte("created_at", thirtyDaysAgoIso);
  if (error) throw error;
  const expectedRevenue = (revenueRows ?? []).reduce((sum, row) => sum + row.total_cents, 0);

  record(
    "getDashboardSummary.revenueLast30dCents bate com soma direta no banco (sem corte de 300 pedidos)",
    summary.revenueLast30dCents === expectedRevenue,
    `service=${summary.revenueLast30dCents} banco=${expectedRevenue}`,
  );
}

async function main() {
  loadLocalEnv();
  const admin = createAdminSupabaseClient();

  const { data: storeA, error: storeAError } = await admin.from("stores").select("id,slug").eq("slug", "store-a").single();
  if (storeAError || !storeA) throw new Error("store-a não encontrada — rode npm run seed:local");

  await staffCanReadDashboardButNotPayments(storeA.id);
  await adminCanReadPayments(storeA.id);
  await revenueMatchesDirectQuery(admin, storeA.id);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log(
    "\nPASS - dashboard home funciona para qualquer role; leitura de payment settings permanece restrita a owner/admin; métricas de receita não são truncadas.",
  );
}

main().catch((error) => {
  console.error(`Teste de acesso ao dashboard falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
