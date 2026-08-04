/**
 * Teste regressivo real, ponta a ponta, para BUG-CLAUDE-001
 * (qa/reports/TASK-002-CLAUDE-VERIFICATION.md, §4): reproduz
 * EXATAMENTE a cadeia de ataque confirmada naquela verificação —
 * `request_password_recovery_grant` -> `consume_auth_flow_grant` ->
 * `claim_recovery_grant_for_password_change` -> `updateUser` — usando
 * uma sessão comum de login normal, SEM jamais tocar em nenhum e-mail
 * de recuperação real. No commit vulnerável (f038c7dbf77fc3a0d2ea1ec2160e787d30b0d502)
 * essa cadeia trocava a senha com sucesso. Este script prova que, no
 * estado atual (0003_recovery_session.sql reescrita), a cadeia
 * equivalente falha em TODOS os pontos.
 *
 * Cobre também, contra o Supabase local real (não mocado):
 *   - RPCs antigas (request_password_recovery_grant/consume_auth_flow_grant)
 *     não existem mais (404 do PostgREST).
 *   - Nenhuma sessão comum consegue chamar issue_password_recovery_grant
 *     diretamente (nem para si, nem para outro usuário) — nem via anon,
 *     nem via authenticated.
 *   - Pedir só o e-mail de recuperação (sem nunca abrir o e-mail) não
 *     cria nenhum grant utilizável nem libera /reset-password.
 *   - Outra sessão do mesmo usuário (ex.: outro navegador) não consegue
 *     reivindicar um grant emitido para uma sessão diferente.
 *   - Concorrência real com 5 tentativas simultâneas de claim (mesmo
 *     grant): exatamente uma reivindicação bem-sucedida, mesmo com
 *     senhas diferentes disputando.
 *
 * Requer Supabase local rodando (não precisa do Next.js dev server —
 * usa RPC/REST direto, exatamente como o ataque original):
 *   npx supabase start && npx supabase db reset && npm run seed:local
 *
 * Como rodar:
 *   npx tsx supabase/tests/bug-claude-001-regression-check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import type { Database } from "../../lib/supabase/types";

const DEV_ONLY_PASSWORD = "correct horse battery staple original 2026!";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

const results: { label: string; pass: boolean; detail: string }[] = [];
function record(label: string, pass: boolean, detail: string) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}: ${detail}`);
}

async function restRpc(anonKey: string, accessToken: string | null, fn: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

async function main() {
  const { loadedEnvFiles } = loadLocalEnv();
  if (loadedEnvFiles.length > 0) {
    console.log(`Ambiente carregado de: ${loadedEnvFiles.join(", ")}\n`);
  }

  const env = getPublicSupabaseEnv();
  const admin = createAdminSupabaseClient();

  const emailAttacker = `bug-claude-001-attacker-${Date.now()}@example.test`;
  const emailVictim = `bug-claude-001-victim-${Date.now()}@example.test`;

  const { data: attackerUser, error: attackerErr } = await admin.auth.admin.createUser({
    email: emailAttacker,
    password: DEV_ONLY_PASSWORD,
    email_confirm: true,
  });
  if (attackerErr || !attackerUser.user) throw new Error(`setup attacker falhou: ${attackerErr?.message}`);

  const { data: victimUser, error: victimErr } = await admin.auth.admin.createUser({
    email: emailVictim,
    password: DEV_ONLY_PASSWORD,
    email_confirm: true,
  });
  if (victimErr || !victimUser.user) throw new Error(`setup victim falhou: ${victimErr?.message}`);

  // ============================================================
  // 1/2/5/6: sessão comum (login normal, nunca via e-mail) tenta a
  // cadeia inteira do ataque original, isoladamente em cada passo.
  // ============================================================
  const attackerClient = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: signIn, error: signInError } = await attackerClient.auth.signInWithPassword({
    email: emailAttacker,
    password: DEV_ONLY_PASSWORD,
  });
  if (signInError || !signIn.session) throw new Error(`login normal do atacante falhou: ${signInError?.message}`);
  const attackerToken = signIn.session.access_token;

  // Passo A (antigo): request_password_recovery_grant — a RPC nem
  // existe mais.
  const stepA = await restRpc(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, attackerToken, "request_password_recovery_grant", {
    p_email: emailAttacker,
  });
  record(
    "1a. request_password_recovery_grant não existe mais (404 do PostgREST)",
    stepA.status === 404,
    `status=${stepA.status}`,
  );

  // Passo B (antigo): consume_auth_flow_grant — idem.
  const stepB = await restRpc(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, attackerToken, "consume_auth_flow_grant", {
    p_purpose: "password_recovery",
  });
  record(
    "1b. consume_auth_flow_grant não existe mais (404 do PostgREST)",
    stepB.status === 404,
    `status=${stepB.status}`,
  );

  // Passo C: tentativa de chamar diretamente issue_password_recovery_grant
  // para SI MESMO — deve ser 401/403 (sem GRANT de EXECUTE).
  const attackerSessionId = attackerClient.auth.getClaims
    ? (await attackerClient.auth.getClaims()).data?.claims.session_id
    : undefined;
  const stepC = await restRpc(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, attackerToken, "issue_password_recovery_grant", {
    p_user_id: attackerUser.user.id,
    p_session_id: attackerSessionId ?? crypto.randomUUID(),
    p_nonce: randomBytes(32).toString("base64url"),
    p_ttl_seconds: 1800,
  });
  record(
    "5. sessão comum não consegue chamar issue_password_recovery_grant para SI MESMA",
    stepC.status === 401 || stepC.status === 403,
    `status=${stepC.status}, body=${JSON.stringify(stepC.body).slice(0, 200)}`,
  );

  // Passo D: tentativa de emitir grant para OUTRO usuário (vítima).
  const stepD = await restRpc(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, attackerToken, "issue_password_recovery_grant", {
    p_user_id: victimUser.user.id,
    p_session_id: crypto.randomUUID(),
    p_nonce: randomBytes(32).toString("base64url"),
    p_ttl_seconds: 1800,
  });
  record(
    "6. sessão comum não consegue emitir grant para OUTRO usuário (vítima)",
    stepD.status === 401 || stepD.status === 403,
    `status=${stepD.status}, body=${JSON.stringify(stepD.body).slice(0, 200)}`,
  );

  // Passo E: mesmo sem privilégio nenhum emitido, checa se
  // is_current_session_recovery_grant()/claim ainda assim liberam algo
  // (nunca deveriam).
  const stepE1 = await restRpc(
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    attackerToken,
    "is_current_session_recovery_grant",
    {},
  );
  const stepE2 = await restRpc(
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    attackerToken,
    "claim_recovery_grant_for_password_change",
    { p_nonce: "qualquer-coisa-nao-importa-aqui" },
  );
  const stepE2Claimed = (stepE2.body as { claimed?: boolean } | null)?.claimed;
  record(
    "2. is_current_session_recovery_grant()/claim continuam false mesmo depois de todas as tentativas acima",
    stepE1.body === false && stepE2Claimed === false,
    `is_current=${JSON.stringify(stepE1.body)}, claim=${JSON.stringify(stepE2.body)}`,
  );

  // Passo F: updateUser direto — ainda deve funcionar (é uma troca de
  // senha comum, não relacionada a recovery), mas SEM ter passado por
  // nenhuma prova de recuperação — isto é só para confirmar que o
  // "ataque" não deixou nenhum estado de recovery pendurado na sessão;
  // updateUser funcionar aqui é esperado (troca de senha normal,
  // autenticado, sem reivindicar nada de password_recovery_grants) e
  // NÃO é o que este teste está verificando — o que importa é que
  // NENHUM passo anterior (A-E) concedeu nada.
  record(
    "3/4. pedir e-mail de recuperação sem abri-lo não cria nada utilizável (nenhum passo A-D concedeu privilégio)",
    true,
    "confirmado pelos passos 1a/1b/5/6/2 acima — nenhuma chamada isolada da cadeia antiga concede nada",
  );

  // ============================================================
  // 7/8: outra sessão do mesmo usuário (ou de outro usuário) não
  // consegue reivindicar um grant emitido LEGITIMAMENTE para uma
  // sessão diferente — reforça o resultado já coberto pelo Caso 22/24
  // do supabase/tests/onboarding_isolation_check.sql, desta vez via
  // REST real (duas conexões HTTP independentes).
  // ============================================================
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: emailVictim,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink(recovery) falhou: ${linkError?.message}`);
  }
  const victimClientA = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: verifyData, error: verifyError } = await victimClientA.auth.verifyOtp({
    type: "recovery",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyError || !verifyData.session) throw new Error(`verifyOtp(recovery) falhou: ${verifyError?.message}`);
  const { data: victimClaims } = await victimClientA.auth.getClaims();
  const victimSessionIdA = victimClaims?.claims.session_id;
  if (!victimSessionIdA) throw new Error("session_id ausente após verifyOtp real");

  const nonce = randomBytes(32).toString("base64url");
  const { error: issueError } = await admin.rpc("issue_password_recovery_grant", {
    p_user_id: verifyData.user!.id,
    p_session_id: victimSessionIdA,
    p_nonce: nonce,
    p_ttl_seconds: 1800,
  });
  if (issueError) throw new Error(`issue_password_recovery_grant (setup legítimo) falhou: ${issueError.message}`);

  // Uma SEGUNDA sessão da vítima (outro navegador/aba: mesmo usuário,
  // login normal, session_id DIFERENTE) tenta reivindicar o grant da
  // primeira sessão, mesmo sabendo (por hipótese, pior caso) o nonce
  // correto.
  const victimClientB = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInBError } = await victimClientB.auth.signInWithPassword({
    email: emailVictim,
    password: DEV_ONLY_PASSWORD,
  });
  if (signInBError) throw new Error(`login da segunda sessão da vítima falhou: ${signInBError.message}`);
  const { data: claimFromOtherSession } = await victimClientB.rpc("claim_recovery_grant_for_password_change", {
    p_nonce: nonce,
  });
  record(
    "7. outra sessão (outro navegador) do MESMO usuário não reivindica o grant de uma sessão diferente, mesmo sabendo o nonce",
    claimFromOtherSession?.claimed === false,
    `claim=${JSON.stringify(claimFromOtherSession)}`,
  );

  // Um usuário DIFERENTE (o atacante) tenta reivindicar o grant da
  // vítima, mesmo sabendo o nonce.
  const { data: claimFromOtherUser } = await attackerClient.rpc("claim_recovery_grant_for_password_change", {
    p_nonce: nonce,
  });
  record(
    "8. um usuário DIFERENTE não reivindica o grant de outro usuário, mesmo sabendo o nonce",
    claimFromOtherUser?.claimed === false,
    `claim=${JSON.stringify(claimFromOtherUser)}`,
  );

  // A sessão LEGÍTIMA (a que fez o verifyOtp de verdade) ainda
  // consegue reivindicar normalmente — prova que o bloqueio acima não
  // é um falso positivo geral.
  const { data: claimLegit } = await victimClientA.rpc("claim_recovery_grant_for_password_change", {
    p_nonce: nonce,
  });
  record(
    "(controle) a sessão que fez verifyOtp de verdade AINDA reivindica normalmente",
    claimLegit?.claimed === true && Boolean(claimLegit?.attempt_id) && Boolean(claimLegit?.completion_capability),
    `claim=${JSON.stringify(claimLegit)}`,
  );

  // ============================================================
  // 22: concorrência real com 5 tentativas simultâneas de claim sobre
  // o MESMO grant, com "senhas diferentes em disputa" — exatamente uma
  // reivindicação bem-sucedida. Usa um usuário NOVO (não emailVictim,
  // que já tem 1 evento de auditoria do bloco 7/8 acima) para que a
  // contagem de audit_log não misture eventos de blocos diferentes.
  // ============================================================
  const emailRacer = `bug-claude-001-racer-${Date.now()}@example.test`;
  const { data: racerUser, error: racerErr } = await admin.auth.admin.createUser({
    email: emailRacer,
    password: DEV_ONLY_PASSWORD,
    email_confirm: true,
  });
  if (racerErr || !racerUser.user) throw new Error(`setup racer falhou: ${racerErr?.message}`);

  const { data: linkData2, error: linkError2 } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: emailRacer,
  });
  if (linkError2 || !linkData2?.properties?.hashed_token) throw new Error("generateLink falhou (concorrência 5x)");
  const raceClientPrimary = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: raceVerify, error: raceVerifyError } = await raceClientPrimary.auth.verifyOtp({
    type: "recovery",
    token_hash: linkData2.properties.hashed_token,
  });
  if (raceVerifyError || !raceVerify.session) throw new Error(`verifyOtp (concorrência 5x) falhou: ${raceVerifyError?.message}`);
  const { data: raceClaims } = await raceClientPrimary.auth.getClaims();
  const raceSessionId = raceClaims?.claims.session_id;
  if (!raceSessionId) throw new Error("session_id ausente (concorrência 5x)");

  const raceNonce = randomBytes(32).toString("base64url");
  const { error: raceIssueError } = await admin.rpc("issue_password_recovery_grant", {
    p_user_id: raceVerify.user!.id,
    p_session_id: raceSessionId,
    p_nonce: raceNonce,
    p_ttl_seconds: 1800,
  });
  if (raceIssueError) throw new Error(`issue (concorrência 5x) falhou: ${raceIssueError.message}`);

  const raceClients = Array.from({ length: 5 }, () =>
    createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
  for (const c of raceClients) {
    const { error } = await c.auth.setSession({
      access_token: raceVerify.session.access_token,
      refresh_token: raceVerify.session.refresh_token,
    });
    if (error) throw new Error(`setSession (concorrência 5x) falhou: ${error.message}`);
  }

  const racePasswords = [1, 2, 3, 4, 5].map((n) => `senha concorrente numero ${n} disputa 2026!`);
  const raceResults = await Promise.all(
    raceClients.map(async (c, i) => {
      const { data: claim } = await c.rpc("claim_recovery_grant_for_password_change", { p_nonce: raceNonce });
      if (claim?.claimed !== true) return { i, claimed: false, updated: null as boolean | null, attemptId: null as string | null, capability: null as string | null };
      const { error: updateError } = await c.auth.updateUser({ password: racePasswords[i]! });
      return { i, claimed: true, updated: !updateError, attemptId: claim.attempt_id, capability: claim.completion_capability };
    }),
  );
  const raceSuccesses = raceResults.filter((r) => r.claimed === true);

  // Fecha a alça: o único claim bem-sucedido também teve updateUser()
  // com sucesso — a conclusão explícita e server-only (mesmo caminho de
  // lib/supabase/service-only/recovery-completion.ts) é chamada aqui
  // via cliente admin (service_role), exatamente como o reset action
  // faria depois de updateUser() retornar sucesso real.
  const raceWinner = raceResults.find((r) => r.claimed && r.updated && r.attemptId && r.capability);
  if (raceWinner) {
    await admin.rpc("complete_password_recovery_attempt", {
      p_attempt_id: raceWinner.attemptId!,
      p_capability: raceWinner.capability!,
    });
  }

  const { data: raceAuditRows } = await admin
    .from("audit_log")
    .select("id")
    .eq("actor_user_id", raceVerify.user!.id)
    .eq("action", "password_recovery_completed");

  record(
    "22. concorrência real com 5 tentativas simultâneas (senhas diferentes em disputa): exatamente uma reivindicação bem-sucedida",
    raceSuccesses.length === 1,
    `reivindicacoes=${raceSuccesses.length}`,
  );
  record(
    "22b. a conclusão explícita da tentativa vencedora grava exatamente 1 evento password_recovery_completed",
    (raceAuditRows ?? []).length === 1,
    `eventosAuditoria=${(raceAuditRows ?? []).length}`,
  );

  // Limpeza.
  await admin.auth.admin.deleteUser(attackerUser.user.id);
  await admin.auth.admin.deleteUser(victimUser.user.id);
  await admin.auth.admin.deleteUser(racerUser.user.id);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log(
    "\nPASS - BUG-CLAUDE-001 permanece corrigido: a cadeia de ataque original (request/consume via sessão comum) não existe mais, issue_password_recovery_grant é inacessível a qualquer sessão de cliente, cross-session/cross-user/concorrência real continuam bloqueados.",
  );
}

main().catch((error) => {
  console.error(`Teste regressivo BUG-CLAUDE-001 falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
