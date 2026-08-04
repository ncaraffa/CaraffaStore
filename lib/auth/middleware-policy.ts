import { isAllowedRedirect } from "@/lib/auth/redirects";

/**
 * Acessíveis sem sessão (anônimo). `/loja` foi adicionado pela TASK-003
 * (catálogo público) — a mesma decisão aprovada que concede SELECT a
 * `anon` em stores/categories/products/product_images (só linhas
 * `active`/`published`/`is_active`, ver supabase/migrations/0005_catalog.sql).
 * Sem isso, um visitante anônimo seria redirecionado para /login antes
 * de qualquer página de loja carregar.
 */
export const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth/confirm",
  "/auth/recovery",
  "/loja",
];

/**
 * T2-DEC-002: conta não verificada fica restrita a confirmação/reenvio e
 * logout — nada além disso, nem onboarding nem painel. Vale mesmo para
 * rotas que também estão em PUBLIC_PATHS (ex.: /login, /reset-password):
 * um usuário AUTENTICADO porém não verificado não pode usá-las só porque
 * um anônimo poderia.
 */
export const UNVERIFIED_ALLOWED_PATHS = ["/verify", "/logout", "/auth/confirm"];

/**
 * Uma sessão de recuperação de senha (estabelecida por
 * app/auth/recovery/route.ts ao trocar o código do link de "esqueci
 * minha senha" — rota SEPARADA de app/auth/confirm/route.ts, que só
 * trata confirmação de cadastro) é uma sessão autenticada comum sob
 * todos os outros aspectos — sem esta restrição, ela daria acesso total
 * (onboarding, painel, etc.) enquanto durar, não só a troca de senha.
 * Isso importa em cenários de computador compartilhado/público, e-mail
 * encaminhado, ou a aba ficar aberta depois do clique.
 *
 * `isRecoverySession` aqui vem de lib/tenant/recovery-session.ts
 * (`public.auth_flow_grants`, ativado só depois de uma troca de código
 * real com finalidade comprovada — ver
 * supabase/migrations/0003_recovery_session.sql) — NUNCA do claim `amr`
 * do GoTrue, que não distingue recuperação de confirmação de cadastro
 * (confirmado contra o Supabase local real).
 */
export const RECOVERY_SESSION_ALLOWED_PATHS = ["/reset-password", "/logout"];

export function matchesAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export type MiddlewareDecision =
  | { action: "next" }
  | { action: "redirect"; location: string };

export interface MiddlewareInput {
  pathname: string;
  search: string;
  isApiRoute: boolean;
  user: { emailConfirmedAt: string | null; isRecoverySession: boolean } | null;
}

/**
 * Lógica pura de decisão do middleware (sem cookies/Response do Next),
 * para poder ser testada diretamente. `proxy.ts` só faz a parte de I/O
 * (refresh de sessão via cookies) e delega a decisão para cá.
 */
export function resolveMiddlewareDecision(input: MiddlewareInput): MiddlewareDecision {
  const { pathname, search, isApiRoute, user } = input;

  if (isApiRoute) {
    return { action: "next" };
  }

  // Restrições de sessão AUTENTICADA são checadas antes de PUBLIC_PATHS —
  // um usuário logado não verificado/em recuperação não ganha acesso
  // extra só porque a rota também é alcançável por um anônimo.
  if (user) {
    if (user.isRecoverySession && !matchesAny(pathname, RECOVERY_SESSION_ALLOWED_PATHS)) {
      return { action: "redirect", location: "/reset-password" };
    }
    if (!user.emailConfirmedAt && !matchesAny(pathname, UNVERIFIED_ALLOWED_PATHS)) {
      return { action: "redirect", location: "/verify" };
    }
    return { action: "next" };
  }

  if (matchesAny(pathname, PUBLIC_PATHS)) {
    return { action: "next" };
  }

  const next = `${pathname}${search}`;
  const loginUrl = isAllowedRedirect(next) ? `/login?next=${encodeURIComponent(next)}` : "/login";
  return { action: "redirect", location: loginUrl };
}
