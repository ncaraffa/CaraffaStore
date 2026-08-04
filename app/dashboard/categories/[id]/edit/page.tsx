import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { CategoryForm } from "@/app/dashboard/categories/category-form";
import { updateCategoryAction } from "@/app/dashboard/categories/actions";
import * as catalog from "@/lib/catalog/service";

export const dynamic = "force-dynamic";

export default async function EditCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ store?: string }>;
}) {
  const { id } = await params;
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  const category = await catalog.getCategoryById(supabase, id);
  if (!category || category.store_id !== store.id) {
    notFound();
  }

  return (
    <main>
      <h1>Editar categoria — {store.name}</h1>
      <CategoryForm storeSlug={store.slug} action={updateCategoryAction} category={category} />
    </main>
  );
}
