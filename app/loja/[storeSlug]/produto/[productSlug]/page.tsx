import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import * as catalog from "@/lib/catalog/service";
import { formatPriceCents } from "@/lib/catalog/format";
import { AddToCartButton } from "../../add-to-cart-button";
import { CartBadge } from "../../cart-badge";

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
    <main>
      <div className="storefront-header">
        <p>
          <a href={`/loja/${storeSlug}`}>← {store.name}</a>
        </p>
        <CartBadge storeSlug={storeSlug} />
      </div>

      <article className="product-detail">
        <div className="product-detail-gallery">
          {sortedImages.length === 0 ? (
            <div className="catalog-card-image-placeholder" aria-hidden="true" />
          ) : (
            sortedImages.map((image) => (
              <img
                key={image.id}
                src={catalog.publicImageUrl(NEXT_PUBLIC_SUPABASE_URL, image.storage_path)}
                alt=""
                loading="lazy"
              />
            ))
          )}
        </div>

        <div>
          <h1>{product.name}</h1>
          <p className="catalog-card-price">{formatPriceCents(product.price_cents)}</p>

          {product.stock === 0 ? (
            <span className="badge" data-tone="warning">
              Esgotado
            </span>
          ) : (
            <span className="badge" data-tone="success">
              Disponível
            </span>
          )}

          {product.description && <p>{product.description}</p>}

          <AddToCartButton
            storeSlug={storeSlug}
            productId={product.id}
            name={product.name}
            slug={product.slug}
            priceCents={product.price_cents}
            stock={product.stock}
          />
        </div>
      </article>
    </main>
  );
}
