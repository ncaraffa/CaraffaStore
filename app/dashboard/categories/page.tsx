import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardNav } from "@/app/dashboard/dashboard-nav";
import * as catalog from "@/lib/catalog/service";
import { setCategoryActiveAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store, role } = await requireStoreStatus(supabase, "active", storeSlug);
  const categories = await catalog.listCategories(supabase, store.id);
  const canManage = role === "owner" || role === "admin";

  return (
    <main>
      <h1>Categorias — {store.name}</h1>
      <DashboardNav storeSlug={store.slug} />

      {canManage && (
        <p>
          <a href={`/dashboard/categories/new?store=${store.slug}`}>+ Nova categoria</a>
        </p>
      )}

      {categories.length === 0 ? (
        <p>Nenhuma categoria cadastrada ainda.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Endereço</th>
                <th>Ordem</th>
                <th>Estado</th>
                {canManage && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td>{category.name}</td>
                  <td>{category.slug}</td>
                  <td>{category.display_order}</td>
                  <td>
                    <span className="badge" data-tone={category.is_active ? "success" : "neutral"}>
                      {category.is_active ? "Ativa" : "Inativa"}
                    </span>
                  </td>
                  {canManage && (
                    <td className="table-actions">
                      <a href={`/dashboard/categories/${category.id}/edit?store=${store.slug}`}>Editar</a>
                      <form action={setCategoryActiveAction} style={{ display: "inline" }}>
                        <input type="hidden" name="storeSlug" value={store.slug} />
                        <input type="hidden" name="categoryId" value={category.id} />
                        <input type="hidden" name="nextActive" value={(!category.is_active).toString()} />
                        <button type="submit" className="btn-link">
                          {category.is_active ? "Desativar" : "Ativar"}
                        </button>
                      </form>
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
