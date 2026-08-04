import type { StoreStatus } from "@/lib/supabase/types";

/**
 * Matriz de redirecionamento por estado da loja (tasks/in-progress/task-002.md,
 * seção "Redirecionamentos e proteção de rotas"). `storeSlug`, quando
 * informado, é passado adiante só para roteamento — cada página de
 * destino revalida a autorização via lib/tenant/context.ts, nunca confia
 * no slug por si só.
 */
export function storeStatusRedirectPath(status: StoreStatus, storeSlug?: string): string {
  const base = (() => {
    switch (status) {
      case "onboarding":
        return "/onboarding";
      case "pending_payment":
        return "/pending-payment";
      case "active":
        return "/dashboard";
      case "suspended":
        return "/suspended";
    }
  })();

  if (!storeSlug || base === "/onboarding") {
    return base;
  }

  return `${base}?store=${encodeURIComponent(storeSlug)}`;
}
