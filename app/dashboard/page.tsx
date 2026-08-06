import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card, CardHeader } from "@/components/ui/Card";
import { IconTag, IconBox, IconReceipt, IconCreditCard, IconExternalLink } from "@/components/ui/icons";
import styles from "./dashboard-home.module.css";

export const dynamic = "force-dynamic";

/**
 * requireStoreStatus exige uma loja `active` de verdade — sem `?store=`
 * resolve pela situação real de memberships (nunca libera acesso
 * genérico por ausência do parâmetro; corrige BUG-T2-001,
 * qa/reports/TASK-002.md).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  const shortcuts = [
    { href: `/dashboard/products/new?store=${store.slug}`, icon: <IconBox />, label: "Novo produto", description: "Cadastrar um produto no catálogo" },
    { href: `/dashboard/categories/new?store=${store.slug}`, icon: <IconTag />, label: "Nova categoria", description: "Organizar seu catálogo" },
    { href: `/dashboard/orders?store=${store.slug}`, icon: <IconReceipt />, label: "Ver pedidos", description: "Acompanhar vendas e pagamentos" },
    { href: `/dashboard/settings/payments?store=${store.slug}`, icon: <IconCreditCard />, label: "Pagamentos", description: "Configurar Pix / Mercado Pago" },
  ];

  return (
    <DashboardShell storeName={store.name} storeSlug={store.slug} storeStatus={store.status} active="painel">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Olá! Bem-vindo de volta.</h1>
          <p className={styles.subtitle}>
            A loja <strong>{store.name}</strong> está ativa e pronta para vender.
          </p>
        </div>
        <a href={`/loja/${store.slug}`} target="_blank" rel="noreferrer" className={styles.catalogLink}>
          <IconExternalLink />
          Ver catálogo público
        </a>
      </div>

      <div className={styles.grid}>
        {shortcuts.map((item) => (
          <Link key={item.href} href={item.href} className={styles.shortcut}>
            <span className={styles.shortcutIcon}>{item.icon}</span>
            <span>
              <span className={styles.shortcutLabel}>{item.label}</span>
              <span className={styles.shortcutDescription}>{item.description}</span>
            </span>
          </Link>
        ))}
      </div>

      <Card className={styles.tip}>
        <CardHeader title="Próximos passos" description="Sugestões para deixar sua loja completa." />
        <ul className={styles.tipList}>
          <li>Cadastre categorias para organizar seus produtos.</li>
          <li>Adicione fotos de qualidade a cada produto publicado.</li>
          <li>Confirme se o Pix está ativo em Pagamentos antes de divulgar a loja.</li>
        </ul>
      </Card>
    </DashboardShell>
  );
}
