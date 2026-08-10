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
  const coverUrlFor = (productId: string) => {
    const cover = covers.get(productId);
    return cover ? catalog.publicImageUrl(NEXT_PUBLIC_SUPABASE_URL, cover.storage_path) : null;
  };

  const isFiltered = Boolean(q || category);
  const productCountLabel = describeProductCount(products.length, categories.length, isFiltered);
  const singleProduct = products.length === 1 ? products[0] : undefined;

  return (
    <>
      <StorefrontHeader storeSlug={storeSlug} storeName={store.name} />
      <main className={styles.main}>
        <section className={styles.intro}>
          <p className={styles.introLabel}>Catálogo</p>
          <h1 className={styles.introTitle}>{store.name}</h1>
          {productCountLabel && <p className={styles.introMeta}>{productCountLabel}</p>}
        </section>

        <div className={styles.toolbar}>
          <form className={styles.search} method="get">
            <Input
              type="search"
              name="q"
              placeholder="Buscar produtos..."
              defaultValue={q ?? ""}
              aria-label="Buscar produtos"
            />
            {category && <input type="hidden" name="category" value={category} />}
            <Button type="submit" variant="outline" icon={<IconSearch />}>
              Buscar
            </Button>
          </form>

          {/* Trilho horizontal, não sidebar fixa — TASK008-PROP-002 (retest):
              uma coluna de 14rem para 1-2 categorias reais desperdiçava
              largura do conteúdo e ainda deixava o grid estreito. Chips
              horizontais dão a mesma navegação sem tomar espaço permanente. */}
          {categories.length > 0 && (
            <nav className={styles.categoryChips} aria-label="Categorias">
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
        </div>

        {products.length === 0 ? (
          <div className={styles.emptyPanel}>
            <EmptyState
              icon={<IconBox />}
              title={isFiltered ? "Nenhum produto encontrado" : "Nenhum produto publicado ainda"}
              description={
                isFiltered
                  ? "Tente buscar por outro termo ou categoria."
                  : "Esta loja está preparando o catálogo. Volte em breve."
              }
            />
          </div>
        ) : singleProduct ? (
          <SpotlightProduct storeSlug={storeSlug} product={singleProduct} coverUrl={coverUrlFor(singleProduct.id)} />
        ) : (
          <div className={styles.grid} data-count={Math.min(products.length, 4)}>
            {products.map((product) => {
              const coverUrl = coverUrlFor(product.id);
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

/**
 * Catálogo de 1 produto só (TASK008-PROP-002, retest): em qualquer grid,
 * 1 item entre N tracks sempre deixa espaço vazio ao lado — não é um
 * problema de auto-fit/auto-fill, é estrutural. A saída pedida
 * explicitamente foi tratamento visual dedicado (mais largura, imagem
 * maior, composição centralizada), nunca inventar rótulo de "destaque"
 * como feature de negócio — é só o mesmo produto, com mais espaço.
 */
function SpotlightProduct({
  storeSlug,
  product,
  coverUrl,
}: {
  storeSlug: string;
  product: Awaited<ReturnType<typeof catalog.listPublicProducts>>[number];
  coverUrl: string | null;
}) {
  return (
    <div className={styles.spotlight}>
      <a className={styles.spotlightImageLink} href={`/loja/${storeSlug}/produto/${product.slug}`}>
        <div className={styles.spotlightImage}>
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
      </a>
      <div className={styles.spotlightBody}>
        <a href={`/loja/${storeSlug}/produto/${product.slug}`} className={styles.spotlightLink}>
          <h2 className={styles.spotlightTitle}>{product.name}</h2>
        </a>
        {product.description && <p className={styles.spotlightDescription}>{product.description}</p>}
        <p className={styles.spotlightPrice}>{formatPriceCents(product.price_cents)}</p>
        <div className={styles.spotlightAction}>
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
      </div>
    </div>
  );
}

/**
 * Só dados reais desta mesma requisição (nada de contagem inventada):
 * quando há filtro ativo, o total de categorias não é a métrica certa
 * ("3 produtos em 5 categorias" confundiria — os produtos filtrados não
 * cobrem as 5), então o texto some para "N produtos encontrados".
 */
function describeProductCount(productCount: number, categoryCount: number, isFiltered: boolean): string {
  if (productCount === 0) return "";
  const productLabel = productCount === 1 ? "1 produto" : `${productCount} produtos`;
  if (isFiltered) return productCount === 1 ? `${productLabel} encontrado` : `${productLabel} encontrados`;
  if (categoryCount === 0) return productLabel;
  const categoryLabel = categoryCount === 1 ? "1 categoria" : `${categoryCount} categorias`;
  return `${productLabel} em ${categoryLabel}`;
}
