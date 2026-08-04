import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardNav } from "@/app/dashboard/dashboard-nav";
import * as catalog from "@/lib/catalog/service";
import { formatPriceCents } from "@/lib/catalog/format";
import type { ProductStatus } from "@/lib/supabase/types";

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

  return (
    <main>
      <h1>Produtos — {store.name}</h1>
      <DashboardNav storeSlug={store.slug} />

      <nav aria-label="Filtrar por status" className="dashboard-nav">
        <a href={`/dashboard/products?store=${store.slug}`} aria-current={!statusFilter}>
          Todos
        </a>
        <a href={`/dashboard/products?store=${store.slug}&status=draft`} aria-current={statusFilter === "draft"}>
          Rascunhos
        </a>
        <a
          href={`/dashboard/products?store=${store.slug}&status=published`}
          aria-current={statusFilter === "published"}
        >
          Publicados
        </a>
        <a
          href={`/dashboard/products?store=${store.slug}&status=archived`}
          aria-current={statusFilter === "archived"}
        >
          Arquivados
        </a>
      </nav>

      {canManage && (
        <p>
          <a href={`/dashboard/products/new?store=${store.slug}`}>+ Novo produto</a>
        </p>
      )}

      {products.length === 0 ? (
        <p>Nenhum produto encontrado.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
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
                    {product.stock}
                    {product.status === "published" && product.stock === 0 && (
                      <span className="badge" data-tone="warning">
                        Esgotado
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="badge" data-tone={product.status === "published" ? "success" : "neutral"}>
                      {STATUS_LABEL[product.status]}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <a href={`/dashboard/products/${product.id}/edit?store=${store.slug}`}>Editar</a>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
