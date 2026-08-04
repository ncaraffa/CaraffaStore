"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import * as catalog from "@/lib/catalog/service";
import { categorySchema } from "@/lib/catalog/schemas";
import { messageForCatalogError } from "@/lib/catalog/messages";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import { FIELD_LEVEL_CODES } from "@/lib/catalog/messages";
import { CatalogError } from "@/lib/catalog/service";

export interface CategoryFormState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

function errorState(error: unknown, fieldName?: string): CategoryFormState {
  const message = messageForCatalogError(error);
  if (fieldName && error instanceof CatalogError && FIELD_LEVEL_CODES.has(error.code)) {
    return { status: "error", fieldErrors: { [fieldName]: message } };
  }
  return { status: "error", message };
}

export async function createCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const parsed = categorySchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    displayOrder: formData.get("displayOrder") ?? 0,
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await catalog.createCategory(supabase, {
      storeId: store.id,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || undefined,
      displayOrder: parsed.data.displayOrder,
    });
  } catch (error) {
    return errorState(error, "slug");
  }

  redirect(`/dashboard/categories?store=${storeSlug}`);
}

export async function updateCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  const parsed = categorySchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    displayOrder: formData.get("displayOrder") ?? 0,
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await catalog.updateCategory(supabase, {
      categoryId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || undefined,
      displayOrder: parsed.data.displayOrder,
    });
  } catch (error) {
    return errorState(error, "slug");
  }

  redirect(`/dashboard/categories?store=${storeSlug}`);
}

export async function setCategoryActiveAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  const nextActive = formData.get("nextActive") === "true";

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await catalog.setCategoryActive(supabase, categoryId, nextActive);
  } catch {
    // Papel insuficiente ou categoria inexistente: o próprio banco já
    // recusou a escrita (nada mudou) — só volta para a lista sem
    // mensagem de erro dedicada, mesmo padrão de LogoutButton (form
    // simples sem useActionState).
  }
  redirect(`/dashboard/categories?store=${storeSlug}`);
}
