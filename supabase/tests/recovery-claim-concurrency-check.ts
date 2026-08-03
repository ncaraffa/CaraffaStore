/**
 * Teste real de concorrência para o bloqueador 4 (BUG-RT2-002,
 * qa/reports/TASK-002-RETEST.md): duas requisições concorrentes usando
 * o MESMO access/refresh token (duas abas do mesmo navegador, ou um
 * duplo-clique/duplo-submit do formulário de troca de senha) chamam
 * `claim_recovery_grant_for_password_change()` ao mesmo tempo
 * (`Promise.all` — duas conexões de rede reais e independentes ao
 * Postgres local via PostgREST, não apenas "uma depois da outra").
 *
 * Só o DELETE condicional atômico dentro da função (mesma linha do
 * WHERE: usuário, sessão, propósito, já consumido, não expirado) pode
 * garantir que exatamente UMA das duas obtenha `true` — o bug original
 * fazia "consultar depois consumir" em passos separados, então as duas
 * requisições liam "ainda não usado" antes de qualquer uma escrever, e
 * as duas trocavam a senha.
 *
 * Como rodar:
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *   npx tsx supabase/tests/recovery-claim-concurrency-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import type { Database } from "../../lib/supabase/types";

const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";
const EMAIL = "recovery-claim-racer@example.test";

async function ensureRacerUser(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing.users.find((u) => u.email === EMAIL);
  if (found) {
    await admin.auth.admin.deleteUser(found.id);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: DEV_ONLY_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Falha ao criar usuário de corrida ${EMAIL}: ${error?.message}`);
  }
  return data.user.id;
}

async function main() {
  const { loadedEnvFiles } = loadLocalEnv();
  if (loadedEnvFiles.length > 0) {
    console.log(`Ambiente carregado de: ${loadedEnvFiles.join(", ")}\n`);
  }

  const env = getPublicSupabaseEnv();
  const admin = createAdminSupabaseClient();

  await ensureRacerUser(admin);

  // Sessão "de recuperação": login normal + consume_auth_flow_grant
  // direto (equivalente, para fins deste teste de concorrência, a ter
  // acabado de trocar um código real em app/auth/recovery/route.ts —
  // o que importa aqui é ter duas conexões reais compartilhando o MESMO
  // access/refresh token no momento da reivindicação concorrente).
  const primary = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInError } = await primary.auth.signInWithPassword({
    email: EMAIL,
    password: DEV_ONLY_PASSWORD,
  });
  if (signInError) throw new Error(`Falha ao logar ${EMAIL}: ${signInError.message}`);

  const { error: requestError } = await primary.rpc("request_password_recovery_grant", { p_email: EMAIL });
  if (requestError) throw new Error(`request_password_recovery_grant falhou: ${requestError.message}`);

  const { data: consumed, error: consumeError } = await primary.rpc("consume_auth_flow_grant", {
    p_purpose: "password_recovery",
  });
  if (consumeError || consumed !== true) {
    throw new Error(`consume_auth_flow_grant falhou ao preparar o teste: ${consumeError?.message ?? "devolveu false"}`);
  }

  const {
    data: { session },
  } = await primary.auth.getSession();
  if (!session) throw new Error("Sessão ausente depois do login/consumo do grant.");

  // Segunda "aba" real: cliente Supabase INDEPENDENTE (conexão HTTP
  // própria), com a MESMA sessão via setSession — não é o mesmo objeto
  // JS reaproveitado.
  const secondary = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error: setSessionError } = await secondary.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (setSessionError) throw new Error(`Falha ao clonar sessão na segunda aba: ${setSessionError.message}`);

  console.log("Sessão de recuperação pronta. Disparando duas reivindicações concorrentes...");

  const [resultA, resultB] = await Promise.all([
    primary.rpc("claim_recovery_grant_for_password_change"),
    secondary.rpc("claim_recovery_grant_for_password_change"),
  ]);

  const outcomes = [
    { label: "aba 1", value: resultA.error ? null : resultA.data },
    { label: "aba 2", value: resultB.error ? null : resultB.data },
  ];

  for (const o of outcomes) {
    console.log(`${o.label}: claim_recovery_grant_for_password_change() = ${o.value}`);
  }

  const successes = outcomes.filter((o) => o.value === true);

  const { data: auditRows } = await admin
    .from("audit_log")
    .select("id")
    .eq("actor_user_id", session.user.id)
    .eq("action", "password_recovery_completed");

  const checks = {
    exatamenteUmaAutorizacao: successes.length === 1,
    exatamenteUmEventoDeAuditoria: (auditRows ?? []).length === 1,
  };

  console.log("\nResultado:");
  console.log(
    `  Exatamente 1 autorizacao bem-sucedida: ${checks.exatamenteUmaAutorizacao ? "PASS" : "FAIL"} (${successes.length})`,
  );
  console.log(
    `  Exatamente 1 evento de auditoria (sem duplicar): ${checks.exatamenteUmEventoDeAuditoria ? "PASS" : "FAIL"} (${(auditRows ?? []).length})`,
  );

  const { data: userAfter } = await admin.auth.admin.getUserById(session.user.id);
  if (userAfter.user) {
    await admin.auth.admin.deleteUser(userAfter.user.id);
  }

  if (!checks.exatamenteUmaAutorizacao || !checks.exatamenteUmEventoDeAuditoria) {
    throw new Error("Teste de concorrência da reivindicação de recuperação FALHOU — ver detalhes acima.");
  }

  console.log(
    "\nPASS - concorrência da troca de senha: DELETE condicional atômico garantiu exatamente uma autorização sob corrida real.",
  );
}

main().catch((error) => {
  console.error(`Teste de concorrência falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
