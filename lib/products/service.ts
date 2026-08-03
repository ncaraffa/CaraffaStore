import type { StoreRepository, Product } from "@/lib/data/repository";
import {
  requireAdminRole,
  resolveAuthorizedStore,
} from "@/lib/tenant/context";

/**
 * Thin, repository-agnostic service used by the HTTP route handler
 * (app/api/stores/[storeSlug]/products/route.ts) and by tests. Keeping
 * the authorization + business logic here (instead of inline in the
 * route file) lets tests exercise the exact same code path the real API
 * runs, against an in-memory repository, without needing a live
 * Supabase/Postgres instance.
 */

export async function listProductsForStore(params: {
  repository: StoreRepository;
  userId: string | null;
  storeSlug: string;
}): Promise<Product[]> {
  const { repository, userId, storeSlug } = params;
  const context = await resolveAuthorizedStore({
    repository,
    userId,
    requestedStoreSlug: storeSlug,
  });
  return repository.listProducts(context.storeId);
}

export async function createProductForStore(params: {
  repository: StoreRepository;
  userId: string | null;
  storeSlug: string;
  input: { name: string; stock: number };
}): Promise<Product> {
  const { repository, userId, storeSlug, input } = params;
  const context = await resolveAuthorizedStore({
    repository,
    userId,
    requestedStoreSlug: storeSlug,
  });
  requireAdminRole(context);

  // `input` intentionally has no storeId/store_id field — the store a
  // product is created in is always context.storeId, resolved above from
  // the authenticated session, never from caller-supplied data.
  return repository.createProduct(context.storeId, input);
}
