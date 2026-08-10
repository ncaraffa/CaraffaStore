import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CategoryForm } from "@/app/dashboard/categories/category-form";
import { updateCategoryAction } from "@/app/dashboard/categories/actions";
import * as catalog from "@/lib/catalog/service";
import formStyles from "../../../dashboard-form.module.css";

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
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="categorias"
      breadcrumbs={[
        { label: "Painel", href: `/dashboard?store=${store.slug}` },
        { label: "Categorias", href: `/dashboard/categories?store=${store.slug}` },
        { label: category.name },
      ]}
    >
      <h1 className={formStyles.title}>Editar categoria</h1>
      <p className={formStyles.subtitle}>{store.name}</p>
      <div className={formStyles.formWrap}>
        <CategoryForm storeSlug={store.slug} action={updateCategoryAction} category={category} />
      </div>
    </DashboardShell>
  );
}
