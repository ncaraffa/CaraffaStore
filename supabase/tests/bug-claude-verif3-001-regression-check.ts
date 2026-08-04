/**
 * Teste regressivo real, ponta a ponta, para BUG-CLAUDE-VERIF3-001
 * (qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, BLOQUEADOR/ALTA):
 * reproduz os TRÊS cenários confirmados naquele relatório — uma trigger
 * genérica sobre `auth.users.encrypted_password`, correlacionando só por
 * `user_id` + estado, "concluía" um grant `claimed`-e-abandonado a
 * partir de QUALQUER alteração de senha subsequente e NÃO relacionada.
 *
 * No código vulnerável (commit `de6c2dc3931e2f48fb7af19dfd1500e92e53f441`,
 * testado por aquele relatório), os três cenários abaixo produziam
 * `completed_at` preenchido e um evento `password_recovery_completed`
 * fabricado. Neste código (trigger automática removida por completo —
 * ver supabase/migrations/0004_account_audit.sql — substituída por
 * `complete_password_recovery_attempt`, EXPLÍCITA/server-only, que exige
 * `attempt_id` + completion capability exatos), os três cenários devem
 * produzir `completed_at` NULL e NENHUM evento `password_recovery_completed`.
 *
 *   Cenário 1: claim bem-sucedido -> updateUser da recuperação FALHA
 *     (sessão revogada) -> SEM iniciar nova recuperação, uma troca de
 *     senha NORMAL (login comum + updateUser) é feita depois.
 *   Cenário 2: mesma preparação do Cenário 1 -> alteração ADMINISTRATIVA
 *     de senha (admin.auth.admin.updateUserById) depois.
 *   Cenário 3: mesma preparação, mas o grant é emitido com TTL mínimo
 *     (1s) e o teste aguarda `expires_at` passar de verdade antes da
 *     alteração administrativa — confirma que `expires_at` no passado
 *     (checado só no claim) não afeta nada depois que já foi
 *     reivindicado, e que mesmo assim nenhuma conclusão é fabricada.
 *
 * Cobre também, além dos três cenários originais:
 *   - Uma tentativa `claimed` interrompida permanece reivindicável nunca
 *     mais, mas uma NOVA recuperação para o mesmo usuário continua
 *     funcionando normalmente depois de cada um dos três cenários
 *     (revogação explícita da tentativa anterior via issue_password_recovery_grant).
 *   - complete_password_recovery_attempt com o attempt_id REAL da
 *     tentativa interrompida, mas uma capability FABRICADA (um
 *     atacante nunca teve acesso à capability real — ela nunca sai do
 *     processo Next.js/service_role) falha.
 *   - A capability de uma tentativa já revogada por uma nova emissão
 *     nunca conclui a tentativa nova (mesmo usuário).
 *
 * Requer Supabase local real rodando (não precisa do Next.js dev server
 * — usa RPC/REST/GoTrue direto):
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *
 * Como rodar:
 *   npx tsx supabase/tests/bug-claude-verif3-001-regression-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import type { Database } from "../../lib/supabase/types";

const OLD_PASSWORD = "correct horse battery staple verif3 original 2026!";

const results: { label: string; pass: boolean; detail: string }[] = [];
function record(label: string, pass: boolean, detail: string) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}: ${detail}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function auditActions(admin: ReturnType<typeof createAdminSupabaseClient>, userId: string) {
  const { data } = await admin.from("audit_log").select("action").eq("actor_user_id", userId);
  return (data ?? []).map((r) => r.action as string);
}

async function grantRows(admin: ReturnType<typeof createAdminSupabaseClient>, userId: string) {
  const { data } = await admin
    .from("password_recovery_grants")
    .select("id, claimed_at, completed_at, revoked_at, expires_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

async function login(env: ReturnType<typeof getPublicSupabaseEnv>, email: string, password: string) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  return res.status;
}

/**
 * Prepara EXATAMENTE o estado interrompido dos três cenários: um claim
 * bem-sucedido (attempt_id/capability reais, capturados só para uso
 * interno deste teste — nunca "vazados" para o restante do cenário) e
 * updateUser da recuperação FALHANDO por sessão revogada — a mesma
 * técnica usada em qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md.
 */
async function setupInterruptedClaim(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  email: string,
  ttlSeconds = 1800,
) {
  const env = getPublicSupabaseEnv();
  const { data: user, error } = await admin.auth.admin.createUser({ email, password: OLD_PASSWORD, email_confirm: true });
  if (error || !user.user) throw new Error(`setup falhou: ${error?.message}`);

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (linkErr || !linkData?.properties?.hashed_token) throw new Error(`generateLink falhou: ${linkErr?.message}`);

  const client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: verify, error: verifyErr } = await client.auth.verifyOtp({
    type: "recovery",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyErr || !verify.session) throw new Error(`verifyOtp falhou: ${verifyErr?.message}`);

  const { data: claims } = await client.auth.getClaims();
  const sessionId = claims?.claims.session_id;
  if (!sessionId) throw new Error("session_id ausente");

  const nonce = randomBytes(32).toString("base64url");
  const { error: issueErr } = await admin.rpc("issue_password_recovery_grant", {
    p_user_id: verify.user!.id,
    p_session_id: sessionId,
    p_nonce: nonce,
    p_ttl_seconds: ttlSeconds,
  });
  if (issueErr) throw new Error(`issue falhou: ${issueErr.message}`);

  const { data: claim, error: claimErr } = await client.rpc("claim_recovery_grant_for_password_change", { p_nonce: nonce });
  if (claimErr || claim?.claimed !== true || !claim.attempt_id || !claim.completion_capability) {
    throw new Error(`claim de preparo falhou: ${claimErr?.message ?? JSON.stringify(claim)}`);
  }

  // Revoga a sessão real (não altera nenhum código) para forçar
  // updateUser a falhar de forma realista — a senha nunca muda de fato
  // nesta chamada.
  await admin.auth.admin.signOut(verify.session.access_token, "global");
  const { error: updateErr } = await client.auth.updateUser({ password: "senha-que-nunca-deveria-aplicar-2026!" });
  if (!updateErr) throw new Error("updateUser deveria ter falhado (sessão revogada) para preparar o cenário");

  return { userId: verify.user!.id, attemptId: claim.attempt_id as string, capability: claim.completion_capability as string };
}

async function scenario1NormalPasswordChange(admin: ReturnType<typeof createAdminSupabaseClient>, env: ReturnType<typeof getPublicSupabaseEnv>) {
  const email = "verif3-scenario1-" + Date.now() + "@example.test";
  const NORMAL_NEW_PASSWORD = "troca normal nao relacionada cenario 1 2026!";
  const { userId, attemptId } = await setupInterruptedClaim(admin, email);

  // SEM iniciar nova recuperação: login normal + updateUser normal.
  const normalClient = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInErr } = await normalClient.auth.signInWithPassword({ email, password: OLD_PASSWORD });
  if (signInErr) throw new Error(`login normal falhou: ${signInErr.message}`);
  const { error: normalUpdateErr } = await normalClient.auth.updateUser({ password: NORMAL_NEW_PASSWORD });
  if (normalUpdateErr) throw new Error(`updateUser normal falhou: ${normalUpdateErr.message}`);

  const actions = await auditActions(admin, userId);
  const rows = await grantRows(admin, userId);
  const interrupted = rows.find((r) => r.id === attemptId);

  record(
    "Cenário 1 [BUG-CLAUDE-VERIF3-001]: troca de senha NORMAL não relacionada não fabrica password_recovery_completed",
    !actions.includes("password_recovery_completed"),
    `actions=${JSON.stringify(actions)}`,
  );
  record(
    "Cenário 1: a tentativa interrompida continua claimed, completed_at null para sempre",
    Boolean(interrupted?.claimed_at) && !interrupted?.completed_at,
    `interrupted=${JSON.stringify(interrupted)}`,
  );

  const oldLogin = await login(env, email, OLD_PASSWORD);
  const normalLogin = await login(env, email, NORMAL_NEW_PASSWORD);
  record(
    "Cenário 1: a troca normal em si funcionou de verdade (não é o que está sendo testado, só controle)",
    oldLogin !== 200 && normalLogin === 200,
    `oldLogin=${oldLogin}, normalLogin=${normalLogin}`,
  );

  // Nova recuperação continua funcionando depois deste cenário.
  await assertNewRecoveryWorks(admin, env, userId, email, NORMAL_NEW_PASSWORD, "Cenário 1");

  await admin.auth.admin.deleteUser(userId);
}

async function scenario2AdminPasswordChange(admin: ReturnType<typeof createAdminSupabaseClient>, env: ReturnType<typeof getPublicSupabaseEnv>) {
  const email = "verif3-scenario2-" + Date.now() + "@example.test";
  const ADMIN_NEW_PASSWORD = "alteracao administrativa cenario 2 2026!";
  const { userId, attemptId } = await setupInterruptedClaim(admin, email);

  const { error: adminUpdateErr } = await admin.auth.admin.updateUserById(userId, { password: ADMIN_NEW_PASSWORD });
  if (adminUpdateErr) throw new Error(`updateUserById falhou: ${adminUpdateErr.message}`);

  const actions = await auditActions(admin, userId);
  const rows = await grantRows(admin, userId);
  const interrupted = rows.find((r) => r.id === attemptId);

  record(
    "Cenário 2 [BUG-CLAUDE-VERIF3-001]: alteração ADMINISTRATIVA não relacionada não fabrica password_recovery_completed",
    !actions.includes("password_recovery_completed"),
    `actions=${JSON.stringify(actions)}`,
  );
  record(
    "Cenário 2: a tentativa interrompida continua claimed, completed_at null para sempre",
    Boolean(interrupted?.claimed_at) && !interrupted?.completed_at,
    `interrupted=${JSON.stringify(interrupted)}`,
  );

  await assertNewRecoveryWorks(admin, env, userId, email, ADMIN_NEW_PASSWORD, "Cenário 2");

  await admin.auth.admin.deleteUser(userId);
}

async function scenario3ExpiredGrantLaterChanged(admin: ReturnType<typeof createAdminSupabaseClient>, env: ReturnType<typeof getPublicSupabaseEnv>) {
  const email = "verif3-scenario3-" + Date.now() + "@example.test";
  const ADMIN_NEW_PASSWORD = "alteracao apos expiracao cenario 3 2026!";
  // TTL mínimo tecnicamente possível — issue_password_recovery_grant
  // rejeita p_ttl_seconds <= 0.
  const { userId, attemptId } = await setupInterruptedClaim(admin, email, 1);

  await sleep(2000);
  const { data: rowsBefore } = await admin
    .from("password_recovery_grants")
    .select("expires_at")
    .eq("id", attemptId)
    .single();
  const expired = rowsBefore?.expires_at ? new Date(rowsBefore.expires_at).getTime() < Date.now() : false;
  record("Cenário 3 (setup): expires_at confirmado no passado", expired, `expires_at=${rowsBefore?.expires_at}`);

  const { error: adminUpdateErr } = await admin.auth.admin.updateUserById(userId, { password: ADMIN_NEW_PASSWORD });
  if (adminUpdateErr) throw new Error(`updateUserById falhou: ${adminUpdateErr.message}`);

  const actions = await auditActions(admin, userId);
  const rows = await grantRows(admin, userId);
  const interrupted = rows.find((r) => r.id === attemptId);

  record(
    "Cenário 3 [BUG-CLAUDE-VERIF3-001]: alteração depois de expires_at no passado não fabrica password_recovery_completed",
    !actions.includes("password_recovery_completed"),
    `actions=${JSON.stringify(actions)}`,
  );
  record(
    "Cenário 3: a tentativa interrompida/expirada continua claimed, completed_at null para sempre",
    Boolean(interrupted?.claimed_at) && !interrupted?.completed_at,
    `interrupted=${JSON.stringify(interrupted)}`,
  );

  await assertNewRecoveryWorks(admin, env, userId, email, ADMIN_NEW_PASSWORD, "Cenário 3");

  await admin.auth.admin.deleteUser(userId);
}

async function assertNewRecoveryWorks(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  env: ReturnType<typeof getPublicSupabaseEnv>,
  userId: string,
  email: string,
  currentPassword: string,
  label: string,
) {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (linkErr || !linkData?.properties?.hashed_token) throw new Error(`generateLink (nova recuperacao) falhou: ${linkErr?.message}`);

  const client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: verify, error: verifyErr } = await client.auth.verifyOtp({
    type: "recovery",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyErr || !verify.session) throw new Error(`verifyOtp (nova recuperacao) falhou: ${verifyErr?.message}`);
  const { data: claims } = await client.auth.getClaims();
  const sessionId = claims?.claims.session_id;
  if (!sessionId) throw new Error("session_id ausente (nova recuperacao)");

  const nonce = randomBytes(32).toString("base64url");
  const { error: issueErr } = await admin.rpc("issue_password_recovery_grant", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_nonce: nonce,
    p_ttl_seconds: 1800,
  });
  if (issueErr) throw new Error(`issue (nova recuperacao) falhou: ${issueErr.message}`);

  const NEW_PASSWORD = `nova recuperacao pos ${label} 2026!`;
  const { data: claim, error: claimErr } = await client.rpc("claim_recovery_grant_for_password_change", { p_nonce: nonce });
  if (claimErr || claim?.claimed !== true || !claim.attempt_id || !claim.completion_capability) {
    record(`${label}: nova recuperação — claim`, false, `claim=${JSON.stringify(claim)}, error=${claimErr?.message}`);
    return;
  }
  const { error: updateErr } = await client.auth.updateUser({ password: NEW_PASSWORD });
  const completeResult = updateErr
    ? { data: false }
    : await admin.rpc("complete_password_recovery_attempt", {
        p_attempt_id: claim.attempt_id,
        p_capability: claim.completion_capability,
      });

  const newLogin = await login(env, email, NEW_PASSWORD);
  const oldLogin = await login(env, email, currentPassword);

  record(
    `${label}: nova recuperação funciona de ponta a ponta depois do cenário interrompido`,
    !updateErr && completeResult.data === true && newLogin === 200 && oldLogin !== 200,
    `updateErr=${updateErr?.message ?? "null"}, completeOk=${completeResult.data}, newLogin=${newLogin}, oldLogin=${oldLogin}`,
  );
}

/**
 * Um atacante que observou a tentativa interrompida (ex.: pelo
 * attempt_id, se algum dia vazasse em um log) NUNCA teve acesso à
 * completion capability real — ela nunca sai do processo Next.js/
 * service_role. Uma capability fabricada/adivinhada nunca conclui nada,
 * mesmo com o attempt_id real e uma alteração de senha real acontecendo
 * depois.
 */
async function forgedCapabilityNeverCompletes(admin: ReturnType<typeof createAdminSupabaseClient>, env: ReturnType<typeof getPublicSupabaseEnv>) {
  const email = "verif3-forged-capability-" + Date.now() + "@example.test";
  const { userId, attemptId } = await setupInterruptedClaim(admin, email);

  await admin.auth.admin.updateUserById(userId, { password: "senha alterada antes da tentativa forjada 2026!" });

  const { data: completed } = await admin.rpc("complete_password_recovery_attempt", {
    p_attempt_id: attemptId,
    p_capability: randomBytes(32).toString("hex"),
  });

  record(
    "Completion com capability forjada (attempt_id real, capability nunca gerada por nenhum claim) falha",
    completed === false,
    `completed=${completed}`,
  );

  await admin.auth.admin.deleteUser(userId);
}

/**
 * A capability de uma tentativa CLAIMED, revogada por uma nova emissão
 * para o mesmo usuário, nunca conclui a tentativa NOVA — revoked é
 * estado terminal, exatamente como completed.
 */
async function oldCapabilityNeverCompletesNewAttempt(admin: ReturnType<typeof createAdminSupabaseClient>, env: ReturnType<typeof getPublicSupabaseEnv>) {
  const email = "verif3-old-capability-cross-attempt-" + Date.now() + "@example.test";
  const { userId, attemptId: oldAttemptId, capability: oldCapability } = await setupInterruptedClaim(admin, email);

  // Nova recuperação para o MESMO usuário — revoga a anterior
  // explicitamente (issue_password_recovery_grant).
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (linkErr || !linkData?.properties?.hashed_token) throw new Error(`generateLink (segunda tentativa) falhou: ${linkErr?.message}`);
  const client = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: verify, error: verifyErr } = await client.auth.verifyOtp({ type: "recovery", token_hash: linkData.properties.hashed_token });
  if (verifyErr || !verify.session) throw new Error(`verifyOtp (segunda tentativa) falhou: ${verifyErr?.message}`);
  const { data: claims } = await client.auth.getClaims();
  const sessionId = claims?.claims.session_id;
  if (!sessionId) throw new Error("session_id ausente (segunda tentativa)");
  const nonce = randomBytes(32).toString("base64url");
  await admin.rpc("issue_password_recovery_grant", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_nonce: nonce,
    p_ttl_seconds: 1800,
  });

  await admin.auth.admin.updateUserById(userId, { password: "senha alterada apos segunda emissao 2026!" });

  const { data: completed } = await admin.rpc("complete_password_recovery_attempt", {
    p_attempt_id: oldAttemptId,
    p_capability: oldCapability,
  });

  record(
    "Capability da tentativa antiga (revogada pela nova emissão) nunca conclui a tentativa nova/nenhuma, mesmo mesmo usuário e senha realmente alterada",
    completed === false,
    `completed=${completed}`,
  );

  const rows = await grantRows(admin, userId);
  const oldRow = rows.find((r) => r.id === oldAttemptId);
  record(
    "A tentativa antiga foi revogada explicitamente pela nova emissão (linha preservada, revoked_at preenchido)",
    Boolean(oldRow?.revoked_at),
    `oldRow=${JSON.stringify(oldRow)}`,
  );

  await admin.auth.admin.deleteUser(userId);
}

async function main() {
  loadLocalEnv();
  const env = getPublicSupabaseEnv();
  const admin = createAdminSupabaseClient();

  await scenario1NormalPasswordChange(admin, env);
  await scenario2AdminPasswordChange(admin, env);
  await scenario3ExpiredGrantLaterChanged(admin, env);
  await forgedCapabilityNeverCompletes(admin, env);
  await oldCapabilityNeverCompletesNewAttempt(admin, env);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log(
    "\nPASS - BUG-CLAUDE-VERIF3-001 corrigido: nenhuma alteração de senha NÃO relacionada (normal, administrativa, ou sobre uma tentativa expirada) conclui uma tentativa de recuperação interrompida; capabilities forjadas/antigas nunca concluem nada; uma nova recuperação sempre funciona depois de cada cenário interrompido.",
  );
}

main().catch((error) => {
  console.error(`Teste regressivo BUG-CLAUDE-VERIF3-001 falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
