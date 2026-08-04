import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ProductStatus } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;
type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type ProductImageRow = Database["public"]["Tables"]["product_images"]["Row"];
type StoreRow = Database["public"]["Tables"]["stores"]["Row"];

export const PRODUCT_IMAGE_BUCKET = "product-images";

/**
 * Espelha o `code` de erro levantado pelas funções SQL catalog_* (
 * `raise exception 'codigo' using errcode = ...`) — nunca inventado no
 * TypeScript, sempre vindo de `error.message` do RPC. Mesmo padrão de
 * lib/onboarding/service.ts:OnboardingError.
 */
export class CatalogError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "CatalogError";
    this.code = code;
  }
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) {
    throw new CatalogError(result.error.message);
  }
  if (result.data === null || result.data === undefined) {
    throw new CatalogError("unexpected_empty_result");
  }
  return result.data;
}

// ============================================================
// Categorias — leitura (RLS: qualquer membro da loja)
// ============================================================

export async function listCategories(supabase: Client, storeId: string): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, store_id, name, slug, description, display_order, is_active, created_at, updated_at")
    .eq("store_id", storeId)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getCategoryById(supabase: Client, categoryId: string): Promise<CategoryRow | null> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, store_id, name, slug, description, display_order, is_active, created_at, updated_at")
    .eq("id", categoryId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ============================================================
// Categorias — escrita (RPC, owner/admin apenas — checado no banco)
// ============================================================

export async function createCategory(
  supabase: Client,
  params: { storeId: string; name: string; slug: string; description?: string; displayOrder?: number },
): Promise<CategoryRow> {
  return unwrap(
    await supabase.rpc("catalog_create_category", {
      p_store_id: params.storeId,
      p_name: params.name,
      p_slug: params.slug,
      p_description: params.description ?? null,
      p_display_order: params.displayOrder ?? 0,
    }),
  );
}

export async function updateCategory(
  supabase: Client,
  params: { categoryId: string; name: string; slug: string; description?: string; displayOrder?: number },
): Promise<CategoryRow> {
  return unwrap(
    await supabase.rpc("catalog_update_category", {
      p_category_id: params.categoryId,
      p_name: params.name,
      p_slug: params.slug,
      p_description: params.description ?? null,
      p_display_order: params.displayOrder ?? 0,
    }),
  );
}

export async function setCategoryActive(
  supabase: Client,
  categoryId: string,
  isActive: boolean,
): Promise<CategoryRow> {
  return unwrap(
    await supabase.rpc("catalog_set_category_active", { p_category_id: categoryId, p_is_active: isActive }),
  );
}

// ============================================================
// Produtos — leitura (RLS: qualquer membro da loja)
// ============================================================

export async function listProducts(
  supabase: Client,
  storeId: string,
  opts: { status?: ProductStatus } = {},
): Promise<ProductRow[]> {
  let query = supabase
    .from("products")
    .select(
      "id, store_id, category_id, name, slug, description, price_cents, sku, stock, status, created_at, updated_at",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (opts.status) {
    query = query.eq("status", opts.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getProductById(supabase: Client, productId: string): Promise<ProductRow | null> {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, store_id, category_id, name, slug, description, price_cents, sku, stock, status, created_at, updated_at",
    )
    .eq("id", productId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listProductImages(supabase: Client, productId: string): Promise<ProductImageRow[]> {
  const { data, error } = await supabase
    .from("product_images")
    .select("id, store_id, product_id, storage_path, position, is_cover, created_at")
    .eq("product_id", productId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ============================================================
// Produtos — escrita (RPC)
// ============================================================

export async function createProduct(
  supabase: Client,
  params: {
    storeId: string;
    name: string;
    slug: string;
    priceCents: number;
    stock: number;
    categoryId?: string | null;
    description?: string;
    sku?: string;
  },
): Promise<ProductRow> {
  return unwrap(
    await supabase.rpc("catalog_create_product", {
      p_store_id: params.storeId,
      p_name: params.name,
      p_slug: params.slug,
      p_price_cents: params.priceCents,
      p_stock: params.stock,
      p_category_id: params.categoryId ?? null,
      p_description: params.description ?? null,
      p_sku: params.sku ?? null,
    }),
  );
}

export async function updateProduct(
  supabase: Client,
  params: {
    productId: string;
    name: string;
    slug: string;
    priceCents: number;
    categoryId?: string | null;
    description?: string;
    sku?: string;
  },
): Promise<ProductRow> {
  return unwrap(
    await supabase.rpc("catalog_update_product", {
      p_product_id: params.productId,
      p_name: params.name,
      p_slug: params.slug,
      p_price_cents: params.priceCents,
      p_category_id: params.categoryId ?? null,
      p_description: params.description ?? null,
      p_sku: params.sku ?? null,
    }),
  );
}

export async function setProductStatus(
  supabase: Client,
  productId: string,
  status: ProductStatus,
): Promise<ProductRow> {
  return unwrap(await supabase.rpc("catalog_set_product_status", { p_product_id: productId, p_status: status }));
}

export async function adjustStock(
  supabase: Client,
  params: { productId: string; delta: number; reason: string; reference?: string },
): Promise<number> {
  return unwrap(
    await supabase.rpc("catalog_adjust_stock", {
      p_product_id: params.productId,
      p_delta: params.delta,
      p_reason: params.reason,
      p_reference: params.reference ?? null,
    }),
  );
}

// ============================================================
// Imagens — upload real (Storage, RLS própria) + metadado (RPC)
// ============================================================

export async function uploadProductImageFile(
  supabase: Client,
  storagePath: string,
  file: File,
): Promise<void> {
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
}

export async function addProductImage(
  supabase: Client,
  params: { productId: string; storagePath: string; isCover?: boolean },
): Promise<ProductImageRow> {
  return unwrap(
    await supabase.rpc("catalog_add_product_image", {
      p_product_id: params.productId,
      p_storage_path: params.storagePath,
      p_is_cover: params.isCover ?? false,
    }),
  );
}

/** Remove o arquivo do Storage primeiro (protegido por RLS de storage.objects), só então o metadado. */
export async function removeProductImage(
  supabase: Client,
  params: { imageId: string; storagePath: string },
): Promise<void> {
  const { error: storageError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([params.storagePath]);
  if (storageError) throw storageError;

  const { error } = await supabase.rpc("catalog_remove_product_image", { p_image_id: params.imageId });
  if (error) throw new CatalogError(error.message);
}

export async function setCoverImage(supabase: Client, imageId: string): Promise<void> {
  const { error } = await supabase.rpc("catalog_set_cover_image", { p_image_id: imageId });
  if (error) throw new CatalogError(error.message);
}

export async function moveProductImage(supabase: Client, imageId: string, direction: "up" | "down"): Promise<void> {
  const { error } = await supabase.rpc("catalog_move_product_image", { p_image_id: imageId, p_direction: direction });
  if (error) throw new CatalogError(error.message);
}

export function publicImageUrl(supabaseUrl: string, storagePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${storagePath}`;
}

// ============================================================
// Catálogo público — leitura (RLS: anon, só published/active)
// ============================================================

/**
 * Todas as funções abaixo filtram explicitamente por status/is_active na
 * própria query — nunca dependem só da RLS. Isso garante o MESMO
 * catálogo público independente de quem está olhando (RLS por si só
 * deixaria um owner logado ver também os próprios rascunhos, via a
 * policy de "membro" que já existe para o painel — correto para o
 * painel, mas não é o que a rota pública deve mostrar).
 */
export async function getPublicStore(
  supabase: Client,
  storeSlug: string,
): Promise<Pick<StoreRow, "id" | "slug" | "name" | "status"> | null> {
  const { data, error } = await supabase
    .from("stores")
    .select("id, slug, name, status")
    .eq("slug", storeSlug)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listPublicCategories(supabase: Client, storeId: string): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, store_id, name, slug, description, display_order, is_active, created_at, updated_at")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listPublicProducts(
  supabase: Client,
  storeId: string,
  opts: { search?: string; categorySlug?: string } = {},
): Promise<ProductRow[]> {
  let query = supabase
    .from("products")
    .select(
      "id, store_id, category_id, name, slug, description, price_cents, sku, stock, status, created_at, updated_at",
    )
    .eq("store_id", storeId)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (opts.search) {
    query = query.ilike("name", `%${opts.search}%`);
  }
  if (opts.categorySlug) {
    const { data: category } = await supabase
      .from("categories")
      .select("id")
      .eq("store_id", storeId)
      .eq("slug", opts.categorySlug)
      .eq("is_active", true)
      .maybeSingle();
    query = query.eq("category_id", category?.id ?? "00000000-0000-0000-0000-000000000000");
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getPublicProductBySlug(
  supabase: Client,
  storeId: string,
  productSlug: string,
): Promise<ProductRow | null> {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, store_id, category_id, name, slug, description, price_cents, sku, stock, status, created_at, updated_at",
    )
    .eq("store_id", storeId)
    .eq("slug", productSlug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listPublicProductImages(supabase: Client, productId: string): Promise<ProductImageRow[]> {
  const { data, error } = await supabase
    .from("product_images")
    .select("id, store_id, product_id, storage_path, position, is_cover, created_at")
    .eq("product_id", productId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Uma query só para a capa de vários produtos (evita N+1 na grade do catálogo). */
export async function listCoverImagesByProductIds(
  supabase: Client,
  productIds: string[],
): Promise<Map<string, ProductImageRow>> {
  if (productIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("product_images")
    .select("id, store_id, product_id, storage_path, position, is_cover, created_at")
    .in("product_id", productIds)
    .order("position", { ascending: true });
  if (error) throw error;

  const covers = new Map<string, ProductImageRow>();
  for (const image of data ?? []) {
    const existing = covers.get(image.product_id);
    if (image.is_cover || !existing) {
      if (!existing || image.is_cover) covers.set(image.product_id, image);
    }
  }
  return covers;
}
