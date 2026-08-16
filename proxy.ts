import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { resolveMiddlewareDecision } from "@/lib/auth/middleware-policy";
import { isCurrentSessionRecovery } from "@/lib/tenant/recovery-session";

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
// Vercel não suporta redirect entre dois subdomínios *.vercel.app via
// Domains API (mesmo apex compartilhado) — feito aqui em código. Nunca
// redireciona /api/*: o webhook do Mercado Pago está configurado para o
// domínio antigo e precisa continuar respondendo lá sem redirect.
const CANONICAL_HOST_REDIRECT: Record<string, string> = {
  "commerce-platform-pi.vercel.app": "caraffastore.vercel.app",
};

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const canonicalHost = host ? CANONICAL_HOST_REDIRECT[host] : undefined;
  if (canonicalHost && !request.nextUrl.pathname.startsWith("/api/")) {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${canonicalHost}`);
    return NextResponse.redirect(url, 308);
  }

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

  // Distingue sessão de recuperação de senha de sessão normal via
  // public.password_recovery_grants (lib/tenant/recovery-session.ts),
  // emitido server-only só depois de uma verificação real de token de
  // recuperação (supabase.auth.verifyOtp({type:"recovery"}) em
  // app/auth/recovery/route.ts) — nunca via claim `amr` do GoTrue, que
  // não diferencia recuperação de confirmação de cadastro (confirmado
  // contra o Supabase local real).
  const isRecovery = user ? await isCurrentSessionRecovery(supabase) : false;

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
  // `icon`/`apple-icon`: convenção do App Router (app/icon.tsx) — gera
  // uma rota SEM extensão de arquivo (/icon, /icon?<hash>), então não
  // cai no padrão de extensão abaixo como favicon.ico caía.
  //
  // `mp4`/`webm` entram na lista pelo mesmo motivo das imagens: são
  // arquivos estáticos de `public/`, sem semântica de sessão. Sem eles
  // aqui, o filme da landing respondia 307 para visitante anônimo — o
  // middleware mandava o arquivo para /login, e o vídeo simplesmente
  // não tocava para quem ainda não tem conta, que é justamente quem a
  // landing precisa convencer.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm)$).*)",
  ],
};
