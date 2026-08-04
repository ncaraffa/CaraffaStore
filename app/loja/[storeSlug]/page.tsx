import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import * as catalog from "@/lib/catalog/service";
import { formatPriceCents } from "@/lib/catalog/format";
import { AddToCartButton } from "./add-to-cart-button";
import { CartBadge } from "./cart-badge";

export const dynamic = "force-dynamic";

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeSlug: string }>;
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { storeSlug } = await params;
  const { q, category } = await searchParams;

  const supabase = await createServerSupabaseClient();
  const store = await catalog.getPublicStore(supabase, storeSlug);
  if (!store) {
    notFound();
  }

  const [categories, products] = await Promise.all([
    catalog.listPublicCategories(supabase, store.id),
    catalog.listPublicProducts(supabase, store.id, { search: q, categorySlug: category }),
  ]);
  const covers = await catalog.listCoverImagesByProductIds(
    supabase,
    products.map((p) => p.id),
  );

  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();

  return (
    <main>
      <div className="storefront-header">
        <h1>{store.name}</h1>
        <CartBadge storeSlug={storeSlug} />
      </div>

      <form className="storefront-search" method="get">
        <input
          type="search"
          name="q"
          placeholder="Buscar produtos..."
          defaultValue={q ?? ""}
          aria-label="Buscar produtos"
        />
        {category && <input type="hidden" name="category" value={category} />}
        <button type="submit">Buscar</button>
      </form>

      {categories.length > 0 && (
        <nav className="storefront-categories" aria-label="Categorias">
          <a href={`/loja/${storeSlug}`} aria-current={!category}>
            Todas
          </a>
          {categories.map((c) => (
            <a key={c.id} href={`/loja/${storeSlug}?category=${c.slug}`} aria-current={category === c.slug}>
              {c.name}
            </a>
          ))}
        </nav>
      )}

      {products.length === 0 ? (
        <p>Nenhum produto encontrado.</p>
      ) : (
        <div className="catalog-grid">
          {products.map((product) => {
            const cover = covers.get(product.id);
            return (
              <div key={product.id} className="catalog-card">
                <a className="catalog-card-link" href={`/loja/${storeSlug}/produto/${product.slug}`}>
                  <div className="catalog-card-image">
                    {cover ? (
                      <img src={catalog.publicImageUrl(NEXT_PUBLIC_SUPABASE_URL, cover.storage_path)} alt="" loading="lazy" />
                    ) : (
                      <div className="catalog-card-image-placeholder" aria-hidden="true" />
                    )}
                  </div>
                  <h2>{product.name}</h2>
                  <p className="catalog-card-price">{formatPriceCents(product.price_cents)}</p>
                  {product.stock === 0 && (
                    <span className="badge" data-tone="warning">
                      Esgotado
                    </span>
                  )}
                </a>
                <AddToCartButton
                  storeSlug={storeSlug}
                  productId={product.id}
                  name={product.name}
                  slug={product.slug}
                  priceCents={product.price_cents}
                  stock={product.stock}
                />
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
