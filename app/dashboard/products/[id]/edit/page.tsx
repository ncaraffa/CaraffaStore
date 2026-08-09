import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { ProductForm } from "@/app/dashboard/products/product-form";
import { StockForm } from "@/app/dashboard/products/stock-form";
import { ImageManager } from "@/app/dashboard/products/image-manager";
import { StatusButtons } from "@/app/dashboard/products/status-buttons";
import { updateProductAction } from "@/app/dashboard/products/actions";
import * as catalog from "@/lib/catalog/service";
import { MAX_PRODUCT_IMAGES } from "@/lib/catalog/schemas";
import { Card, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import styles from "./edit-product.module.css";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ store?: string }>;
}) {
  const { id } = await params;
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store, role } = await requireStoreStatus(supabase, "active", storeSlug);

  const product = await catalog.getProductById(supabase, id);
  if (!product || product.store_id !== store.id) {
    notFound();
  }

  const [categories, images] = await Promise.all([
    catalog.listCategories(supabase, store.id),
    catalog.listProductImages(supabase, product.id),
  ]);
  const canManage = role === "owner" || role === "admin";
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  const publicBaseUrl = `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${catalog.PRODUCT_IMAGE_BUCKET}`;

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="produtos"
      breadcrumbs={[
        { label: "Painel", href: `/dashboard?store=${store.slug}` },
        { label: "Produtos", href: `/dashboard/products?store=${store.slug}` },
        { label: product.name },
      ]}
    >
      <h1 className={styles.title}>{product.name}</h1>
      <p className={styles.subtitle}>{store.name} · Editando produto</p>

      {!canManage && (
        <div className={styles.alertGap}>
          <Alert tone="warning">Seu papel nesta loja é somente leitura para o catálogo.</Alert>
        </div>
      )}

      <div className={styles.layout}>
        <ProductForm storeSlug={store.slug} action={updateProductAction} categories={categories} product={product} />

        {canManage && (
          <div className={styles.sideStack}>
            <Card>
              <CardHeader title="Publicação" />
              <StatusButtons storeSlug={store.slug} productId={product.id} status={product.status} />
            </Card>

            {/* Imagens antes de estoque: produto com foto vende mais, e é
                a próxima decisão mais importante depois de publicar. */}
            <Card>
              <CardHeader title="Imagens" description={`Até ${MAX_PRODUCT_IMAGES} imagens por produto.`} />
              <ImageManager
                storeSlug={store.slug}
                productId={product.id}
                images={images}
                publicBaseUrl={publicBaseUrl}
                maxImages={MAX_PRODUCT_IMAGES}
              />
            </Card>

            <Card>
              <CardHeader title="Estoque" />
              <StockForm storeSlug={store.slug} productId={product.id} currentStock={product.stock} />
            </Card>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
