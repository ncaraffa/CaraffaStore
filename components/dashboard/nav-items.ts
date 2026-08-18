export type DashboardNavKey =
  | "painel"
  | "categorias"
  | "produtos"
  | "pedidos"
  | "pagamentos"
  | "equipe"
  | "assinatura";

export function dashboardNavItems(storeSlug: string): Array<{ key: DashboardNavKey; label: string; href: string }> {
  return [
    { key: "painel", label: "Painel", href: `/dashboard?store=${storeSlug}` },
    { key: "categorias", label: "Categorias", href: `/dashboard/categories?store=${storeSlug}` },
    { key: "produtos", label: "Produtos", href: `/dashboard/products?store=${storeSlug}` },
    { key: "pedidos", label: "Pedidos", href: `/dashboard/orders?store=${storeSlug}` },
    { key: "pagamentos", label: "Pagamentos", href: `/dashboard/settings/payments?store=${storeSlug}` },
    // TASK-012: Equipe aparece para todos os planos de propósito — no
    // Essencial ela é o ponto de upsell ("adicione pessoas a partir do
    // Crescimento"), não um item quebrado. Esconder deixaria o
    // comerciante sem descobrir que o recurso existe.
    { key: "equipe", label: "Equipe", href: `/dashboard/settings/equipe?store=${storeSlug}` },
    { key: "assinatura", label: "Assinatura", href: `/dashboard/assinatura?store=${storeSlug}` },
  ];
}
