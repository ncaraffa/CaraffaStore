import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { ProductForm } from "@/app/dashboard/products/product-form";
import { StockForm } from "@/app/dashboard/products/stock-form";
import { ImageManager } from "@/app/dashboard/products/image-manager";
import { StatusButtons } from "@/app/dashboard/products/status-buttons";
import { updateProductAction } from "@/app/dashboard/products/actions";
import * as catalog from "@/lib/catalog/service";
import { MAX_PRODUCT_IMAGES } from "@/lib/catalog/schemas";

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
    <main>
      <h1>Editar produto — {store.name}</h1>
      <p>
        <a href={`/dashboard/products?store=${store.slug}`}>← Voltar para produtos</a>
      </p>

      {!canManage && (
        <p className="form-status" data-tone="error">
          Seu papel nesta loja é somente leitura para o catálogo.
        </p>
      )}

      <ProductForm storeSlug={store.slug} action={updateProductAction} categories={categories} product={product} />

      {canManage && (
        <>
          <section>
            <h2>Publicação</h2>
            <StatusButtons storeSlug={store.slug} productId={product.id} status={product.status} />
          </section>

          <section>
            <h2>Estoque</h2>
            <StockForm storeSlug={store.slug} productId={product.id} currentStock={product.stock} />
          </section>

          <section>
            <h2>Imagens</h2>
            <ImageManager
              storeSlug={store.slug}
              productId={product.id}
              images={images}
              publicBaseUrl={publicBaseUrl}
              maxImages={MAX_PRODUCT_IMAGES}
            />
          </section>
        </>
      )}
    </main>
  );
}
