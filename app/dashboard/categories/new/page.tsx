import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { CategoryForm } from "@/app/dashboard/categories/category-form";
import { createCategoryAction } from "@/app/dashboard/categories/actions";

export const dynamic = "force-dynamic";

export default async function NewCategoryPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  return (
    <main>
      <h1>Nova categoria — {store.name}</h1>
      <CategoryForm storeSlug={store.slug} action={createCategoryAction} />
    </main>
  );
}
