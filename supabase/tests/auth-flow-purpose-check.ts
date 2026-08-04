/**
 * Teste real, ponta a ponta, contra Supabase local + a aplicação Next.js
 * rodando de verdade, para os bloqueadores 2 e 3 (BUG-RT2-003/004,
 * qa/reports/TASK-002-RETEST.md): um token de confirmação de cadastro
 * NUNCA pode funcionar em /auth/recovery, e um token de recuperação de
 * senha NUNCA pode funcionar em /auth/confirm. Também confirma que os
 * dois fluxos LEGÍTIMOS continuam funcionando (requisitos 6-11 da lista
 * de testes regressivos obrigatórios daquele relatório).
 *
 * Terceira correção pós-QA (revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-001): as rotas
 * não aceitam mais `code` (PKCE) — só `token_hash`, com `type` hardcoded
 * por rota e passado a `supabase.auth.verifyOtp`. Isso simplifica
 * bastante este teste: `verifyOtp({token_hash})` não precisa de nenhum
 * cookie `code_verifier` (diferente de `exchangeCodeForSession`), então
 * não há mais necessidade de um "cookie jar" próprio nem de round-trip
 * por Mailpit — `admin.auth.admin.generateLink()` já devolve um
 * `token_hash` real, genuinamente emitido pelo GoTrue, pronto para
 * apresentar à rota via HTTP puro.
 *
 * A separação de finalidade agora é garantida pelo próprio GoTrue: um
 * `token_hash` emitido como `signup` só passa em
 * `verifyOtp({type:"signup", token_hash})`; um `token_hash` de
 * `recovery` só passa em `verifyOtp({type:"recovery", token_hash})`. As
 * rotas nunca leem `type` da query string — só o valor fixo por rota.
 *
 * Requer DOIS processos rodando:
 *   - Supabase local: npx supabase start && npx supabase db reset && npm run seed:local
 *   - Next.js: npm run dev -- --port 3000 (ou npm run build && npm start)
 *
 * Como rodar:
 *   npx tsx supabase/tests/auth-flow-purpose-check.ts
 */
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getSiteUrl } from "../../lib/auth/site-url";

const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";

const EMAIL_CROSS_CONFIRM_TO_RECOVERY = "purpose-check-cross-1@example.test";
const EMAIL_LEGIT_CONFIRM = "purpose-check-legit-confirm@example.test";
const EMAIL_CROSS_RECOVERY_TO_CONFIRM = "purpose-check-cross-2@example.test";
const EMAIL_LEGIT_RECOVERY = "purpose-check-legit-recovery@example.test";
const ALL_EMAILS = [
  EMAIL_CROSS_CONFIRM_TO_RECOVERY,
  EMAIL_LEGIT_CONFIRM,
  EMAIL_CROSS_RECOVERY_TO_CONFIRM,
  EMAIL_LEGIT_RECOVERY,
];

interface RouteResult {
  status: number;
  /** Path + query do Location, SEM origem — o Next.js dev server às vezes
   * devolve o Location com host `localhost` mesmo quando a requisição
   * usou `127.0.0.1`. Só o caminho importa para este teste. */
  path: string;
  cookies: string[];
}

function pathOf(location: string | null): string {
  if (!location) return "";
  try {
    const url = new URL(location, getSiteUrl());
    return `${url.pathname}${url.search}`;
  } catch {
    return location;
  }
}

async function hitRoute(path: string, tokenHash: string): Promise<RouteResult> {
  const res = await fetch(`${getSiteUrl()}${path}?token_hash=${encodeURIComponent(tokenHash)}`, {
    redirect: "manual",
  });
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, path: pathOf(res.headers.get("location")), cookies };
}

/** true = alguma sessão utilizável sobrevive com estes cookies (checa via GET /, nunca cai em /login se houver sessão). */
async function sessionSurvives(cookieHeaderValue: string): Promise<boolean> {
  const res = await fetch(`${getSiteUrl()}/`, {
    redirect: "manual",
    headers: cookieHeaderValue ? { cookie: cookieHeaderValue } : undefined,
  });
  const path = pathOf(res.headers.get("location"));
  return !path.startsWith("/login");
}

function cookieHeaderFromSetCookies(setCookies: string[]): string {
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

async function deleteIfExists(admin: ReturnType<typeof createAdminSupabaseClient>, email: string) {
  const { data } = await admin.auth.admin.listUsers();
  const existing = data.users.find((u) => u.email === email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
}

async function generateSignupTokenHash(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  email: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password: DEV_ONLY_PASSWORD,
  });
  if (error || !data?.properties?.hashed_token) {
    throw new Error(`generateLink(signup, ${email}) falhou: ${error?.message ?? "sem hashed_token"}`);
  }
  return data.properties.hashed_token;
}

async function generateRecoveryTokenHash(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  email: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) {
    throw new Error(`generateLink(recovery, ${email}) falhou: ${error?.message ?? "sem hashed_token"}`);
  }
  return data.properties.hashed_token;
}

async function main() {
  const { loadedEnvFiles } = loadLocalEnv();
  if (loadedEnvFiles.length > 0) {
    console.log(`Ambiente carregado de: ${loadedEnvFiles.join(", ")}\n`);
  }

  const admin = createAdminSupabaseClient();
  for (const email of ALL_EMAILS) {
    await deleteIfExists(admin, email);
  }

  const results: { label: string; pass: boolean; detail: string }[] = [];
  function record(label: string, pass: boolean, detail: string) {
    results.push({ label, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"} - ${label}: ${detail}`);
  }

  // ============================================================
  // Requisito 6/7: token de CONFIRMAÇÃO apresentado em /auth/recovery
  // precisa falhar e não deixar nenhuma sessão viva.
  // ============================================================
  const confirmTokenHash1 = await generateSignupTokenHash(admin, EMAIL_CROSS_CONFIRM_TO_RECOVERY);
  const crossResult1 = await hitRoute("/auth/recovery", confirmTokenHash1);
  const survives1 = await sessionSurvives(cookieHeaderFromSetCookies(crossResult1.cookies));
  record(
    "Requisito 6/7 (BUG-RT2-003): token de confirmação em /auth/recovery",
    crossResult1.path === "/login?error=invalid_link" && !survives1,
    `redirect=${crossResult1.path}, sessão sobrevivente=${survives1}`,
  );

  // ============================================================
  // Requisito 10: confirmação LEGÍTIMA (token correto na rota correta)
  // continua funcionando.
  // ============================================================
  const confirmTokenHash2 = await generateSignupTokenHash(admin, EMAIL_LEGIT_CONFIRM);
  const legitConfirmResult = await hitRoute("/auth/confirm", confirmTokenHash2);
  const { data: usersAfterConfirm } = await admin.auth.admin.listUsers();
  const legitConfirmUser = usersAfterConfirm.users.find((u) => u.email === EMAIL_LEGIT_CONFIRM);
  record(
    "Requisito 10: confirmação legítima continua funcionando",
    legitConfirmResult.path === "/" && Boolean(legitConfirmUser?.email_confirmed_at),
    `redirect=${legitConfirmResult.path}, email_confirmed_at=${legitConfirmUser?.email_confirmed_at}`,
  );

  // ============================================================
  // Requisito 8/9: token de RECUPERAÇÃO apresentado em /auth/confirm
  // precisa falhar e não liberar onboarding/sessão comum. A conta é
  // confirmada pelo fluxo legítimo primeiro (cenário real: um atacante
  // com o e-mail de recuperação de uma conta JÁ confirmada tenta usá-lo
  // em /auth/confirm).
  // ============================================================
  const establishTokenHash2 = await generateSignupTokenHash(admin, EMAIL_CROSS_RECOVERY_TO_CONFIRM);
  const establishResult2 = await hitRoute("/auth/confirm", establishTokenHash2);
  if (establishResult2.path !== "/") {
    throw new Error(
      `Preparo de ${EMAIL_CROSS_RECOVERY_TO_CONFIRM} falhou: /auth/confirm não confirmou a conta (redirect=${establishResult2.path}).`,
    );
  }
  const recoveryTokenHash2 = await generateRecoveryTokenHash(admin, EMAIL_CROSS_RECOVERY_TO_CONFIRM);
  const crossResult2 = await hitRoute("/auth/confirm", recoveryTokenHash2);
  const survives2 = await sessionSurvives(cookieHeaderFromSetCookies(crossResult2.cookies));
  record(
    "Requisito 8/9 (BUG-RT2-004): token de recuperação em /auth/confirm",
    crossResult2.path === "/login?error=invalid_link" && !survives2,
    `redirect=${crossResult2.path}, sessão sobrevivente=${survives2}`,
  );

  // ============================================================
  // Requisito 11: recuperação LEGÍTIMA continua funcionando —
  // /auth/recovery com o token_hash correto deve chegar a
  // /reset-password com uma sessão de recuperação ativa (conta também
  // precisa estar confirmada primeiro).
  // ============================================================
  const establishTokenHash3 = await generateSignupTokenHash(admin, EMAIL_LEGIT_RECOVERY);
  const establishResult3 = await hitRoute("/auth/confirm", establishTokenHash3);
  if (establishResult3.path !== "/") {
    throw new Error(
      `Preparo de ${EMAIL_LEGIT_RECOVERY} falhou: /auth/confirm não confirmou a conta (redirect=${establishResult3.path}).`,
    );
  }
  const recoveryTokenHash3 = await generateRecoveryTokenHash(admin, EMAIL_LEGIT_RECOVERY);
  const legitRecoveryResult = await hitRoute("/auth/recovery", recoveryTokenHash3);
  record(
    "Requisito 11: recuperação legítima continua funcionando",
    legitRecoveryResult.path === "/reset-password",
    `redirect=${legitRecoveryResult.path}`,
  );

  // Limpeza.
  for (const email of ALL_EMAILS) {
    await deleteIfExists(admin, email);
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`${failed.length} verificação(ões) falharam — ver detalhes acima.`);
  }

  console.log("\nPASS - troca cruzada de token_hash bloqueada nos dois sentidos; fluxos legítimos continuam funcionando.");
}

main().catch((error) => {
  console.error(`Teste de finalidade de fluxo falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
