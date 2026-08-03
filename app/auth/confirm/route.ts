import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { logAuditEvent } from "@/lib/audit/log";
import { safeRedirectTarget } from "@/lib/auth/redirects";

/**
 * Callback único de confirmação de e-mail E de recuperação de senha —
 * mesma URL configurada em supabase/config.toml [auth]
 * additional_redirect_urls e usada como emailRedirectTo/redirectTo nas
 * duas Server Actions que disparam e-mail
 * (app/(auth)/signup/actions.ts, app/(auth)/forgot-password/actions.ts).
 *
 * Este cliente Supabase (@supabase/ssr) usa o fluxo PKCE por padrão: o
 * link do e-mail aponta para o `/auth/v1/verify` do GoTrue, que valida o
 * token e redireciona para cá com `?code=...` (não `token_hash`/`type`
 * como no fluxo antigo/implícito) — `exchangeCodeForSession` troca esse
 * código pela sessão. Mantemos `token_hash`/`type` como caminho
 * alternativo só por robustez, caso a configuração de flow mude.
 *
 * Cadastro e recuperação usam o MESMO código de troca; não há sinal do
 * GoTrue para diferenciá-los depois do exchange. Por isso a Server
 * Action de recuperação passa `?next=/reset-password` no próprio
 * `redirectTo` — o GoTrue preserva essa query ao anexar `code`, e esse
 * valor decide tanto o destino final quanto se o evento de auditoria de
 * verificação de cadastro deve ser registrado (recuperação tem seu
 * próprio evento, registrado só depois da troca de senha em
 * /reset-password).
 *
 * IMPORTANTE: diferente de Server Components/Actions (onde
 * lib/supabase/server.ts grava cookies via a API ambiente `cookies()` de
 * `next/headers`, mesclada automaticamente na resposta pelo Next.js),
 * este Route Handler retorna seu próprio `NextResponse.redirect(...)`
 * explícito — por isso o cliente Supabase é criado aqui com os cookies
 * vinculados diretamente a ESSE objeto de resposta (mesmo padrão do
 * proxy.ts), não ao helper compartilhado. Sem isso, a sessão criada pela
 * troca de código nunca chega ao navegador e a próxima requisição (ex.:
 * "/") não a reconhece.
 *
 * `code`/`token_hash`/a URL completa NUNCA são logados aqui, nem em caso
 * de erro — só o resultado (sucesso/falha) e, em sucesso, o id do
 * usuário (não sensível) vão para a auditoria.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeRedirectTarget(searchParams.get("next"), "/");
  const isRecovery = next === "/reset-password" || type === "recovery";

  let response = NextResponse.redirect(new URL(next, request.url));

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
        response = NextResponse.redirect(new URL(next, request.url));
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  async function afterSuccess(userId: string) {
    if (!isRecovery) {
      await logAuditEvent({
        actorUserId: userId,
        action: "email_verification_completed",
        targetType: "auth_user",
        targetId: userId,
      });
    }
    return response;
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      return afterSuccess(data.user.id);
    }
  } else if (tokenHash && (type === "signup" || type === "recovery")) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      return afterSuccess(data.user.id);
    }
  }

  // Código/token ausente/inválido/expirado/reutilizado — sempre a mesma
  // resposta, sem detalhar o motivo.
  return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
}
