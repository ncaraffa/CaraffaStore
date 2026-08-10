import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CategoryForm } from "@/app/dashboard/categories/category-form";
import { createCategoryAction } from "@/app/dashboard/categories/actions";
import formStyles from "../../dashboard-form.module.css";

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
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="categorias"
      breadcrumbs={[
        { label: "Painel", href: `/dashboard?store=${store.slug}` },
        { label: "Categorias", href: `/dashboard/categories?store=${store.slug}` },
        { label: "Nova categoria" },
      ]}
    >
      <h1 className={formStyles.title}>Nova categoria</h1>
      <p className={formStyles.subtitle}>{store.name}</p>
      <div className={formStyles.formWrap}>
        <CategoryForm storeSlug={store.slug} action={createCategoryAction} />
      </div>
    </DashboardShell>
  );
}
