import type { StoreRepository } from "@/lib/data/repository";
import type { StoreRole } from "@/lib/supabase/types";

export class ForbiddenTenantError extends Error {
  constructor(message = "Acesso negado a esta loja.") {
    super(message);
    this.name = "ForbiddenTenantError";
  }
}

export interface AuthorizedStoreContext {
  storeId: string;
  storeSlug: string;
  role: StoreRole;
}

/**
 * The single place where "which store is this request for" gets decided.
 *
 * `requestedStoreSlug` comes from the URL and is ONLY used to look up
 * which store the caller means to address — it never authorizes
 * anything by itself. Authorization is entirely derived from
 * `userId` (taken from the authenticated session, never from a client
 * body/query param) matched against store_members. If the user has no
 * session, or no membership row for the resolved store, this throws
 * ForbiddenTenantError regardless of what the client claims.
 */
export async function resolveAuthorizedStore(params: {
  repository: StoreRepository;
  userId: string | null;
  requestedStoreSlug: string;
}): Promise<AuthorizedStoreContext> {
  const { repository, userId, requestedStoreSlug } = params;

  if (!userId) {
    throw new ForbiddenTenantError("Autenticação necessária.");
  }

  // Mensagem idêntica para "loja não existe" e "loja existe mas sem
  // vínculo": diferenciar os dois casos permitiria enumerar slugs de
  // lojas reais só por tentativa e erro.
  const notFoundOrForbidden = () =>
    new ForbiddenTenantError("Loja não encontrada ou sem acesso.");

  const store = await repository.getStoreBySlug(requestedStoreSlug);
  if (!store) {
    throw notFoundOrForbidden();
  }

  const membership = await repository.getMembership(userId, store.id);
  if (!membership) {
    throw notFoundOrForbidden();
  }

  return { storeId: store.id, storeSlug: store.slug, role: membership.role };
}

export function requireAdminRole(context: AuthorizedStoreContext): void {
  if (context.role !== "owner" && context.role !== "admin") {
    throw new ForbiddenTenantError(
      "Papel insuficiente para esta ação (requer owner ou admin).",
    );
  }
}
