import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

/**
 * Callback de RECUPERAÇÃO DE SENHA apenas — confirmação de cadastro tem
 * sua própria rota dedicada (app/auth/confirm/route.ts). Ver o
 * comentário daquela rota para a explicação completa de por que separar
 * as ROTAS sozinho não bastava (qa/reports/TASK-002-RETEST.md,
 * BUG-RT2-003/004): `exchangeCodeForSession`/`verifyOtp` não vinculam o
 * código à rota que o consumiu.
 *
 * Depois da troca de código, esta rota exige
 * `consume_auth_flow_grant('password_recovery')` — só `true` se existir
 * um pedido de recuperação PENDENTE e não expirado para exatamente este
 * usuário, criado por `request_password_recovery_grant()`
 * (app/(auth)/forgot-password/actions.ts) ANTES do e-mail ser
 * disparado. Um código de CONFIRMAÇÃO de cadastro trocado manualmente
 * aqui não corresponde a nenhum pedido de recuperação pendente — a
 * checagem falha e a sessão é encerrada imediatamente (BUG-RT2-003).
 *
 * Também fecha BUG-RT2-001 (qa/reports/TASK-002-RETEST.md): não há
 * nenhuma tabela em que uma sessão comum possa inserir a própria linha
 * — `consume_auth_flow_grant` só ativa um pedido que JÁ existia antes
 * desta troca de código, nunca cria um do zero.
 *
 * Sempre redireciona para /reset-password em caso de sucesso — não há
 * `next` configurável aqui.
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
    if (tokenHash && type === "recovery") {
      const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      return !error && Boolean(data.user);
    }
    return false;
  }

  if (await exchanged()) {
    const { data: consumed, error: consumeError } = await supabase.rpc("consume_auth_flow_grant", {
      p_purpose: "password_recovery",
    });

    if (!consumeError && consumed === true) {
      return redirectTo("/reset-password");
    }

    // Código trocado com sucesso, mas sem pedido de recuperação
    // pendente correspondente (ex.: era um código de confirmação de
    // cadastro — BUG-RT2-003). Encerra a sessão que a troca acabou de
    // criar: nada de recuperação foi concedido, nada além disso pode
    // sobrar.
    await supabase.auth.signOut();
  }

  // Código/token ausente/inválido/expirado/reutilizado/de finalidade
  // incompatível — sempre a mesma resposta, sem detalhar o motivo.
  return redirectTo("/login?error=invalid_link");
}
