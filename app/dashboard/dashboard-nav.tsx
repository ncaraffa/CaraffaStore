export function DashboardNav({ storeSlug }: { storeSlug: string }) {
  return (
    <nav className="dashboard-nav" aria-label="Navegação do painel">
      <a href={`/dashboard?store=${storeSlug}`}>Painel</a>
      <a href={`/dashboard/categories?store=${storeSlug}`}>Categorias</a>
      <a href={`/dashboard/products?store=${storeSlug}`}>Produtos</a>
      <a href={`/dashboard/orders?store=${storeSlug}`}>Pedidos</a>
      <a href={`/dashboard/settings/payments?store=${storeSlug}`}>Pagamentos</a>
    </nav>
  );
}
