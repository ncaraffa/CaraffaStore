export type DashboardNavKey =
  | "painel"
  | "categorias"
  | "produtos"
  | "pedidos"
  | "pagamentos"
  | "frete"
  | "marketing"
  | "equipe"
  | "assinatura";

export interface DashboardNavItem {
  key: DashboardNavKey;
  label: string;
  href: string;
}

/** Ordem completa — é o que a sidebar do desktop mostra. */
export function dashboardNavItems(storeSlug: string): DashboardNavItem[] {
  return [
    { key: "painel", label: "Painel", href: `/dashboard?store=${storeSlug}` },
    { key: "categorias", label: "Categorias", href: `/dashboard/categories?store=${storeSlug}` },
    { key: "produtos", label: "Produtos", href: `/dashboard/products?store=${storeSlug}` },
    { key: "pedidos", label: "Pedidos", href: `/dashboard/orders?store=${storeSlug}` },
    { key: "pagamentos", label: "Pagamentos", href: `/dashboard/settings/payments?store=${storeSlug}` },
    // Frete fica logo abaixo de Pagamentos: as duas respondem "como o
    // dinheiro e a mercadoria chegam", e o lojista procura as duas no
    // mesmo canto do painel.
    { key: "frete", label: "Frete", href: `/dashboard/settings/frete?store=${storeSlug}` },
    // Cupons e Equipe aparecem em TODOS os planos de propósito: no
    // Essencial cada uma é o ponto de descoberta do recurso (upsell),
    // não um item quebrado. Esconder deixaria o comerciante sem saber
    // que existem.
    { key: "marketing", label: "Cupons", href: `/dashboard/marketing/cupons?store=${storeSlug}` },
    { key: "equipe", label: "Equipe", href: `/dashboard/settings/equipe?store=${storeSlug}` },
    { key: "assinatura", label: "Assinatura", href: `/dashboard/assinatura?store=${storeSlug}` },
  ];
}

/**
 * No celular a barra inferior comporta bem 4 alvos de toque; com 8 os
 * ícones ficariam com ~11% da largura cada, abaixo do mínimo confortável
 * e com o rótulo truncado.
 *
 * Então a barra leva as três telas do dia a dia (o que o lojista abre
 * várias vezes por dia) e um botão "Mais" com o restante. O critério não
 * é "as 3 primeiras do menu": é frequência de uso real — Painel para
 * olhar o movimento, Produtos para mexer no catálogo, Pedidos para
 * atender. Categorias, Pagamentos, Cupons, Equipe e Assinatura são
 * configuração ou consulta ocasional.
 */
const PRIMARY_MOBILE_KEYS: DashboardNavKey[] = ["painel", "produtos", "pedidos"];

export function dashboardMobilePrimary(storeSlug: string): DashboardNavItem[] {
  const all = dashboardNavItems(storeSlug);
  return PRIMARY_MOBILE_KEYS.map((key) => all.find((item) => item.key === key)!).filter(Boolean);
}

export function dashboardMobileSecondary(storeSlug: string): DashboardNavItem[] {
  return dashboardNavItems(storeSlug).filter((item) => !PRIMARY_MOBILE_KEYS.includes(item.key));
}

/** A rota atual está escondida dentro de "Mais"? Então "Mais" fica ativo. */
export function isSecondaryKey(key: DashboardNavKey): boolean {
  return !PRIMARY_MOBILE_KEYS.includes(key);
}
