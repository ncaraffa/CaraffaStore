import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import * as catalog from "@/lib/catalog/service";
import { formatPriceCents } from "@/lib/catalog/format";
import { AddToCartButton } from "../../add-to-cart-button";
import { StorefrontHeader } from "@/components/storefront/StorefrontHeader";
import { Badge } from "@/components/ui/Badge";
import styles from "./product-detail.module.css";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ storeSlug: string; productSlug: string }>;
}) {
  const { storeSlug, productSlug } = await params;

  const supabase = await createServerSupabaseClient();
  const store = await catalog.getPublicStore(supabase, storeSlug);
  if (!store) {
    notFound();
  }

  const product = await catalog.getPublicProductBySlug(supabase, store.id, productSlug);
  if (!product) {
    notFound();
  }

  const images = await catalog.listPublicProductImages(supabase, product.id);
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  const sortedImages = [...images].sort((a, b) => (a.is_cover === b.is_cover ? 0 : a.is_cover ? -1 : 1));

  return (
    <>
      <StorefrontHeader storeSlug={storeSlug} storeName={store.name} backHref={`/loja/${storeSlug}`} />
      <main className={styles.main}>
        <article className={styles.layout}>
          <div className={styles.gallery}>
            {sortedImages.length === 0 ? (
              <div className={styles.placeholder} aria-hidden="true" />
            ) : (
              sortedImages.map((image) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={image.id}
                  src={catalog.publicImageUrl(NEXT_PUBLIC_SUPABASE_URL, image.storage_path)}
                  alt=""
                  loading="lazy"
                  className={styles.image}
                />
              ))
            )}
          </div>

          <div className={styles.info}>
            <h1 className={styles.title}>{product.name}</h1>
            <p className={styles.price}>{formatPriceCents(product.price_cents)}</p>

            {product.stock === 0 ? <Badge tone="warning">Esgotado</Badge> : <Badge tone="success">Disponível</Badge>}

            {product.description && <p className={styles.description}>{product.description}</p>}

            <div className={styles.actions}>
              <AddToCartButton
                storeSlug={storeSlug}
                productId={product.id}
                name={product.name}
                slug={product.slug}
                priceCents={product.price_cents}
                stock={product.stock}
              />
            </div>
          </div>
        </article>
      </main>
    </>
  );
}
