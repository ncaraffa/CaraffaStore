import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { issuePasswordRecoveryGrant } from "@/lib/supabase/service-only/recovery-grant-issuer";
import { RECOVERY_GRANT_TTL_SECONDS, RECOVERY_NONCE_COOKIE } from "@/lib/tenant/recovery-session";

/**
 * Callback de RECUPERAÇÃO DE SENHA apenas — confirmação de cadastro tem
 * sua própria rota dedicada (app/auth/confirm/route.ts).
 *
 * Terceira correção pós-QA (revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-001): esta rota
 * não aceita mais `code` (PKCE) nem lê `type` da query string — só
 * `token_hash`. O `type` passado a `verifyOtp` é HARDCODED como
 * `"recovery"` aqui embaixo. Se o token_hash apresentado não foi
 * realmente emitido pelo GoTrue como recovery (ex.: é um token de
 * signup), `verifyOtp` falha — a prova de finalidade é inteiramente do
 * GoTrue, nunca de um parâmetro que o cliente controla ou de uma tabela
 * de "intenção pendente" que qualquer sessão comum conseguia ativar
 * sozinha (BUG-CLAUDE-001).
 *
 * Depois de `verifyOtp` confirmar o token de verdade, esta rota chama
 * `issuePasswordRecoveryGrant` (lib/supabase/service-only/recovery-grant-issuer.ts)
 * — o ÚNICO jeito de criar uma linha em `public.password_recovery_grants`,
 * chamável apenas com a SUPABASE_SERVICE_ROLE_KEY (nunca exposta ao
 * navegador), com `user_id`/`session_id` vindos da própria resposta do
 * GoTrue a ESTA chamada de verifyOtp — nunca de um parâmetro arbitrário.
 * Um nonce aleatório de 256 bits é gerado aqui, devolvido ao navegador
 * num cookie HttpOnly `path=/reset-password`, e só o HASH dele é
 * gravado no banco — `claim_recovery_grant_for_password_change` exige
 * esse nonce de volta para reivindicar a troca de senha
 * (app/(auth)/reset-password/actions.ts).
 *
 * Se a emissão do grant falhar por qualquer motivo DEPOIS de uma
 * verificação real ter criado uma sessão, a sessão é encerrada
 * (`signOut()`) antes do redirecionamento — nunca deixamos uma sessão
 * "verificada como recovery" sobreviver sem o grant correspondente que a
 * restringe a /reset-password (lib/auth/middleware-policy.ts).
 *
 * O e-mail de recuperação (supabase/templates/recovery.html) aponta
 * `{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&type=recovery`
 * diretamente para esta rota — não passa mais pelo endpoint
 * `/auth/v1/verify` hospedado pelo GoTrue.
 *
 * IMPORTANTE: diferente de Server Components/Actions, este Route
 * Handler vincula os cookies diretamente a UM ÚNICO NextResponse final,
 * construído só no retorno — acumula todo cookie que o Supabase pedir
 * para gravar (troca de código, signOut) numa lista, em vez de recriar
 * um NextResponse a cada chamada de `setAll`.
 *
 * `token_hash`/nonce/a URL completa NUNCA são logados aqui, nem em caso
 * de erro.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");

  const pendingCookies: { name: string; value: string; options: CookieOptions }[] = [];

  const env = getPublicSupabaseEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  function redirectTo(path: string): NextResponse {
    const target = NextResponse.redirect(new URL(path, request.url));
    for (const { name, value, options } of pendingCookies) {
      target.cookies.set(name, value, options);
    }
    return target;
  }

  if (!tokenHash) {
    return redirectTo("/login?error=invalid_link");
  }

  const { data, error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error || !data.user) {
    return redirectTo("/login?error=invalid_link");
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const sessionId = claimsData?.claims.session_id;

  if (claimsError || !sessionId) {
    await supabase.auth.signOut();
    return redirectTo("/login?error=invalid_link");
  }

  try {
    const nonce = randomBytes(32).toString("base64url");
    await issuePasswordRecoveryGrant({
      userId: data.user.id,
      sessionId,
      nonce,
      ttlSeconds: RECOVERY_GRANT_TTL_SECONDS,
    });

    const response = redirectTo("/reset-password");
    response.cookies.set(RECOVERY_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/reset-password",
      maxAge: RECOVERY_GRANT_TTL_SECONDS,
    });
    return response;
  } catch {
    // Verificação real aconteceu mas a emissão do grant falhou (ex.:
    // erro de banco) — nunca deixar essa sessão "verificada como
    // recovery" sobreviver sem o grant que a restringe.
    await supabase.auth.signOut();
    return redirectTo("/login?error=invalid_link");
  }
}
