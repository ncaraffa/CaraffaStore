import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

/**
 * Callback de confirmação de CADASTRO apenas — recuperação de senha tem
 * sua própria rota dedicada (app/auth/recovery/route.ts). A separação
 * existe porque não há sinal do GoTrue, depois da troca de código, que
 * diga se um `code` PKCE veio de um fluxo de cadastro ou de recuperação
 * — usar um parâmetro de query como `next`/`type` para decidir isso era
 * exatamente o BUG-T2-003 (qa/reports/TASK-002.md): o cliente controla a
 * query string. Com rotas separadas, é a PRÓPRIA ROTA executada —
 * decidida só pelo `emailRedirectTo`/`redirectTo` que o servidor
 * configurou ao disparar o e-mail — que classifica o fluxo, nunca uma
 * entrada do cliente.
 *
 * Este cliente Supabase (@supabase/ssr) usa o fluxo PKCE por padrão: o
 * link do e-mail aponta para o `/auth/v1/verify` do GoTrue, que valida o
 * token e redireciona para cá com `?code=...` (não `token_hash`/`type`
 * como no fluxo antigo/implícito) — `exchangeCodeForSession` troca esse
 * código pela sessão. Mantemos `token_hash`/`type=signup` como caminho
 * alternativo só por robustez, caso a configuração de flow mude.
 *
 * IMPORTANTE: diferente de Server Components/Actions (onde
 * lib/supabase/server.ts grava cookies via a API ambiente `cookies()` de
 * `next/headers`, mesclada automaticamente na resposta pelo Next.js),
 * este Route Handler retorna seu próprio `NextResponse.redirect(...)`
 * explícito — por isso o cliente Supabase é criado aqui com os cookies
 * vinculados diretamente a ESSE objeto de resposta (mesmo padrão do
 * proxy.ts). Sem isso, a sessão criada pela troca de código nunca chega
 * ao navegador e a próxima requisição (ex.: "/") não a reconhece.
 *
 * `code`/`token_hash`/a URL completa NUNCA são logados aqui, nem em caso
 * de erro — só o resultado (sucesso/falha) vai para a auditoria, via
 * função SECURITY DEFINER (nunca service role — BUG-T2-004).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  let response = NextResponse.redirect(new URL("/", request.url));

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
        response = NextResponse.redirect(new URL("/", request.url));
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  async function afterSuccess() {
    // Falha ao gravar a auditoria não pode passar em silêncio (era
    // exatamente o catch vazio do BUG-T2-004), mas também não pode
    // impedir um cadastro que já foi confirmado com sucesso de
    // completar — não há "rollback" possível aqui: a confirmação já
    // aconteceu no GoTrue (sistema externo, transação própria dele).
    const { error } = await supabase.rpc("log_email_verification_completed");
    if (error) {
      console.error("[auth/confirm] falha ao registrar auditoria:", error.message);
    }
    return response;
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      return afterSuccess();
    }
  } else if (tokenHash && type === "signup") {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      return afterSuccess();
    }
  }

  // Código/token ausente/inválido/expirado/reutilizado — sempre a mesma
  // resposta, sem detalhar o motivo.
  return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
}
