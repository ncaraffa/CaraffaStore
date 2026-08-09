import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import * as catalog from "@/lib/catalog/service";
import { formatPriceCents } from "@/lib/catalog/format";
import { AddToCartButton } from "./add-to-cart-button";
import { StorefrontHeader } from "@/components/storefront/StorefrontHeader";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconSearch, IconBox } from "@/components/ui/icons";
import styles from "./storefront.module.css";

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
    <>
      <StorefrontHeader storeSlug={storeSlug} storeName={store.name} />
      <main className={styles.main}>
        <form className={styles.search} method="get">
          <Input type="search" name="q" placeholder="Buscar produtos..." defaultValue={q ?? ""} aria-label="Buscar produtos" />
          {category && <input type="hidden" name="category" value={category} />}
          <Button type="submit" variant="outline" icon={<IconSearch />}>
            Buscar
          </Button>
        </form>

        {categories.length > 0 && (
          <nav className={styles.categories} aria-label="Categorias">
            <a href={`/loja/${storeSlug}`} className={styles.categoryPill} data-active={!category || undefined}>
              Todas
            </a>
            {categories.map((c) => (
              <a
                key={c.id}
                href={`/loja/${storeSlug}?category=${c.slug}`}
                className={styles.categoryPill}
                data-active={category === c.slug || undefined}
              >
                {c.name}
              </a>
            ))}
          </nav>
        )}

        {products.length === 0 ? (
          <EmptyState icon={<IconBox />} title="Nenhum produto encontrado" description="Tente buscar por outro termo ou categoria." />
        ) : (
          <div className={styles.grid}>
            {products.map((product) => {
              const cover = covers.get(product.id);
              const coverUrl = cover ? catalog.publicImageUrl(NEXT_PUBLIC_SUPABASE_URL, cover.storage_path) : null;
              return (
                <div key={product.id} className={styles.card}>
                  <a className={styles.cardLink} href={`/loja/${storeSlug}/produto/${product.slug}`}>
                    <div className={styles.cardImage}>
                      {coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={coverUrl} alt="" loading="lazy" />
                      ) : (
                        <span className={styles.cardImagePlaceholder} aria-hidden="true" />
                      )}
                      {product.stock === 0 && (
                        <span className={styles.outOfStockBadge}>
                          <Badge tone="warning">Esgotado</Badge>
                        </span>
                      )}
                    </div>
                    <h2 className={styles.cardTitle}>{product.name}</h2>
                    <p className={styles.cardPrice}>{formatPriceCents(product.price_cents)}</p>
                  </a>
                  <AddToCartButton
                    storeSlug={storeSlug}
                    productId={product.id}
                    name={product.name}
                    slug={product.slug}
                    priceCents={product.price_cents}
                    stock={product.stock}
                    imageUrl={coverUrl}
                  />
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
