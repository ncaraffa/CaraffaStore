/**
 * Teste real de concorrência: dois usuários diferentes tentam concluir o
 * onboarding com o MESMO slug ao mesmo tempo (Promise.all — mesma
 * "tick" de event loop, duas conexões de rede distintas ao Postgres
 * local). Só a constraint UNIQUE em stores.slug pode garantir isso sob
 * concorrência real — o advisory lock em onboarding_complete() é por
 * usuário, não por slug, então não impediria essa corrida sozinho.
 *
 * Diferente de supabase/tests/isolation_check.sql (SAVEPOINTs numa única
 * sessão psql, sequencial por natureza), este script usa duas sessões
 * HTTP reais e independentes via supabase-js — a única forma de testar
 * concorrência de verdade, não apenas "um depois do outro".
 *
 * Como rodar:
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *   npx tsx supabase/tests/slug-concurrency-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import type { Database } from "../../lib/supabase/types";

const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";
const RACE_SLUG = "loja-corrida-concorrente";
const EMAIL_A = "concurrency-racer-a@example.test";
const EMAIL_B = "concurrency-racer-b@example.test";

async function ensureRacerUser(admin: ReturnType<typeof createAdminSupabaseClient>, email: string) {
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing.users.find((u) => u.email === email);
  if (found) return found.id;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEV_ONLY_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar usuário de corrida ${email}: ${error?.message}`);
  }
  return data.user.id;
}

async function driveToReview(email: string) {
  const env = getPublicSupabaseEnv();
  const client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: DEV_ONLY_PASSWORD,
  });
  if (signInError) throw new Error(`Falha ao logar ${email}: ${signInError.message}`);

  const ensure = await client.rpc("onboarding_ensure_progress");
  if (ensure.error) throw new Error(`ensure_progress falhou para ${email}: ${ensure.error.message}`);

  const profile = await client.rpc("onboarding_save_profile", {
    p_merchant_name: `Corredor ${email}`,
    p_whatsapp: "+5511900000099",
  });
  if (profile.error) throw new Error(`save_profile falhou para ${email}: ${profile.error.message}`);

  const storeName = await client.rpc("onboarding_save_store_name", { p_store_name: "Loja da Corrida" });
  if (storeName.error) throw new Error(`save_store_name falhou para ${email}: ${storeName.error.message}`);

  // Os dois usuários salvam o MESMO slug — permitido nesta etapa (a
  // checagem aqui é só conveniência de UI); a barreira real é testada
  // no complete() concorrente abaixo.
  const slug = await client.rpc("onboarding_save_slug", { p_slug: RACE_SLUG });
  if (slug.error) throw new Error(`save_slug falhou para ${email}: ${slug.error.message}`);

  const plan = await client.rpc("onboarding_save_plan", { p_plan_code: 30 });
  if (plan.error) throw new Error(`save_plan falhou para ${email}: ${plan.error.message}`);

  return client;
}

async function main() {
  const { loadedEnvFiles } = loadLocalEnv();
  if (loadedEnvFiles.length > 0) {
    console.log(`Ambiente carregado de: ${loadedEnvFiles.join(", ")}\n`);
  }

  const admin = createAdminSupabaseClient();

  // Limpa tentativas anteriores deste teste específico, para o script
  // ser repetível (idempotente) sem exigir supabase db reset a cada vez.
  await admin.from("stores").delete().eq("slug", RACE_SLUG);
  for (const email of [EMAIL_A, EMAIL_B]) {
    const { data } = await admin.auth.admin.listUsers();
    const user = data.users.find((u) => u.email === email);
    if (user) await admin.auth.admin.deleteUser(user.id);
  }

  await ensureRacerUser(admin, EMAIL_A);
  await ensureRacerUser(admin, EMAIL_B);

  const [clientA, clientB] = await Promise.all([driveToReview(EMAIL_A), driveToReview(EMAIL_B)]);

  console.log(`Ambos os usuários prontos para concluir com o slug "${RACE_SLUG}". Disparando em paralelo...`);

  const [resultA, resultB] = await Promise.all([
    clientA.rpc("onboarding_complete"),
    clientB.rpc("onboarding_complete"),
  ]);

  const outcomes = [
    { label: "A", result: resultA },
    { label: "B", result: resultB },
  ];

  const successes = outcomes.filter((o) => !o.result.error);
  const failures = outcomes.filter((o) => o.result.error);

  for (const o of outcomes) {
    if (o.result.error) {
      console.log(`Usuário ${o.label}: falhou com "${o.result.error.message}"`);
    } else {
      console.log(`Usuário ${o.label}: sucesso, loja "${o.result.data?.slug}" (status=${o.result.data?.status})`);
    }
  }

  const { data: storesWithSlug } = await admin.from("stores").select("id").eq("slug", RACE_SLUG);

  const checks = {
    exatamenteUmSucesso: successes.length === 1,
    exatamenteUmaFalhaSlugTaken: failures.length === 1 && failures[0]!.result.error!.message === "slug_taken",
    exatamenteUmaLojaNoBanco: (storesWithSlug ?? []).length === 1,
  };

  console.log("\nResultado:");
  console.log(`  Exatamente 1 sucesso: ${checks.exatamenteUmSucesso ? "PASS" : "FAIL"} (${successes.length})`);
  console.log(
    `  Exatamente 1 falha com "slug_taken": ${checks.exatamenteUmaFalhaSlugTaken ? "PASS" : "FAIL"}`,
  );
  console.log(
    `  Exatamente 1 loja com o slug no banco: ${checks.exatamenteUmaLojaNoBanco ? "PASS" : "FAIL"} (${(storesWithSlug ?? []).length})`,
  );

  // Limpeza: remove a loja e os usuários de corrida criados por este teste.
  await admin.from("stores").delete().eq("slug", RACE_SLUG);
  for (const email of [EMAIL_A, EMAIL_B]) {
    const { data } = await admin.auth.admin.listUsers();
    const user = data.users.find((u) => u.email === email);
    if (user) await admin.auth.admin.deleteUser(user.id);
  }

  if (!checks.exatamenteUmSucesso || !checks.exatamenteUmaFalhaSlugTaken || !checks.exatamenteUmaLojaNoBanco) {
    throw new Error("Teste de concorrência de slug FALHOU — ver detalhes acima.");
  }

  console.log("\nPASS - concorrência de slug: constraint única impediu duplicação sob corrida real.");
}

main().catch((error) => {
  console.error(`Teste de concorrência falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
