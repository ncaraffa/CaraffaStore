/**
 * Seeds Loja A (Mercado Aurora) e Loja B (Empório Horizonte) num Supabase
 * local, exatamente como descrito em docs/TESTING.md. Dev-only: usa a
 * service role key e NUNCA deve ser apontado para um projeto com dados
 * reais.
 *
 * Uso:
 *   npx supabase start
 *   npx supabase db reset
 *   npm run seed:local
 */
import { loadLocalEnv } from "../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../lib/supabase/admin";
import { FIXTURE_PRODUCTS, FIXTURE_STORES, FIXTURE_USERS } from "../lib/data/fixtures";
import type { OnboardingStep, PlanCode, StoreStatus } from "../lib/supabase/types";
import { logSeedFailure, logSeedSummary } from "./seed-output";

/**
 * Usuários/lojas fictícios adicionais da TASK-002, cobrindo estados que o
 * fluxo público nunca alcança sozinho (`active`/`suspended`) e cenários
 * de retomada/múltiplos memberships — só para validar guards e
 * redirecionamentos em teste, nunca criados pelo onboarding real.
 */
const ONBOARDING_FIXTURE_USERS = {
  merchantOnboarding: { email: "merchant-onboarding@example.test" },
  merchantPending: { email: "merchant-pending@example.test" },
  merchantSuspended: { email: "merchant-suspended@example.test" },
  merchantMulti: { email: "merchant-multi@example.test" },
} as const;

// Usada apenas para satisfazer o requisito de senha do Supabase Auth ao
// criar os usuários fictícios locais — nunca impressa em log (ver
// scripts/seed-output.ts e qa/reports/TASK-001-RETEST-3.md,
// FINAL-BUG-002).
const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";

async function ensureUser(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  email: string,
): Promise<string> {
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing.users.find((u) => u.email === email);
  if (found) return found.id;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEV_ONLY_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar usuário ${email}: ${error?.message}`);
  }
  return data.user.id;
}

async function ensureStore(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  slug: string,
  name: string,
  options: { status?: StoreStatus; whatsapp?: string } = {},
): Promise<string> {
  const { data: existing } = await admin
    .from("stores")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    // Reaplica status/whatsapp em execuções seguintes, para o seed
    // continuar idempotente mesmo que um teste anterior tenha alterado
    // o estado da loja fixture (ex.: um teste que tenta suspender/
    // reativar via SQL direto).
    await admin
      .from("stores")
      .update({ status: options.status ?? "onboarding", whatsapp: options.whatsapp ?? null })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data, error } = await admin
    .from("stores")
    .insert({ slug, name, status: options.status, whatsapp: options.whatsapp })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao criar loja ${slug}: ${error?.message}`);
  }
  return data.id;
}

async function ensureMembership(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  storeId: string,
  userId: string,
  role: "owner" | "admin" | "staff",
) {
  await admin
    .from("store_members")
    .upsert({ store_id: storeId, user_id: userId, role }, { onConflict: "store_id,user_id" });
}

async function ensureProduct(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  storeId: string,
  name: string,
  stock: number,
) {
  await admin
    .from("products")
    .upsert({ store_id: storeId, name, stock }, { onConflict: "store_id,name" });
}

/**
 * Grava progresso de onboarding diretamente (via service role, bypassa
 * RLS) — só para fixture de teste "usuário no meio do onboarding". O
 * fluxo real nunca escreve nesta tabela fora das funções SQL
 * onboarding_save_X / onboarding_ensure_progress (ver 0002_auth_onboarding.sql).
 */
async function ensureOnboardingProgress(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
  patch: {
    step: OnboardingStep;
    merchantName?: string;
    whatsapp?: string;
    storeName?: string;
    slug?: string;
    planCode?: PlanCode;
  },
) {
  // Espelha a invariante real de onboarding_complete(): step="completed"
  // e completed_at preenchido sempre andam juntos (nunca um sem o
  // outro), mesmo nesta gravação direta via service role.
  await admin.from("onboarding_progress").upsert(
    {
      user_id: userId,
      step: patch.step,
      merchant_name: patch.merchantName ?? null,
      whatsapp: patch.whatsapp ?? null,
      store_name: patch.storeName ?? null,
      slug: patch.slug ?? null,
      plan_code: patch.planCode ?? null,
      completed_at: patch.step === "completed" ? new Date().toISOString() : null,
    },
    { onConflict: "user_id" },
  );
}

async function ensureStorePlan(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  storeId: string,
  planCode: PlanCode,
) {
  await admin
    .from("store_plans")
    .upsert({ store_id: storeId, plan_code: planCode }, { onConflict: "store_id" });
}

async function ensureMerchantProfile(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
  displayName: string,
) {
  await admin
    .from("merchant_profiles")
    .upsert({ user_id: userId, display_name: displayName }, { onConflict: "user_id" });
}

async function main() {
  // `tsx scripts/seed-local.ts` roda fora do runtime do Next.js, que é
  // quem normalmente carrega .env.local sozinho (next dev/build/start).
  // Sem esta chamada explícita, o script só funcionaria se as variáveis
  // já estivessem exportadas manualmente no shell.
  const { loadedEnvFiles } = loadLocalEnv();
  if (loadedEnvFiles.length > 0) {
    console.log(`Ambiente carregado de: ${loadedEnvFiles.join(", ")}\n`);
  }

  const admin = createAdminSupabaseClient();

  const adminAId = await ensureUser(admin, FIXTURE_USERS.adminA.email);
  const clienteAId = await ensureUser(admin, FIXTURE_USERS.clienteA.email);
  const adminBId = await ensureUser(admin, FIXTURE_USERS.adminB.email);
  const clienteBId = await ensureUser(admin, FIXTURE_USERS.clienteB.email);

  // `active`: representam lojas já "operando" para os testes de
  // isolamento de produto da TASK-001 — só seed pode gravar este status,
  // o fluxo público de onboarding nunca alcança `active` (T2-DEC-006).
  const storeAId = await ensureStore(admin, FIXTURE_STORES.storeA.slug, FIXTURE_STORES.storeA.name, {
    status: "active",
  });
  const storeBId = await ensureStore(admin, FIXTURE_STORES.storeB.slug, FIXTURE_STORES.storeB.name, {
    status: "active",
  });

  // Só admin-a/admin-b são membros de staff — cliente-a/cliente-b ficam
  // sem vínculo de propósito, representando clientes finais autenticados.
  await ensureMembership(admin, storeAId, adminAId, "admin");
  await ensureMembership(admin, storeBId, adminBId, "admin");

  // Lojas `active` só existem, na realidade, depois de terem passado
  // pelo onboarding (que sempre grava um plano atomicamente) — mantém
  // essa mesma invariante nas fixtures.
  await ensureStorePlan(admin, storeAId, 50);
  await ensureStorePlan(admin, storeBId, 80);

  for (const product of FIXTURE_PRODUCTS) {
    const storeId =
      product.storeId === FIXTURE_STORES.storeA.id ? storeAId : storeBId;
    await ensureProduct(admin, storeId, product.name, product.stock);
  }

  // ============================================================
  // Fixtures da TASK-002: estados de onboarding/pagamento e múltiplos
  // memberships. `active`/`suspended` aqui são gravados SÓ pelo seed
  // (service role) — nunca alcançáveis pelo fluxo público real.
  // ============================================================

  const merchantOnboardingId = await ensureUser(admin, ONBOARDING_FIXTURE_USERS.merchantOnboarding.email);
  await ensureOnboardingProgress(admin, merchantOnboardingId, {
    step: "slug",
    merchantName: "Comerciante Em Andamento",
    whatsapp: "+5511900000001",
    storeName: "Loja Em Andamento",
    // slug/plano deliberadamente ausentes: fixture de retomada no meio
    // do fluxo (etapa "slug" é a próxima incompleta).
  });

  const merchantPendingId = await ensureUser(admin, ONBOARDING_FIXTURE_USERS.merchantPending.email);
  const pendingStoreId = await ensureStore(admin, "loja-pendente-fixture", "Loja Pendente Fixture", {
    status: "pending_payment",
    whatsapp: "+5511900000002",
  });
  await ensureMembership(admin, pendingStoreId, merchantPendingId, "owner");
  await ensureStorePlan(admin, pendingStoreId, 30);
  await ensureMerchantProfile(admin, merchantPendingId, "Comerciante Pendente");
  await ensureOnboardingProgress(admin, merchantPendingId, {
    step: "completed",
    merchantName: "Comerciante Pendente",
    whatsapp: "+5511900000002",
    storeName: "Loja Pendente Fixture",
    slug: "loja-pendente-fixture",
    planCode: 30,
  });

  const merchantSuspendedId = await ensureUser(admin, ONBOARDING_FIXTURE_USERS.merchantSuspended.email);
  const suspendedStoreId = await ensureStore(admin, "loja-suspensa-fixture", "Loja Suspensa Fixture", {
    status: "suspended",
    whatsapp: "+5511900000003",
  });
  await ensureMembership(admin, suspendedStoreId, merchantSuspendedId, "owner");
  await ensureStorePlan(admin, suspendedStoreId, 50);
  await ensureMerchantProfile(admin, merchantSuspendedId, "Comerciante Suspenso");

  // owner da própria loja E também staff da Loja A — testa o seletor
  // explícito de múltiplas lojas (nunca escolher a primeira em silêncio).
  const merchantMultiId = await ensureUser(admin, ONBOARDING_FIXTURE_USERS.merchantMulti.email);
  const multiStoreId = await ensureStore(admin, "loja-multi-fixture", "Loja Multi Fixture", {
    status: "pending_payment",
    whatsapp: "+5511900000004",
  });
  await ensureMembership(admin, multiStoreId, merchantMultiId, "owner");
  await ensureStorePlan(admin, multiStoreId, 80);
  await ensureMerchantProfile(admin, merchantMultiId, "Comerciante Multi-loja");
  await ensureMembership(admin, storeAId, merchantMultiId, "staff");

  logSeedSummary({
    adminAId,
    adminBId,
    clienteAId,
    clienteBId,
    storeAId,
    storeBId,
    merchantOnboardingId,
    merchantPendingId,
    pendingStoreId,
    merchantSuspendedId,
    suspendedStoreId,
    merchantMultiId,
    multiStoreId,
  });
}

main().catch((error) => {
  logSeedFailure(error);
  process.exitCode = 1;
});
