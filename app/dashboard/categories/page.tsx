import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import * as catalog from "@/lib/catalog/service";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Table, TableActions } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { IconTag, IconPlus } from "@/components/ui/icons";
import { setCategoryActiveAction } from "./actions";
import pageStyles from "../dashboard-list.module.css";

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
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="categorias"
      breadcrumbs={[{ label: "Painel", href: `/dashboard?store=${store.slug}` }, { label: "Categorias" }]}
    >
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Categorias</h1>
          <p className={pageStyles.subtitle}>Organize seu catálogo em categorias para facilitar a navegação.</p>
        </div>
        {canManage && (
          <Link href={`/dashboard/categories/new?store=${store.slug}`}>
            <Button icon={<IconPlus />}>Nova categoria</Button>
          </Link>
        )}
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={<IconTag />}
          title="Nenhuma categoria cadastrada"
          description="Categorias ajudam clientes a encontrar produtos mais rápido no seu catálogo público."
          action={
            canManage && (
              <Link href={`/dashboard/categories/new?store=${store.slug}`}>
                <Button icon={<IconPlus />}>Criar primeira categoria</Button>
              </Link>
            )
          }
        />
      ) : (
        <Table>
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
                  <Badge tone={category.is_active ? "success" : "neutral"}>
                    {category.is_active ? "Ativa" : "Inativa"}
                  </Badge>
                </td>
                {canManage && (
                  <td>
                    <TableActions>
                      <Link href={`/dashboard/categories/${category.id}/edit?store=${store.slug}`}>
                        <Button variant="ghost" size="sm">
                          Editar
                        </Button>
                      </Link>
                      <form action={setCategoryActiveAction}>
                        <input type="hidden" name="storeSlug" value={store.slug} />
                        <input type="hidden" name="categoryId" value={category.id} />
                        <input type="hidden" name="nextActive" value={(!category.is_active).toString()} />
                        {category.is_active ? (
                          <ConfirmSubmitButton
                            label="Desativar"
                            confirmTitle="Desativar categoria"
                            confirmMessage={`"${category.name}" deixará de aparecer no catálogo público. Você pode reativar quando quiser.`}
                            confirmLabel="Desativar"
                          />
                        ) : (
                          <Button type="submit" variant="outline" size="sm">
                            Ativar
                          </Button>
                        )}
                      </form>
                    </TableActions>
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
