import type { StoreRole, StoreStatus } from "@/lib/supabase/types";

export interface Store {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus;
}

export interface Membership {
  userId: string;
  storeId: string;
  role: StoreRole;
}

export interface Product {
  id: string;
  storeId: string;
  name: string;
  stock: number;
}

/**
 * Data access contract shared by the real Supabase-backed implementation
 * and the in-memory implementation used in tests/fixtures. Every method
 * takes an already-resolved, already-authorized `storeId` — this
 * interface never accepts a bare "trust me" identifier from a caller
 * without going through the tenant resolver in lib/tenant/context.ts.
 */
export interface StoreRepository {
  getStoreBySlug(slug: string): Promise<Store | null>;
  getMembership(userId: string, storeId: string): Promise<Membership | null>;
  listProducts(storeId: string): Promise<Product[]>;
  createProduct(
    storeId: string,
    input: { name: string; stock: number },
  ): Promise<Product>;
}

export class DuplicateProductNameError extends Error {
  constructor(storeId: string, name: string) {
    super(`Produto "${name}" já existe na loja ${storeId}.`);
    this.name = "DuplicateProductNameError";
  }
}
