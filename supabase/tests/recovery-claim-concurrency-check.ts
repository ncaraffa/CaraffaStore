/**
 * Teste real de concorrência para o bloqueador 4 (BUG-RT2-002,
 * qa/reports/TASK-002-RETEST.md): duas requisições concorrentes usando
 * o MESMO access/refresh token (duas abas do mesmo navegador, ou um
 * duplo-clique/duplo-submit do formulário de troca de senha) chamam
 * `claim_recovery_grant_for_password_change(nonce)` ao mesmo tempo
 * (`Promise.all` — duas conexões de rede reais e independentes ao
 * Postgres local via PostgREST, não apenas "uma depois da outra").
 *
 * Só o UPDATE condicional atômico dentro da função (mesma linha do
 * WHERE: usuário, sessão, hash do nonce, não expirado, claimed_at/
 * completed_at/revoked_at todos null) pode garantir que exatamente UMA
 * das duas obtenha `true` — a linha NÃO é apagada (fica no estado
 * `claimed`), só marcada; a concorrência completa (claim + updateUser +
 * verificação de qual senha final funciona) tem um teste dedicado em
 * supabase/tests/bug-claude-verif2-001-regression-check.ts (Cenário 3).
 * Este script cobre especificamente a atomicidade do PASSO DE CLAIM
 * isolado.
 *
 * IMPORTANTE (terceira correção pós-QA, revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-001): o setup
 * deste teste NÃO usa mais `request_password_recovery_grant` +
 * `consume_auth_flow_grant` (a cadeia vulnerável confirmada naquele
 * relatório — o próprio comentário da versão anterior deste arquivo
 * racionalizava aquilo como "equivalente" a uma troca de código real,
 * o que era exatamente o bug). O grant de recuperação agora só nasce
 * de `issue_password_recovery_grant`, chamável apenas por
 * `service_role` — este script usa o cliente admin para chamá-la,
 * exatamente como lib/supabase/service-only/recovery-grant-issuer.ts
 * faz dentro de app/auth/recovery/route.ts, com `user_id`/`session_id`
 * vindos de uma sessão obtida por `verifyOtp({type:"recovery"})` REAL
 * contra um `token_hash` REAL (via `admin.auth.admin.generateLink`,
 * que faz o GoTrue emitir um token genuíno sem precisar do servidor
 * Next.js rodando nem de round-trip por e-mail/Mailpit).
 *
 * IMPORTANTE (quarta correção pós-QA, revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md, BUG-CLAUDE-VERIF2-001):
 * o claim grava `password_recovery_authorization_claimed`, NUNCA
 * `password_recovery_completed` — este teste não chama `updateUser()`,
 * então o evento verificado abaixo é o de autorização reivindicada, não
 * o de conclusão (que só a trigger `on_auth_user_password_changed`,
 * correlacionada a uma troca real de senha em `auth.users`, pode
 * gravar).
 *
 * Como rodar:
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *   npx tsx supabase/tests/recovery-claim-concurrency-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import type { Database } from "../../lib/supabase/types";

const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";
const EMAIL = "recovery-claim-racer@example.test";

async function ensureRacerUser(admin: ReturnType<typeof createAdminSupabaseClient>): Promise<string> {
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

  // Token de recuperação REAL, emitido pelo próprio GoTrue (equivalente
  // ao que chegaria por e-mail) — sem isso, verifyOtp abaixo falharia
  // por um motivo totalmente diferente do que este teste quer provar.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: EMAIL,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink(recovery) falhou: ${linkError?.message ?? "sem hashed_token"}`);
  }

  // Sessão "de recuperação" REAL: verifyOtp com o token_hash real —
  // mesma chamada que app/auth/recovery/route.ts faz.
  const primary = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: verifyData, error: verifyError } = await primary.auth.verifyOtp({
    type: "recovery",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyError || !verifyData.session || !verifyData.user) {
    throw new Error(`verifyOtp(recovery) falhou ao preparar o teste: ${verifyError?.message ?? "sem sessão"}`);
  }

  const { data: claimsData, error: claimsError } = await primary.auth.getClaims();
  const sessionId = claimsData?.claims.session_id;
  if (claimsError || !sessionId) {
    throw new Error(`getClaims() falhou ao preparar o teste: ${claimsError?.message ?? "sem session_id"}`);
  }

  // Emissão do grant exatamente como lib/supabase/service-only/recovery-grant-issuer.ts
  // faz — só service_role pode chamar isto.
  const nonce = randomBytes(32).toString("base64url");
  const { error: issueError } = await admin.rpc("issue_password_recovery_grant", {
    p_user_id: verifyData.user.id,
    p_session_id: sessionId,
    p_nonce: nonce,
    p_ttl_seconds: 1800,
  });
  if (issueError) {
    throw new Error(`issue_password_recovery_grant falhou ao preparar o teste: ${issueError.message}`);
  }

  const {
    data: { session },
  } = await primary.auth.getSession();
  if (!session) throw new Error("Sessão ausente depois do verifyOtp/emissão do grant.");

  // Segunda "aba" real: cliente Supabase INDEPENDENTE (conexão HTTP
  // própria), com a MESMA sessão via setSession — não é o mesmo objeto
  // JS reaproveitado.
  const secondary = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error: setSessionError } = await secondary.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (setSessionError) throw new Error(`Falha ao clonar sessão na segunda aba: ${setSessionError.message}`);

  console.log("Sessão de recuperação pronta (verifyOtp real + issue_password_recovery_grant). Disparando duas reivindicações concorrentes...");

  const [resultA, resultB] = await Promise.all([
    primary.rpc("claim_recovery_grant_for_password_change", { p_nonce: nonce }),
    secondary.rpc("claim_recovery_grant_for_password_change", { p_nonce: nonce }),
  ]);

  const outcomes = [
    { label: "aba 1", value: resultA.error ? null : resultA.data },
    { label: "aba 2", value: resultB.error ? null : resultB.data },
  ];

  for (const o of outcomes) {
    console.log(`${o.label}: claim_recovery_grant_for_password_change(nonce) = ${o.value}`);
  }

  const successes = outcomes.filter((o) => o.value === true);

  const { data: auditRows } = await admin
    .from("audit_log")
    .select("id")
    .eq("actor_user_id", session.user.id)
    .eq("action", "password_recovery_authorization_claimed");

  const { data: grantRows } = await admin
    .from("password_recovery_grants")
    .select("claimed_at, completed_at")
    .eq("user_id", session.user.id);

  const checks = {
    exatamenteUmaAutorizacao: successes.length === 1,
    exatamenteUmEventoDeAuditoria: (auditRows ?? []).length === 1,
    grantClaimedNaoCompleted: Boolean(grantRows?.[0]?.claimed_at) && !grantRows?.[0]?.completed_at,
  };

  console.log("\nResultado:");
  console.log(
    `  Exatamente 1 autorizacao bem-sucedida: ${checks.exatamenteUmaAutorizacao ? "PASS" : "FAIL"} (${successes.length})`,
  );
  console.log(
    `  Exatamente 1 evento password_recovery_authorization_claimed (sem duplicar): ${checks.exatamenteUmEventoDeAuditoria ? "PASS" : "FAIL"} (${(auditRows ?? []).length})`,
  );
  console.log(
    `  Grant no estado claimed, completed_at ainda null (updateUser não foi chamado neste teste): ${checks.grantClaimedNaoCompleted ? "PASS" : "FAIL"} (${JSON.stringify(grantRows?.[0])})`,
  );

  const { data: userAfter } = await admin.auth.admin.getUserById(session.user.id);
  if (userAfter.user) {
    await admin.auth.admin.deleteUser(userAfter.user.id);
  }

  if (!checks.exatamenteUmaAutorizacao || !checks.exatamenteUmEventoDeAuditoria || !checks.grantClaimedNaoCompleted) {
    throw new Error("Teste de concorrência da reivindicação de recuperação FALHOU — ver detalhes acima.");
  }

  console.log(
    "\nPASS - concorrência do claim: UPDATE condicional atômico garantiu exatamente uma autorização sob corrida real, com grant emitido pelo caminho real (verifyOtp + issue_password_recovery_grant, sem bypass). password_recovery_completed corretamente ausente (updateUser não foi chamado por este teste — ver bug-claude-verif2-001-regression-check.ts para o fluxo completo).",
  );
}

main().catch((error) => {
  console.error(`Teste de concorrência falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
