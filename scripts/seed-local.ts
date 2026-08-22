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
 *
 * ============================================================
 * COMO AS LOJAS FIXTURE SÃO CRIADAS (e por que não por INSERT)
 * ============================================================
 *
 * Desde a TASK-012 a loja pertence a um workspace
 * (`stores.workspace_id` NOT NULL), e a migration 0021 revogou
 * INSERT/UPDATE/DELETE de `workspaces`, `workspace_subscriptions` e
 * `workspace_members` de TODOS os roles — inclusive `service_role`.
 * Foi a correção de um furo real (TRUNCATE cross-tenant por qualquer
 * conta autenticada), e `Insert: never` em lib/supabase/types.ts
 * documenta a mesma decisão no TypeScript.
 *
 * Por isso o seed não insere loja direto: ele percorre o MESMO caminho
 * do comerciante real — preenche o onboarding e chama
 * onboarding_complete() autenticado como o próprio usuário fixture, que
 * cria workspace, assinatura, loja, store_members e o assento do dono
 * numa transação só (ver provisionStoreViaOnboarding).
 *
 * Efeito colateral bom: se o onboarding real quebrar, o seed quebra
 * junto — em vez de mascarar o problema com um INSERT que a aplicação
 * nunca faz.
 */
import { loadLocalEnv } from "../lib/env/load-local-env";
import { assertLocalOnlyScript } from "../lib/env/local-only-guard";
import { createClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../lib/supabase/env";
import type { Database } from "../lib/supabase/types";
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

/**
 * Provisiona a loja pelo MESMO caminho que a aplicação usa de verdade:
 * preenche o onboarding e chama onboarding_complete() autenticado como o
 * próprio comerciante.
 *
 * Por que não inserir direto: desde a TASK-012 a loja pertence a um
 * workspace (stores.workspace_id NOT NULL), e a migration 0021 revogou
 * INSERT/UPDATE/DELETE de workspaces / workspace_subscriptions /
 * workspace_members de TODOS os roles, inclusive service_role — correção
 * de um furo real de TRUNCATE cross-tenant. Reabrir esses grants só para
 * o seed passar trocaria uma barreira de produção por conveniência de
 * teste.
 *
 * onboarding_complete() é SECURITY DEFINER e faz numa transação só o que
 * o seed precisa: workspace, assinatura, loja, store_members,
 * workspace_members (o assento do dono), store_plans e o perfil. Usá-la
 * aqui tem um efeito colateral bom: se o fluxo real de onboarding
 * quebrar, o seed quebra junto, em vez de mascarar com um INSERT que a
 * aplicação nunca faz.
 *
 * O login usa a senha dev-only já criada por ensureUser — nenhum
 * privilégio novo, nenhum segredo adicional.
 */
async function provisionStoreViaOnboarding(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  params: {
    email: string;
    userId: string;
    slug: string;
    storeName: string;
    merchantName: string;
    whatsapp: string;
    planCode: PlanCode;
  },
): Promise<string> {
  const { data: existing } = await admin.from("stores").select("id").eq("slug", params.slug).maybeSingle();
  if (existing) return existing.id;

  // O onboarding precisa estar completo em dados, mas ainda não marcado
  // como concluído — é onboarding_complete() quem fecha a etapa.
  await ensureOnboardingProgress(admin, params.userId, {
    step: "review",
    merchantName: params.merchantName,
    whatsapp: params.whatsapp,
    storeName: params.storeName,
    slug: params.slug,
    planCode: params.planCode,
  });

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicSupabaseEnv();
  const asMerchant = createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: signInError } = await asMerchant.auth.signInWithPassword({
    email: params.email,
    password: DEV_ONLY_PASSWORD,
  });
  if (signInError) {
    throw new Error(`Falha ao autenticar ${params.email} para o onboarding: ${signInError.message}`);
  }

  const { data: store, error } = await asMerchant.rpc("onboarding_complete");
  if (error || !store) {
    throw new Error(`Falha ao provisionar loja ${params.slug} via onboarding_complete: ${error?.message}`);
  }

  await asMerchant.auth.signOut();
  return store.id;
}

/**
 * Ajusta o status da loja depois do provisionamento.
 *
 * onboarding_complete() sempre entrega `pending_payment` — é o estado
 * real de quem acabou de escolher o plano. `active`/`suspended` só
 * existem depois de pagamento aprovado ou ação administrativa, e o fluxo
 * público nunca os alcança (T2-DEC-006). Aqui o seed grava direto, via
 * service_role, porque é exatamente para isso que a fixture existe:
 * cobrir estados que o onboarding sozinho não produz.
 */
async function setStoreStatus(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  storeId: string,
  status: StoreStatus,
  whatsapp?: string,
) {
  await admin.from("stores").update({ status, whatsapp: whatsapp ?? null }).eq("id", storeId);
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

  // Barreira de segurança (Fase 3, TASK-006): nunca deve rodar contra
  // produção — ver lib/env/local-only-guard.ts.
  assertLocalOnlyScript("seed-local");

  const admin = createAdminSupabaseClient();

  const adminAId = await ensureUser(admin, FIXTURE_USERS.adminA.email);
  const clienteAId = await ensureUser(admin, FIXTURE_USERS.clienteA.email);
  const adminBId = await ensureUser(admin, FIXTURE_USERS.adminB.email);
  const clienteBId = await ensureUser(admin, FIXTURE_USERS.clienteB.email);

  // `active`: representam lojas já "operando" para os testes de
  // isolamento de produto da TASK-001 — só seed pode gravar este status,
  // o fluxo público de onboarding nunca alcança `active` (T2-DEC-006).
  const storeAId = await provisionStoreViaOnboarding(admin, {
    email: FIXTURE_USERS.adminA.email,
    userId: adminAId,
    slug: FIXTURE_STORES.storeA.slug,
    storeName: FIXTURE_STORES.storeA.name,
    merchantName: "Admin Loja A",
    whatsapp: "+5511900000010",
    planCode: 50,
  });
  const storeBId = await provisionStoreViaOnboarding(admin, {
    email: FIXTURE_USERS.adminB.email,
    userId: adminBId,
    slug: FIXTURE_STORES.storeB.slug,
    storeName: FIXTURE_STORES.storeB.name,
    merchantName: "Admin Loja B",
    whatsapp: "+5511900000011",
    planCode: 80,
  });

  // onboarding_complete() entrega a loja em pending_payment; a fixture
  // precisa dela `active` para os testes de isolamento da TASK-001.
  await setStoreStatus(admin, storeAId, "active");
  await setStoreStatus(admin, storeBId, "active");

  // cliente-a/cliente-b ficam sem vínculo de propósito, representando
  // clientes finais autenticados sem acesso administrativo.

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
  // pending_payment é justamente o estado que onboarding_complete()
  // entrega — esta fixture não precisa de ajuste depois.
  const pendingStoreId = await provisionStoreViaOnboarding(admin, {
    email: ONBOARDING_FIXTURE_USERS.merchantPending.email,
    userId: merchantPendingId,
    slug: "loja-pendente-fixture",
    storeName: "Loja Pendente Fixture",
    merchantName: "Comerciante Pendente",
    whatsapp: "+5511900000002",
    planCode: 30,
  });

  const merchantSuspendedId = await ensureUser(admin, ONBOARDING_FIXTURE_USERS.merchantSuspended.email);
  const suspendedStoreId = await provisionStoreViaOnboarding(admin, {
    email: ONBOARDING_FIXTURE_USERS.merchantSuspended.email,
    userId: merchantSuspendedId,
    slug: "loja-suspensa-fixture",
    storeName: "Loja Suspensa Fixture",
    merchantName: "Comerciante Suspenso",
    whatsapp: "+5511900000003",
    planCode: 50,
  });
  await setStoreStatus(admin, suspendedStoreId, "suspended", "+5511900000003");

  // owner da própria loja E também staff da Loja A — testa o seletor
  // explícito de múltiplas lojas (nunca escolher a primeira em silêncio).
  const merchantMultiId = await ensureUser(admin, ONBOARDING_FIXTURE_USERS.merchantMulti.email);
  const multiStoreId = await provisionStoreViaOnboarding(admin, {
    email: ONBOARDING_FIXTURE_USERS.merchantMulti.email,
    userId: merchantMultiId,
    slug: "loja-multi-fixture",
    storeName: "Loja Multi Fixture",
    merchantName: "Comerciante Multi-loja",
    whatsapp: "+5511900000004",
    planCode: 80,
  });
  // Acesso de staff numa loja de OUTRO workspace — é o que faz este
  // usuário cair no seletor de múltiplas lojas. O assento de equipe do
  // workspace A não é criado aqui de propósito: quem convida é
  // workspace_invite_member, e a fixture só precisa do acesso à loja.
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
