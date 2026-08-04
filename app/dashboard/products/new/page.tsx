import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { ProductForm } from "@/app/dashboard/products/product-form";
import { createProductAction } from "@/app/dashboard/products/actions";
import * as catalog from "@/lib/catalog/service";

export const dynamic = "force-dynamic";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);
  const categories = await catalog.listCategories(supabase, store.id);

  return (
    <main>
      <h1>Novo produto — {store.name}</h1>
      <ProductForm storeSlug={store.slug} action={createProductAction} categories={categories} />
    </main>
  );
}
