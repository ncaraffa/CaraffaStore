import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import * as catalog from "@/lib/catalog/service";
import { formatPriceCents } from "@/lib/catalog/format";
import type { ProductStatus } from "@/lib/supabase/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Table, TableActions } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconBox, IconPlus } from "@/components/ui/icons";
import pageStyles from "../dashboard-list.module.css";
import filterStyles from "../filter-pills.module.css";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ProductStatus, string> = {
  draft: "Rascunho",
  published: "Publicado",
  archived: "Arquivado",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; status?: string }>;
}) {
  const { store: storeSlug, status } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store, role } = await requireStoreStatus(supabase, "active", storeSlug);

  const statusFilter =
    status === "draft" || status === "published" || status === "archived" ? (status as ProductStatus) : undefined;
  const products = await catalog.listProducts(supabase, store.id, { status: statusFilter });
  const canManage = role === "owner" || role === "admin";

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
            <Button icon={<IconPlus />}>Novo produto</Button>
          </Link>
        )}
      </div>

      <nav aria-label="Filtrar por status" className={filterStyles.pills}>
        {filters.map((filter) => {
          const isActive = filter.value === statusFilter;
          const href = filter.value
            ? `/dashboard/products?store=${store.slug}&status=${filter.value}`
            : `/dashboard/products?store=${store.slug}`;
          return (
            <Link key={filter.label} href={href} className={filterStyles.pill} data-active={isActive || undefined}>
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {products.length === 0 ? (
        <EmptyState
          icon={<IconBox />}
          title="Nenhum produto encontrado"
          description="Cadastre produtos para começar a vender no seu catálogo público."
          action={
            canManage && (
              <Link href={`/dashboard/products/new?store=${store.slug}`}>
                <Button icon={<IconPlus />}>Criar primeiro produto</Button>
              </Link>
            )
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Preço</th>
              <th>Estoque</th>
              <th>Status</th>
              {canManage && <th>Ações</th>}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>{product.name}</td>
                <td>{formatPriceCents(product.price_cents)}</td>
                <td>
                  <TableActions>
                    <span>{product.stock}</span>
                    {product.status === "published" && product.stock === 0 && <Badge tone="warning">Esgotado</Badge>}
                  </TableActions>
                </td>
                <td>
                  <Badge tone={product.status === "published" ? "success" : "neutral"}>
                    {STATUS_LABEL[product.status]}
                  </Badge>
                </td>
                {canManage && (
                  <td>
                    <Link href={`/dashboard/products/${product.id}/edit?store=${store.slug}`}>
                      <Button variant="ghost" size="sm">
                        Editar
                      </Button>
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </DashboardShell>
  );
}
