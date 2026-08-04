"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import * as catalog from "@/lib/catalog/service";
import { CatalogError } from "@/lib/catalog/service";
import { productSchema, productEditSchema, stockAdjustSchema } from "@/lib/catalog/schemas";
import { validateProductImageFile, buildProductImagePath } from "@/lib/catalog/image-validation";
import { messageForCatalogError, FIELD_LEVEL_CODES } from "@/lib/catalog/messages";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import type { ProductStatus } from "@/lib/supabase/types";

export interface ProductFormState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

function errorState(error: unknown, fieldName?: string): ProductFormState {
  const message = messageForCatalogError(error);
  if (fieldName && error instanceof CatalogError && FIELD_LEVEL_CODES.has(error.code)) {
    return { status: "error", fieldErrors: { [fieldName]: message } };
  }
  return { status: "error", message };
}

function normalizeCategoryId(raw: string): string | undefined {
  return raw ? raw : undefined;
}

export async function createProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const parsed = productSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    priceCents: String(formData.get("price") ?? ""),
    sku: String(formData.get("sku") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    stock: formData.get("stock") ?? 0,
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  let productId: string;
  try {
    const product = await catalog.createProduct(supabase, {
      storeId: store.id,
      name: parsed.data.name,
      slug: parsed.data.slug,
      priceCents: parsed.data.priceCents,
      stock: parsed.data.stock,
      categoryId: normalizeCategoryId(parsed.data.categoryId ?? ""),
      description: parsed.data.description || undefined,
      sku: parsed.data.sku || undefined,
    });
    productId = product.id;
  } catch (error) {
    return errorState(error, "slug");
  }

  redirect(`/dashboard/products/${productId}/edit?store=${storeSlug}`);
}

export async function updateProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const parsed = productEditSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    priceCents: String(formData.get("price") ?? ""),
    sku: String(formData.get("sku") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await catalog.updateProduct(supabase, {
      productId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      priceCents: parsed.data.priceCents,
      categoryId: normalizeCategoryId(parsed.data.categoryId ?? ""),
      description: parsed.data.description || undefined,
      sku: parsed.data.sku || undefined,
    });
  } catch (error) {
    return errorState(error, "slug");
  }

  redirect(`/dashboard/products/${productId}/edit?store=${storeSlug}`);
}

export async function setProductStatusAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const status = String(formData.get("status") ?? "") as ProductStatus;

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await catalog.setProductStatus(supabase, productId, status);
  } catch {
    // Papel insuficiente/produto inexistente: banco já recusou, nada a desfazer.
  }
  redirect(`/dashboard/products/${productId}/edit?store=${storeSlug}`);
}

export interface StockFormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  newStock?: number;
}

export async function adjustStockAction(
  _prev: StockFormState,
  formData: FormData,
): Promise<StockFormState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const parsed = stockAdjustSchema.safeParse({
    delta: String(formData.get("delta") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    reference: String(formData.get("reference") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  let newStock: number;
  try {
    newStock = await catalog.adjustStock(supabase, {
      productId,
      delta: parsed.data.delta,
      reason: parsed.data.reason,
      reference: parsed.data.reference || undefined,
    });
  } catch (error) {
    return errorState(error, "delta");
  }

  revalidatePath(`/dashboard/products/${productId}/edit`);
  return { status: "success", newStock };
}

export interface ImageFormState {
  status: "idle" | "error";
  message?: string;
}

export async function addProductImageAction(
  _prev: ImageFormState,
  formData: FormData,
): Promise<ImageFormState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { status: "error", message: "Selecione um arquivo de imagem." };
  }
  const validationError = validateProductImageFile(file);
  if (validationError) {
    return { status: "error", message: validationError.message };
  }

  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  const storagePath = buildProductImagePath(store.id, productId, file.type);
  try {
    await catalog.uploadProductImageFile(supabase, storagePath, file);
    await catalog.addProductImage(supabase, { productId, storagePath });
  } catch (error) {
    return errorState(error);
  }

  revalidatePath(`/dashboard/products/${productId}/edit`);
  return { status: "idle" };
}

export async function removeProductImageAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  const storagePath = String(formData.get("storagePath") ?? "");

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await catalog.removeProductImage(supabase, { imageId, storagePath });
  } catch {
    // Papel insuficiente/imagem inexistente: banco já recusou.
  }
  redirect(`/dashboard/products/${productId}/edit?store=${storeSlug}`);
}

export async function setCoverImageAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await catalog.setCoverImage(supabase, imageId);
  } catch {
    // idem.
  }
  redirect(`/dashboard/products/${productId}/edit?store=${storeSlug}`);
}

export async function moveProductImageAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  const direction = String(formData.get("direction") ?? "up") as "up" | "down";

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await catalog.moveProductImage(supabase, imageId, direction);
  } catch {
    // idem.
  }
  redirect(`/dashboard/products/${productId}/edit?store=${storeSlug}`);
}
