import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ProductForm } from "@/app/dashboard/products/product-form";
import { createProductAction } from "@/app/dashboard/products/actions";
import * as catalog from "@/lib/catalog/service";
import formStyles from "../../dashboard-form.module.css";

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
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="produtos"
      breadcrumbs={[
        { label: "Painel", href: `/dashboard?store=${store.slug}` },
        { label: "Produtos", href: `/dashboard/products?store=${store.slug}` },
        { label: "Novo produto" },
      ]}
    >
      <h1 className={formStyles.title}>Novo produto</h1>
      <p className={formStyles.subtitle}>{store.name}</p>
      <div className={formStyles.formWrap}>
        <ProductForm storeSlug={store.slug} action={createProductAction} categories={categories} />
      </div>
    </DashboardShell>
  );
}
