import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

/**
 * Callback de confirmação de CADASTRO apenas — recuperação de senha tem
 * sua própria rota dedicada (app/auth/recovery/route.ts).
 *
 * O reteste do Júnior (qa/reports/TASK-002-RETEST.md, BUG-RT2-003/004)
 * provou que separar as ROTAS não é suficiente: `exchangeCodeForSession`/
 * `verifyOtp` do GoTrue devolvem uma sessão válida para QUALQUER código
 * de e-mail legítimo, sem vincular o código à rota Next.js que o
 * consumiu — um código de RECUPERAÇÃO trocado manualmente aqui também
 * "funcionava", concedendo uma sessão comum plena (acesso a onboarding
 * etc.) sem jamais ter passado pela restrição de /reset-password.
 *
 * Por isso, depois da troca de código, esta rota exige explicitamente
 * `consume_auth_flow_grant('email_confirmation')` — só retorna `true`
 * se existir um pedido de CONFIRMAÇÃO pendente e não expirado para
 * exatamente este usuário (criado automaticamente por um trigger em
 * `auth.users` quando a conta foi criada, nunca por uma chamada de
 * cliente — ver supabase/migrations/0003_recovery_session.sql). Um
 * código de recuperação, mesmo trocado com sucesso, não corresponde a
 * nenhum pedido de confirmação pendente — a checagem falha e a sessão
 * recém-criada é IMEDIATAMENTE encerrada (`signOut()`) antes do
 * redirecionamento. Nenhuma sessão sobrevive a uma troca de finalidade
 * incompatível, nos dois sentidos (ver também app/auth/recovery/route.ts).
 *
 * IMPORTANTE: diferente de Server Components/Actions, este Route
 * Handler vincula os cookies diretamente a UM ÚNICO NextResponse final,
 * construído só no retorno — acumula todo cookie que o Supabase pedir
 * para gravar (troca de código, signOut) numa lista, em vez de recriar
 * um NextResponse a cada chamada de `setAll` (o padrão anterior perdia
 * cookies de uma chamada anterior sempre que `setAll` disparava de
 * novo, ex.: exchange seguido de signOut).
 *
 * `code`/`token_hash`/a URL completa NUNCA são logados aqui, nem em caso
 * de erro.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

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

  async function exchanged(): Promise<boolean> {
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      return !error && Boolean(data.user);
    }
    if (tokenHash && type === "signup") {
      const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      return !error && Boolean(data.user);
    }
    return false;
  }

  if (await exchanged()) {
    const { data: consumed, error: consumeError } = await supabase.rpc("consume_auth_flow_grant", {
      p_purpose: "email_confirmation",
    });

    if (!consumeError && consumed === true) {
      return redirectTo("/");
    }

    // Código trocado com sucesso, mas sem pedido de confirmação
    // pendente correspondente (ex.: era um código de recuperação —
    // BUG-RT2-004). A auditoria de confirmação já teria sido gravada
    // dentro de consume_auth_flow_grant se fosse legítimo; aqui não há
    // nada a fazer além de encerrar a sessão que a troca de código
    // acabou de criar.
    await supabase.auth.signOut();
  }

  // Código/token ausente/inválido/expirado/reutilizado/de finalidade
  // incompatível — sempre a mesma resposta, sem detalhar o motivo.
  return redirectTo("/login?error=invalid_link");
}
