import Link from "next/link";
import type { ElementType } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import * as catalog from "@/lib/catalog/service";
import { formatPriceCents } from "@/lib/catalog/format";
import type { ProductStatus } from "@/lib/supabase/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconBox, IconPlus, IconSearch } from "@/components/ui/icons";
import pageStyles from "../dashboard-list.module.css";
import filterStyles from "../filter-pills.module.css";
import styles from "./products-list.module.css";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ProductStatus, string> = {
  draft: "Rascunho",
  published: "Publicado",
  archived: "Arquivado",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; status?: string; q?: string }>;
}) {
  const { store: storeSlug, status, q } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store, role } = await requireStoreStatus(supabase, "active", storeSlug);

  const statusFilter =
    status === "draft" || status === "published" || status === "archived" ? (status as ProductStatus) : undefined;
  const products = await catalog.listProducts(supabase, store.id, { status: statusFilter, search: q });
  const canManage = role === "owner" || role === "admin";

  const covers = await catalog.listCoverImagesByProductIds(
    supabase,
    products.map((product) => product.id),
  );
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  const coverUrl = (productId: string) => {
    const cover = covers.get(productId);
    return cover ? catalog.publicImageUrl(NEXT_PUBLIC_SUPABASE_URL, cover.storage_path) : null;
  };

  const filters: Array<{ label: string; value?: ProductStatus }> = [
    { label: "Todos" },
    { label: "Rascunhos", value: "draft" },
    { label: "Publicados", value: "published" },
    { label: "Arquivados", value: "archived" },
  ];

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="produtos"
      breadcrumbs={[{ label: "Painel", href: `/dashboard?store=${store.slug}` }, { label: "Produtos" }]}
    >
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Produtos</h1>
          <p className={pageStyles.subtitle}>Gerencie o catálogo, preços, estoque e imagens.</p>
        </div>
        {canManage && (
          <Link href={`/dashboard/products/new?store=${store.slug}`}>
            <Button as="span" icon={<IconPlus />}>Novo produto</Button>
          </Link>
        )}
      </div>

      <div className={styles.toolbar}>
        <nav aria-label="Filtrar por status" className={filterStyles.pills}>
          {filters.map((filter) => {
            const isActive = filter.value === statusFilter;
            const params = new URLSearchParams({ store: store.slug });
            if (filter.value) params.set("status", filter.value);
            if (q) params.set("q", q);
            return (
              <Link
                key={filter.label}
                href={`/dashboard/products?${params.toString()}`}
                className={filterStyles.pill}
                data-active={isActive || undefined}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>

        <form action="/dashboard/products" method="get" className={styles.searchForm}>
          <input type="hidden" name="store" value={store.slug} />
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          <Input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Buscar por nome..."
            aria-label="Buscar produtos"
            className={styles.searchInput}
          />
          <button type="submit" className={styles.searchButton} aria-label="Buscar">
            <IconSearch />
          </button>
        </form>
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={<IconBox />}
          title={q ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}
          description={
            q
              ? `Nada corresponde a “${q}”. Tente outro termo ou limpe a busca.`
              : "Cadastre produtos para começar a vender no seu catálogo público."
          }
          action={
            canManage &&
            !q && (
              <Link href={`/dashboard/products/new?store=${store.slug}`}>
                <Button as="span" icon={<IconPlus />}>Criar primeiro produto</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          {/* Desktop: tabela com miniatura. Mobile: catálogo em cards —
              não é a mesma tabela espremida, é outra composição. */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thProduct}>Produto</th>
                  <th>Preço</th>
                  <th>Estoque</th>
                  <th>Status</th>
                  {canManage && <th className={styles.thActions}>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const image = coverUrl(product.id);
                  const soldOut = product.status === "published" && product.stock === 0;
                  return (
                    <tr key={product.id}>
                      <td>
                        <div className={styles.productCell}>
                          <span className={styles.thumb} data-empty={!image || undefined}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- mesmo padrão de image-manager.tsx: URL do Supabase Storage, sem remotePatterns configurado para next/image */}
                            {image ? <img src={image} alt="" loading="lazy" /> : <IconBox />}
                          </span>
                          <span className={styles.productName}>{product.name}</span>
                        </div>
                      </td>
                      <td className={styles.priceCell}>{formatPriceCents(product.price_cents)}</td>
                      <td className={styles.stockCell} data-zero={soldOut || undefined}>
                        {product.stock} un.
                      </td>
                      <td>
                        <Badge tone={product.status === "published" ? "success" : "neutral"}>
                          {soldOut ? "Esgotado" : STATUS_LABEL[product.status]}
                        </Badge>
                      </td>
                      {canManage && (
                        <td className={styles.thActions}>
                          <Link href={`/dashboard/products/${product.id}/edit?store=${store.slug}`}>
                            <Button as="span" variant="ghost" size="sm">
                              Editar
                            </Button>
                          </Link>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className={styles.cardList}>
            {products.map((product) => {
              const image = coverUrl(product.id);
              const soldOut = product.status === "published" && product.stock === 0;
              const CardTag: ElementType = canManage ? Link : "div";
              const cardProps = canManage ? { href: `/dashboard/products/${product.id}/edit?store=${store.slug}` } : {};
              return (
                <li key={product.id}>
                  <CardTag className={styles.productCard} {...cardProps}>
                    <span className={styles.cardThumb} data-empty={!image || undefined}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- ver comentário acima na tabela */}
                      {image ? <img src={image} alt="" loading="lazy" /> : <IconBox />}
                    </span>
                    <span className={styles.cardBody}>
                      <span className={styles.cardName}>{product.name}</span>
                      <span className={styles.cardMeta}>
                        <span className={styles.cardPrice}>{formatPriceCents(product.price_cents)}</span>
                        <span className={styles.cardStock} data-zero={soldOut || undefined}>
                          {product.stock} un.
                        </span>
                      </span>
                    </span>
                    <Badge tone={product.status === "published" ? "success" : "neutral"}>
                      {soldOut ? "Esgotado" : STATUS_LABEL[product.status]}
                    </Badge>
                  </CardTag>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </DashboardShell>
  );
}
