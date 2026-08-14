import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import * as catalog from "@/lib/catalog/service";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { IconTag, IconPlus } from "@/components/ui/icons";
import { setCategoryActiveAction } from "./actions";
import pageStyles from "../dashboard-list.module.css";
import styles from "./categories-list.module.css";

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
  const activeCount = categories.filter((c) => c.is_active).length;

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
          <p className={pageStyles.subtitle}>
            {categories.length === 0
              ? "Organize seu catálogo em categorias para facilitar a navegação."
              : `${activeCount} ativa${activeCount === 1 ? "" : "s"} de ${categories.length} no total.`}
          </p>
        </div>
        {canManage && (
          <Link href={`/dashboard/categories/new?store=${store.slug}`}>
            <Button as="span" icon={<IconPlus />}>Nova categoria</Button>
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
                <Button as="span" icon={<IconPlus />}>Criar primeira categoria</Button>
              </Link>
            )
          }
        />
      ) : (
        <ul className={styles.grid}>
          {categories
            .slice()
            .sort((a, b) => a.display_order - b.display_order)
            .map((category) => (
              <li key={category.id} className={styles.card} data-inactive={!category.is_active || undefined}>
                <span className={styles.icon}>
                  <IconTag />
                </span>
                <div className={styles.body}>
                  <div className={styles.titleRow}>
                    <span className={styles.name}>{category.name}</span>
                    <Badge tone={category.is_active ? "success" : "neutral"}>
                      {category.is_active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  <span className={styles.slug}>/{category.slug}</span>
                  {category.description && <p className={styles.description}>{category.description}</p>}
                </div>

                {canManage && (
                  <div className={styles.actions}>
                    <Link href={`/dashboard/categories/${category.id}/edit?store=${store.slug}`}>
                      <Button as="span" variant="ghost" size="sm">
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
                  </div>
                )}
              </li>
            ))}
        </ul>
      )}
    </DashboardShell>
  );
}
