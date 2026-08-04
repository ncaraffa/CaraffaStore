import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

/**
 * Callback de confirmação de CADASTRO apenas — recuperação de senha tem
 * sua própria rota dedicada (app/auth/recovery/route.ts).
 *
 * Terceira correção pós-QA (revisão externa sobre
 * qa/reports/TASK-002-CLAUDE-VERIFICATION.md): esta rota não aceita mais
 * `code` (PKCE) nem lê `type` da query string — só `token_hash`. O
 * `type` passado a `verifyOtp` é HARDCODED como `"signup"` aqui embaixo,
 * nunca vindo da URL: mesmo que alguém construa um link com
 * `?token_hash=<qualquer coisa>&type=recovery`, o valor de `type` na
 * query é ignorado por completo — só o `token_hash` é lido, e é
 * verificado contra o tipo fixo desta rota. Se aquele token_hash não foi
 * realmente emitido pelo GoTrue como `signup`, `verifyOtp` falha —
 * quem decide a finalidade é o GoTrue (que sabe para que tipo cada
 * token_hash foi emitido), nunca um parâmetro que o cliente controla.
 *
 * Isso fecha a limitação da versão anterior (baseada em
 * `exchangeCodeForSession`, que troca qualquer código PKCE válido
 * independentemente da finalidade original — daí a necessidade de uma
 * tabela de "grant pendente" separada, que por sua vez permitiu
 * BUG-CLAUDE-001/002, qa/reports/TASK-002-CLAUDE-VERIFICATION.md): com
 * `verifyOtp({type:"signup", token_hash})`, a prova de finalidade é
 * inteiramente do GoTrue — não existe mais nenhum grant/RPC de
 * confirmação para uma sessão comum fabricar.
 *
 * O e-mail de confirmação (supabase/templates/confirmation.html) aponta
 * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
 * diretamente para esta rota — não passa mais pelo endpoint
 * `/auth/v1/verify` hospedado pelo GoTrue.
 *
 * `email_confirmed_at` é gravado pelo próprio GoTrue dentro de
 * `verifyOtp` quando a verificação é real; o evento de auditoria
 * `email_verification_completed` nasce de um TRIGGER em `auth.users`
 * (supabase/migrations/0004_account_audit.sql) na transição
 * `email_confirmed_at: null -> not null` — nenhuma RPC separada existe
 * para este evento.
 *
 * IMPORTANTE: diferente de Server Components/Actions, este Route
 * Handler vincula os cookies diretamente a UM ÚNICO NextResponse final,
 * construído só no retorno — acumula todo cookie que o Supabase pedir
 * para gravar numa lista, em vez de recriar um NextResponse a cada
 * chamada de `setAll`.
 *
 * `token_hash`/a URL completa NUNCA são logados aqui, nem em caso de
 * erro.
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

  if (tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({ type: "signup", token_hash: tokenHash });
    if (!error && data.user) {
      return redirectTo("/");
    }
  }

  // token_hash ausente/inválido/expirado/reutilizado/de finalidade
  // incompatível — sempre a mesma resposta, sem detalhar o motivo.
  return redirectTo("/login?error=invalid_link");
}
