import type {
  Membership,
  Product,
  Store,
  StoreRepository,
} from "./repository";
import { DuplicateProductNameError } from "./repository";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/**
 * In-memory implementation of StoreRepository, used by tests and local
 * fixtures. Mirrors the authorization-relevant behavior of the real
 * Supabase implementation (self-only membership lookups, per-store
 * product scoping, unique product name per store) without requiring a
 * live Postgres instance.
 */
export class MemoryStoreRepository implements StoreRepository {
  private readonly stores: Store[];
  private readonly memberships: Membership[];
  private readonly products: Product[];

  constructor(seed: {
    stores?: Store[];
    memberships?: Membership[];
    products?: Product[];
  } = {}) {
    this.stores = [...(seed.stores ?? [])];
    this.memberships = [...(seed.memberships ?? [])];
    this.products = [...(seed.products ?? [])];
  }

  async getStoreBySlug(slug: string): Promise<Store | null> {
    return this.stores.find((store) => store.slug === slug) ?? null;
  }

  async getMembership(
    userId: string,
    storeId: string,
  ): Promise<Membership | null> {
    return (
      this.memberships.find(
        (m) => m.userId === userId && m.storeId === storeId,
      ) ?? null
    );
  }

  async listProducts(storeId: string): Promise<Product[]> {
    return this.products
      .filter((product) => product.storeId === storeId)
      .map((product) => ({ ...product }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createProduct(
    storeId: string,
    input: { name: string; stock: number },
  ): Promise<Product> {
    const exists = this.products.some(
      (product) => product.storeId === storeId && product.name === input.name,
    );
    if (exists) {
      throw new DuplicateProductNameError(storeId, input.name);
    }

    const product: Product = {
      id: nextId("product"),
      storeId,
      name: input.name,
      stock: input.stock,
    };
    this.products.push(product);
    return { ...product };
  }
}
