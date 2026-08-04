/**
 * Teste regressivo real, ponta a ponta, para BUG-CLAUDE-VERIF2-001
 * (qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md, §8, ALTA): a versão
 * original de `claim_recovery_grant_for_password_change` gravava
 * `password_recovery_completed` DENTRO do próprio claim — ou seja,
 * ANTES de `supabase.auth.updateUser({password})` ser chamado em
 * app/(auth)/reset-password/actions.ts. Reproduzido naquela verificação:
 * uma sessão revogada entre o claim e o updateUser faz o updateUser
 * falhar (a senha nunca muda de fato — a senha antiga continua válida),
 * mas a auditoria já afirmava "password_recovery_completed" mesmo
 * assim.
 *
 * A correção original (pending -> claimed -> completed, com uma trigger
 * AFTER UPDATE OF encrypted_password em auth.users) foi por sua vez
 * substituída pela correção de BUG-CLAUDE-VERIF3-001
 * (qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md): a trigger automática
 * foi removida — a conclusão agora é EXPLÍCITA e SERVER-ONLY
 * (complete_password_recovery_attempt, chamada só depois de
 * updateUser() ter sucesso real, com attempt_id + completion capability
 * exatos). Este script continua reproduzindo os MESMOS dois cenários do
 * bloqueador original, agora chamando a conclusão explícita no lugar da
 * trigger automática:
 *
 *   Cenário 1 (sucesso real): claim -> updateUser com sucesso real ->
 *     complete_password_recovery_attempt (via cliente admin/service_role,
 *     mesmo caminho de lib/supabase/service-only/recovery-completion.ts)
 *     -> exatamente 1 evento password_recovery_authorization_claimed,
 *     exatamente 1 evento password_recovery_completed, grant.completed_at
 *     preenchido, senha antiga falha, senha nova funciona.
 *
 *   Cenário 2 (falha forçada entre claim e updateUser, via revogação
 *     real da sessão — não altera nenhum código): claim tem sucesso
 *     (evento claimed gravado, correto), updateUser FALHA — a Server
 *     Action real NUNCA chamaria a conclusão neste caso (só chama
 *     depois de updateUser() ter sucesso), então este teste também não
 *     chama; o teste falha se — e só se — password_recovery_completed
 *     aparecer no audit_log de qualquer forma (o bug original). grant
 *     permanece no estado claimed (completed_at continua null para
 *     sempre), senha antiga continua válida, senha "nova" pretendida
 *     nunca funciona.
 *
 *   Cenário 3 (concorrência real com 5 tentativas completas, senhas
 *     diferentes): exatamente 1 claim, exatamente 1 updateUser,
 *     exatamente 1 conclusão explícita (via admin), exatamente 1 evento
 *     claimed, exatamente 1 evento completed, exatamente 1 de 6 senhas
 *     candidatas (antiga + 5 concorrentes) funciona no login final.
 *
 * Requer Supabase local real rodando (não precisa do Next.js dev server
 * — usa RPC/REST/GoTrue direto, como o próprio ataque original):
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *
 * Como rodar:
 *   npx tsx supabase/tests/bug-claude-verif2-001-regression-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import type { Database } from "../../lib/supabase/types";

const OLD_PASSWORD = "correct horse battery staple original 2026!";

const results: { label: string; pass: boolean; detail: string }[] = [];
function record(label: string, pass: boolean, detail: string) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}: ${detail}`);
}

async function setupRecoverySession(admin: ReturnType<typeof createAdminSupabaseClient>, email: string) {
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
    p_ttl_seconds: 1800,
  });
  if (issueErr) throw new Error(`issue falhou: ${issueErr.message}`);

  return { userId: verify.user!.id, client, nonce, session: verify.session };
}

async function auditActions(admin: ReturnType<typeof createAdminSupabaseClient>, userId: string) {
  const { data } = await admin.from("audit_log").select("action").eq("actor_user_id", userId);
  return (data ?? []).map((r) => r.action as string);
}

async function grantState(admin: ReturnType<typeof createAdminSupabaseClient>, userId: string) {
  const { data } = await admin
    .from("password_recovery_grants")
    .select("claimed_at, completed_at, revoked_at")
    .eq("user_id", userId);
  return data?.[0] ?? null;
}

async function login(env: ReturnType<typeof getPublicSupabaseEnv>, email: string, password: string) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  return res.status;
}

async function scenario1Success(admin: ReturnType<typeof createAdminSupabaseClient>, env: ReturnType<typeof getPublicSupabaseEnv>) {
  const email = "verif2-scenario1-" + Date.now() + "@example.test";
  const NEW_PASSWORD = "a genuinely new password scenario 1 2026!";
  const { userId, client, nonce } = await setupRecoverySession(admin, email);

  const { data: claim } = await client.rpc("claim_recovery_grant_for_password_change", { p_nonce: nonce });
  const { error: updateErr } = await client.auth.updateUser({ password: NEW_PASSWORD });

  record("Cenário 1 (sucesso real): claim.claimed=true", claim?.claimed === true, `claim=${JSON.stringify(claim)}`);
  record("Cenário 1: updateUser teve sucesso real", !updateErr, `error=${updateErr?.message ?? "null"}`);

  // Mesmo caminho de lib/supabase/service-only/recovery-completion.ts —
  // chamada SOMENTE depois de updateUser() ter sucesso real.
  let completeOk = false;
  if (!updateErr && claim?.claimed && claim.attempt_id && claim.completion_capability) {
    const { data: completed } = await admin.rpc("complete_password_recovery_attempt", {
      p_attempt_id: claim.attempt_id,
      p_capability: claim.completion_capability,
    });
    completeOk = completed === true;
  }
  record("Cenário 1: complete_password_recovery_attempt teve sucesso real", completeOk, `completeOk=${completeOk}`);

  const actions = await auditActions(admin, userId);
  const grant = await grantState(admin, userId);
  const oldLogin = await login(env, email, OLD_PASSWORD);
  const newLogin = await login(env, email, NEW_PASSWORD);

  record(
    "Cenário 1: evento claimed presente, exatamente 1 evento completed",
    actions.includes("password_recovery_authorization_claimed") &&
      actions.filter((a) => a === "password_recovery_completed").length === 1,
    `actions=${JSON.stringify(actions)}`,
  );
  record(
    "Cenário 1: grant.completed_at preenchido",
    Boolean(grant?.completed_at),
    `grant=${JSON.stringify(grant)}`,
  );
  record(
    "Cenário 1: senha antiga falha, senha nova funciona",
    oldLogin !== 200 && newLogin === 200,
    `oldLogin=${oldLogin}, newLogin=${newLogin}`,
  );

  await admin.auth.admin.deleteUser(userId);
}

async function scenario2ForcedFailure(admin: ReturnType<typeof createAdminSupabaseClient>, env: ReturnType<typeof getPublicSupabaseEnv>) {
  const email = "verif2-scenario2-" + Date.now() + "@example.test";
  const INTENDED_NEW_PASSWORD = "this password must never actually apply scenario 2 2026!";
  const { userId, client, nonce, session } = await setupRecoverySession(admin, email);

  const { data: claim } = await client.rpc("claim_recovery_grant_for_password_change", { p_nonce: nonce });
  record("Cenário 2 (falha forçada): claim.claimed=true", claim?.claimed === true, `claim=${JSON.stringify(claim)}`);

  // Revoga a sessão real (não altera nenhum código) para forçar
  // updateUser a falhar de forma realista (conexão caindo, sessão
  // invalidada no meio do fluxo).
  await admin.auth.admin.signOut(session.access_token, "global");
  const { error: updateErr } = await client.auth.updateUser({ password: INTENDED_NEW_PASSWORD });

  // A Server Action real NUNCA chamaria complete_password_recovery_attempt
  // aqui (updateUser falhou) — este teste também não chama, por desenho:
  // o que se está provando é que NENHUM caminho (nem uma trigger
  // automática, que nem existe mais) conclui esta tentativa sozinho.

  const actions = await auditActions(admin, userId);
  const grant = await grantState(admin, userId);
  const oldLogin = await login(env, email, OLD_PASSWORD);
  const newLogin = await login(env, email, INTENDED_NEW_PASSWORD);

  record(
    "Cenário 2: updateUser realmente falhou (senão o teste não provaria nada)",
    Boolean(updateErr),
    `error=${updateErr?.message ?? "null"}`,
  );
  record(
    "Cenário 2 [BUG-CLAUDE-VERIF2-001/VERIF3-001]: password_recovery_completed NÃO aparece no audit_log",
    !actions.includes("password_recovery_completed"),
    `actions=${JSON.stringify(actions)}`,
  );
  record(
    "Cenário 2: evento claimed presente (correto — a autorização foi de fato reivindicada)",
    actions.includes("password_recovery_authorization_claimed"),
    `actions=${JSON.stringify(actions)}`,
  );
  record(
    "Cenário 2: grant permanece claimed, completed_at continua null para sempre",
    Boolean(grant?.claimed_at) && !grant?.completed_at,
    `grant=${JSON.stringify(grant)}`,
  );
  record(
    "Cenário 2: senha antiga continua válida, senha 'nova' pretendida nunca funciona",
    oldLogin === 200 && newLogin !== 200,
    `oldLogin=${oldLogin}, newLogin=${newLogin}`,
  );

  await admin.auth.admin.deleteUser(userId);
}

async function scenario3FiveWayConcurrency(admin: ReturnType<typeof createAdminSupabaseClient>, env: ReturnType<typeof getPublicSupabaseEnv>) {
  const email = "verif2-scenario3-" + Date.now() + "@example.test";
  const { userId, nonce, session } = await setupRecoverySession(admin, email);

  const passwords = [1, 2, 3, 4, 5].map((n) => `senha concorrente pos-fix numero ${n} 2026!`);
  const clients = Array.from({ length: 5 }, () =>
    createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
  for (const c of clients) {
    const { error } = await c.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (error) throw new Error(`setSession falhou: ${error.message}`);
  }

  const attempts = await Promise.all(
    clients.map(async (c, i) => {
      const { data: claim } = await c.rpc("claim_recovery_grant_for_password_change", { p_nonce: nonce });
      if (claim?.claimed !== true) return { i, claimed: false, updateOk: null as boolean | null, attemptId: null as string | null, capability: null as string | null };
      const { error } = await c.auth.updateUser({ password: passwords[i]! });
      return { i, claimed: true, updateOk: !error, attemptId: claim.attempt_id, capability: claim.completion_capability };
    }),
  );

  const claimSuccesses = attempts.filter((a) => a.claimed);
  const updateSuccesses = attempts.filter((a) => a.updateOk === true);

  const winner = attempts.find((a) => a.claimed && a.updateOk && a.attemptId && a.capability);
  if (winner) {
    await admin.rpc("complete_password_recovery_attempt", {
      p_attempt_id: winner.attemptId!,
      p_capability: winner.capability!,
    });
  }

  const actions = await auditActions(admin, userId);

  const loginResults = [
    { label: "antiga", status: await login(env, email, OLD_PASSWORD) },
    ...(await Promise.all(passwords.map(async (p, i) => ({ label: `concorrente ${i + 1}`, status: await login(env, email, p) })))),
  ];
  const workingCount = loginResults.filter((r) => r.status === 200).length;

  record("Cenário 3 (concorrência 5x): exatamente 1 claim bem-sucedido", claimSuccesses.length === 1, `${claimSuccesses.length}`);
  record("Cenário 3: exatamente 1 updateUser bem-sucedido", updateSuccesses.length === 1, `${updateSuccesses.length}`);
  record(
    "Cenário 3: exatamente 1 evento claimed, exatamente 1 evento completed",
    actions.filter((a) => a === "password_recovery_authorization_claimed").length === 1 &&
      actions.filter((a) => a === "password_recovery_completed").length === 1,
    `actions=${JSON.stringify(actions)}`,
  );
  record(
    "Cenário 3: exatamente 1 das 6 senhas candidatas funciona no login final",
    workingCount === 1,
    JSON.stringify(loginResults),
  );

  await admin.auth.admin.deleteUser(userId);
}

async function main() {
  loadLocalEnv();
  const env = getPublicSupabaseEnv();
  const admin = createAdminSupabaseClient();

  await scenario1Success(admin, env);
  await scenario2ForcedFailure(admin, env);
  await scenario3FiveWayConcurrency(admin, env);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log(
    "\nPASS - BUG-CLAUDE-VERIF2-001 continua corrigido: password_recovery_completed só é gravado depois de updateUser() realmente ter sucesso E de uma chamada explícita/server-only de conclusão (attempt_id + capability exatos), nos três cenários (sucesso, falha forçada, concorrência real).",
  );
}

main().catch((error) => {
  console.error(`Teste regressivo BUG-CLAUDE-VERIF2-001 falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
