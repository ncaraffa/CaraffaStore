import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { resolveMiddlewareDecision } from "@/lib/auth/middleware-policy";
import { isRecoverySession } from "@/lib/auth/jwt";

/**
 * Camada de defesa em profundidade: refresca a sessão SSR e bloqueia
 * cedo o caso óbvio (anônimo em rota protegida, não verificado fora das
 * rotas permitidas — ver lib/auth/middleware-policy.ts). NÃO é a única
 * barreira — cada página/Server Action revalida no servidor, e RLS
 * aplica negação por padrão no banco mesmo que este proxy tenha algum
 * bug ou seja contornado.
 *
 * Next.js 16 renomeou o arquivo de convenção `middleware.ts` para
 * `proxy.ts` (mesma API/comportamento — ver
 * https://nextjs.org/docs/messages/middleware-to-proxy); a função
 * continua rodando antes de toda requisição, no mesmo lugar do pipeline.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

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
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() já validou a sessão contra o servidor; getSession() aqui só
  // lê o token já validado (mesmo cookie, sem round-trip extra) para
  // inspecionar o claim `amr` — necessário para distinguir uma sessão de
  // recuperação de senha de uma sessão normal (ver
  // lib/auth/middleware-policy.ts RECOVERY_SESSION_ALLOWED_PATHS).
  let isRecovery = false;
  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    isRecovery = session ? isRecoverySession(session.access_token) : false;
  }

  const decision = resolveMiddlewareDecision({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    isApiRoute: request.nextUrl.pathname.startsWith("/api/"),
    user: user ? { emailConfirmedAt: user.email_confirmed_at ?? null, isRecoverySession: isRecovery } : null,
  });

  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
