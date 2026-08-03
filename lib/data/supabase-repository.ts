import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type {
  Membership,
  Product,
  Store,
  StoreRepository,
} from "./repository";
import { DuplicateProductNameError } from "./repository";

const UNIQUE_VIOLATION = "23505";

/**
 * Real implementation, backed by Postgres/Supabase. Every query is
 * explicitly scoped by storeId (defense in depth, layer 1) AND is still
 * subject to RLS at the database level (layer 2) — see
 * supabase/migrations/0001_init.sql. Neither layer alone is trusted.
 */
export class SupabaseStoreRepository implements StoreRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getStoreBySlug(slug: string): Promise<Store | null> {
    const { data, error } = await this.client
      .from("stores")
      .select("id, slug, name")
      .eq("slug", slug)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async getMembership(
    userId: string,
    storeId: string,
  ): Promise<Membership | null> {
    const { data, error } = await this.client
      .from("store_members")
      .select("user_id, store_id, role")
      .eq("user_id", userId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return { userId: data.user_id, storeId: data.store_id, role: data.role };
  }

  async listProducts(storeId: string): Promise<Product[]> {
    const { data, error } = await this.client
      .from("products")
      .select("id, store_id, name, stock")
      .eq("store_id", storeId)
      .order("name", { ascending: true });

    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      storeId: row.store_id,
      name: row.name,
      stock: row.stock,
    }));
  }

  async createProduct(
    storeId: string,
    input: { name: string; stock: number },
  ): Promise<Product> {
    const { data, error } = await this.client
      .from("products")
      .insert({ store_id: storeId, name: input.name, stock: input.stock })
      .select("id, store_id, name, stock")
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new DuplicateProductNameError(storeId, input.name);
      }
      throw error;
    }

    return {
      id: data.id,
      storeId: data.store_id,
      name: data.name,
      stock: data.stock,
    };
  }
}
