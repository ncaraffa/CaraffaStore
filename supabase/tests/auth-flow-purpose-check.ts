/**
 * Teste real, ponta a ponta, contra Supabase local + a aplicação Next.js
 * rodando de verdade, para os bloqueadores 2 e 3 (BUG-RT2-003/004,
 * qa/reports/TASK-002-RETEST.md): um código de confirmação de cadastro
 * NUNCA pode funcionar em /auth/recovery, e um código de recuperação de
 * senha NUNCA pode funcionar em /auth/confirm — mesmo que a troca do
 * código em si (`exchangeCodeForSession`) tenha sucesso, já que o GoTrue
 * não vincula o código à rota Next.js que o consome. Também confirma
 * que os dois fluxos LEGÍTIMOS continuam funcionando (requisitos 6–11
 * da lista de testes regressivos obrigatórios daquele relatório).
 *
 * Usa QUATRO usuários independentes (um code PKCE por usuário/fluxo) em
 * vez de reenviar/pedir duas vezes para o mesmo e-mail: confirmado
 * empiricamente que `resend()`/uma segunda chamada de
 * `resetPasswordForEmail()` para o MESMO usuário não produz um segundo
 * código independentemente trocável no Supabase local (o e-mail
 * reenviado ainda referencia o token já consumido pela primeira troca)
 * — um detalhe do GoTrue local, não relacionado à finalidade sendo
 * testada aqui. Usuários distintos evitam esse problema por completo.
 *
 * Usa `@supabase/ssr` com um "cookie jar" próprio (mesmo padrão de
 * app/auth/confirm/route.ts) para capturar o cookie `code_verifier`
 * gravado no momento de `signUp()`/`resetPasswordForEmail()` — sem ele,
 * a troca de código na rota real falharia por um motivo totalmente
 * diferente do que este teste quer provar (variável PKCE ausente, não
 * finalidade incompatível). Isso reproduz fielmente o navegador: o
 * cookie do passo 1 é reenviado manualmente ao passo final, exatamente
 * como o navegador faria sozinho.
 *
 * Requer DOIS processos rodando:
 *   - Supabase local: npx supabase start && npx supabase db reset && npm run seed:local
 *   - Next.js: npm run dev -- --port 3000 (ou npm run build && npm start)
 *
 * Como rodar:
 *   npx tsx supabase/tests/auth-flow-purpose-check.ts
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { loadLocalEnv } from "../../lib/env/load-local-env";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { getPublicSupabaseEnv } from "../../lib/supabase/env";
import { absoluteUrl, getSiteUrl } from "../../lib/auth/site-url";
import type { Database } from "../../lib/supabase/types";

const DEV_ONLY_PASSWORD = "dev-local-only-not-a-real-secret-123!";
const MAILPIT_URL = "http://127.0.0.1:54324";

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

interface CookieJar {
  jar: Map<string, string>;
  client: ReturnType<typeof createServerClient<Database>>;
}

function makeJarClient(): CookieJar {
  const env = getPublicSupabaseEnv();
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) {
          jar.set(name, value);
        }
      },
    },
  });
  return { jar, client };
}

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function latestMessageId(email: string, subjectContains: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50`);
    const body = (await res.json()) as {
      messages: { ID: string; To: { Address: string }[]; Subject: string; Created: string }[];
    };
    const candidates = body.messages
      .filter(
        (m) =>
          m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()) && m.Subject.includes(subjectContains),
      )
      .sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
    if (candidates.length > 0) return candidates[0]!.ID;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Nenhum e-mail "${subjectContains}" encontrado para ${email} no Mailpit.`);
}

async function extractVerifyUrl(messageId: string): Promise<string> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`);
  const body = (await res.json()) as { Text: string };
  const match = body.Text.match(/\(\s*(http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?\S+)\s*\)/);
  if (!match) throw new Error("Link de verificação não encontrado no corpo do e-mail.");
  return match[1]!;
}

/** Segue o link do e-mail no GoTrue e devolve o `code` PKCE da URL de redirect final. */
async function resolveCode(verifyUrl: string): Promise<string> {
  const res = await fetch(verifyUrl, { redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) throw new Error(`GoTrue não redirecionou para ${verifyUrl} (status ${res.status}).`);
  const code = new URL(location).searchParams.get("code");
  if (!code) throw new Error(`Location sem parâmetro code: ${location}`);
  return code;
}

interface RouteResult {
  status: number;
  /** Path + query do Location, SEM origem — o Next.js dev server às vezes
   * devolve o Location com host `localhost` mesmo quando a requisição
   * usou `127.0.0.1` (mesma característica ambiental documentada em
   * docs/handoff.md; GoTrue em si sempre devolve o host correto). Só o
   * caminho importa para este teste, nunca o host. */
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

async function hitRoute(path: string, code: string, extraCookieHeader: string): Promise<RouteResult> {
  const res = await fetch(`${getSiteUrl()}${path}?code=${encodeURIComponent(code)}`, {
    redirect: "manual",
    headers: extraCookieHeader ? { cookie: extraCookieHeader } : undefined,
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

async function deleteIfExists(admin: ReturnType<typeof createAdminSupabaseClient>, email: string) {
  const { data } = await admin.auth.admin.listUsers();
  const existing = data.users.find((u) => u.email === email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
}

async function signUpAndGetConfirmCode(email: string): Promise<{ jar: Map<string, string>; code: string }> {
  const { jar, client } = makeJarClient();
  const { error } = await client.auth.signUp({
    email,
    password: DEV_ONLY_PASSWORD,
    options: { emailRedirectTo: absoluteUrl("/auth/confirm") },
  });
  if (error) throw new Error(`signUp(${email}) falhou: ${error.message}`);
  const code = await resolveCode(await extractVerifyUrl(await latestMessageId(email, "Confirm your email")));
  return { jar, code };
}

async function requestRecoveryAndGetCode(email: string): Promise<{ jar: Map<string, string>; code: string }> {
  const { jar, client } = makeJarClient();
  // Mesma sequência de app/(auth)/forgot-password/actions.ts: grava o
  // pedido pendente ANTES de disparar o e-mail, com um cliente anon
  // (nunca service_role — request_password_recovery_grant só concede
  // EXECUTE a anon/authenticated) — sem isso,
  // consume_auth_flow_grant('password_recovery') não encontra nada
  // para consumir e o fluxo legítimo também seria (corretamente)
  // rejeitado, mascarando o que este teste quer provar.
  const { error: grantError } = await client.rpc("request_password_recovery_grant", { p_email: email });
  if (grantError) throw new Error(`request_password_recovery_grant(${email}) falhou: ${grantError.message}`);

  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: absoluteUrl("/auth/recovery"),
  });
  if (error) throw new Error(`resetPasswordForEmail(${email}) falhou: ${error.message}`);
  const code = await resolveCode(await extractVerifyUrl(await latestMessageId(email, "Reset your password")));
  return { jar, code };
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
  // Requisito 6/7: código de CONFIRMAÇÃO trocado manualmente em
  // /auth/recovery precisa falhar e não deixar nenhuma sessão viva.
  // ============================================================
  const cross1 = await signUpAndGetConfirmCode(EMAIL_CROSS_CONFIRM_TO_RECOVERY);
  const crossResult1 = await hitRoute("/auth/recovery", cross1.code, cookieHeader(cross1.jar));
  const survives1 = await sessionSurvives(crossResult1.cookies.map((c) => c.split(";")[0]).join("; "));
  record(
    "Requisito 6/7 (BUG-RT2-003): código de confirmação em /auth/recovery",
    crossResult1.path === "/login?error=invalid_link" && !survives1,
    `redirect=${crossResult1.path}, sessão sobrevivente=${survives1}`,
  );

  // ============================================================
  // Requisito 10: confirmação LEGÍTIMA (código correto na rota
  // correta) continua funcionando.
  // ============================================================
  const legit1 = await signUpAndGetConfirmCode(EMAIL_LEGIT_CONFIRM);
  const legitConfirmResult = await hitRoute("/auth/confirm", legit1.code, cookieHeader(legit1.jar));
  const { data: usersAfterConfirm } = await admin.auth.admin.listUsers();
  const legitConfirmUser = usersAfterConfirm.users.find((u) => u.email === EMAIL_LEGIT_CONFIRM);
  record(
    "Requisito 10: confirmação legítima continua funcionando",
    legitConfirmResult.path === "/" && Boolean(legitConfirmUser?.email_confirmed_at),
    `redirect=${legitConfirmResult.path}, email_confirmed_at=${legitConfirmUser?.email_confirmed_at}`,
  );

  // ============================================================
  // Requisito 8/9: código de RECUPERAÇÃO trocado manualmente em
  // /auth/confirm precisa falhar e não liberar onboarding/sessão comum.
  // A conta é confirmada pelo fluxo legítimo primeiro (grant de
  // confirmação já consumido — cenário real reproduzido pelo Júnior),
  // então não há nada pendente para /auth/confirm ativar.
  // ============================================================
  const establish2 = await signUpAndGetConfirmCode(EMAIL_CROSS_RECOVERY_TO_CONFIRM);
  const establishResult2 = await hitRoute("/auth/confirm", establish2.code, cookieHeader(establish2.jar));
  if (establishResult2.path !== "/") {
    throw new Error(
      `Preparo de ${EMAIL_CROSS_RECOVERY_TO_CONFIRM} falhou: /auth/confirm não confirmou a conta (redirect=${establishResult2.path}).`,
    );
  }
  const cross2 = await requestRecoveryAndGetCode(EMAIL_CROSS_RECOVERY_TO_CONFIRM);
  const crossResult2 = await hitRoute("/auth/confirm", cross2.code, cookieHeader(cross2.jar));
  const survives2 = await sessionSurvives(crossResult2.cookies.map((c) => c.split(";")[0]).join("; "));
  record(
    "Requisito 8/9 (BUG-RT2-004): código de recuperação em /auth/confirm",
    crossResult2.path === "/login?error=invalid_link" && !survives2,
    `redirect=${crossResult2.path}, sessão sobrevivente=${survives2}`,
  );

  // ============================================================
  // Requisito 11: recuperação LEGÍTIMA continua funcionando —
  // /auth/recovery com o code correto deve chegar a /reset-password com
  // uma sessão de recuperação ativa. Conta também precisa estar
  // confirmada primeiro (fluxo real: só se recupera senha de uma conta
  // existente/confirmada).
  // ============================================================
  const establish3 = await signUpAndGetConfirmCode(EMAIL_LEGIT_RECOVERY);
  const establishResult3 = await hitRoute("/auth/confirm", establish3.code, cookieHeader(establish3.jar));
  if (establishResult3.path !== "/") {
    throw new Error(
      `Preparo de ${EMAIL_LEGIT_RECOVERY} falhou: /auth/confirm não confirmou a conta (redirect=${establishResult3.path}).`,
    );
  }
  const legit2 = await requestRecoveryAndGetCode(EMAIL_LEGIT_RECOVERY);
  const legitRecoveryResult = await hitRoute("/auth/recovery", legit2.code, cookieHeader(legit2.jar));
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

  console.log("\nPASS - troca cruzada de códigos PKCE bloqueada nos dois sentidos; fluxos legítimos continuam funcionando.");
}

main().catch((error) => {
  console.error(`Teste de finalidade de fluxo falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
