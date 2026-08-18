import Link from "next/link";
import type { ReactNode } from "react";
import type { StoreStatus } from "@/lib/supabase/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Logo } from "@/components/ui/Logo";
import { Breadcrumbs, type Crumb } from "@/components/ui/Breadcrumbs";
import {
  IconHome,
  IconTag,
  IconBox,
  IconReceipt,
  IconCreditCard,
  IconLayers,
  IconUsers,
  IconLogout,
  IconExternalLink,
  IconChevronDown,
} from "@/components/ui/icons";
import { dashboardNavItems, type DashboardNavKey } from "./nav-items";
import { SessionHeartbeat } from "./SessionHeartbeat";
import styles from "./DashboardShell.module.css";

const NAV_ICONS: Record<DashboardNavKey, ReactNode> = {
  painel: <IconHome />,
  categorias: <IconTag />,
  produtos: <IconBox />,
  pedidos: <IconReceipt />,
  pagamentos: <IconCreditCard />,
  equipe: <IconUsers />,
  assinatura: <IconLayers />,
};

const STATUS_LABEL: Record<StoreStatus, { label: string; tone: BadgeTone }> = {
  onboarding: { label: "Configurando", tone: "neutral" },
  pending_payment: { label: "Pagamento pendente", tone: "warning" },
  active: { label: "Ativa", tone: "success" },
  suspended: { label: "Suspensa", tone: "danger" },
};

interface DashboardShellProps {
  storeName: string;
  storeSlug: string;
  storeStatus: StoreStatus;
  active: DashboardNavKey;
  breadcrumbs?: Crumb[];
  children: ReactNode;
}

/**
 * Duas navegações genuinamente diferentes, não uma versão "espremida" da
 * outra: no desktop, uma sidebar completa com contexto de loja no rodapé;
 * no celular, uma barra de abas fixa embaixo (alcance de polegar) e um
 * topbar fino com o essencial. Não existe mais o drawer com checkbox —
 * com 5 seções, uma bottom tab bar cobre exatamente o mesmo território
 * de navegação sem precisar de um menu escondido.
 */
export function DashboardShell({ storeName, storeSlug, storeStatus, active, breadcrumbs, children }: DashboardShellProps) {
  const items = dashboardNavItems(storeSlug);
  const status = STATUS_LABEL[storeStatus];

  return (
    <div className={styles.shell}>
      {/* TASK-012: mantém o lease da sessão vivo e encerra a sessão local
          quando ela é revogada em outro lugar. Fica no shell porque toda
          tela administrativa passa por aqui — não é segurança (o banco
          recusa de qualquer forma), é para o lojista não operar uma tela
          morta. */}
      <SessionHeartbeat />
      <aside className={styles.sidebar}>
        <Link href={`/dashboard?store=${storeSlug}`} className={styles.brand} aria-label="Ir para o painel">
          <Logo size="md" />
        </Link>

        <nav className={styles.nav} aria-label="Navegação do painel">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={styles.navItem}
              data-active={item.key === active || undefined}
              aria-current={item.key === active ? "page" : undefined}
            >
              {NAV_ICONS[item.key]}
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <Link href="/select-store" className={styles.storeCard}>
            <span className={styles.storeCardName}>{storeName}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
            <IconChevronDown className={styles.storeCardIcon} />
          </Link>
          <a href={`/loja/${storeSlug}`} target="_blank" rel="noreferrer" className={styles.footerLink}>
            <IconExternalLink />
            Ver catálogo público
          </a>
          <form action="/logout" method="post">
            <button type="submit" className={styles.logoutButton}>
              <IconLogout />
              Sair
            </button>
          </form>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <Link href={`/dashboard?store=${storeSlug}`} className={styles.topbarLogo} aria-label="Ir para o painel">
            <Logo size="sm" markOnly />
          </Link>

          <Link href="/select-store" className={styles.storeSwitcher}>
            <span className={styles.storeName}>{storeName}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
            <IconChevronDown className={styles.switcherIcon} />
          </Link>

          <div className={styles.topbarSpacer} />

          <a
            href={`/loja/${storeSlug}`}
            target="_blank"
            rel="noreferrer"
            className={styles.topbarAction}
            aria-label="Ver catálogo público"
          >
            <IconExternalLink />
          </a>
          <form action="/logout" method="post" className={styles.topbarLogoutForm}>
            <button type="submit" className={styles.topbarAction} aria-label="Sair">
              <IconLogout />
            </button>
          </form>
        </header>

        <main className={styles.content}>
          {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
          {children}
        </main>
      </div>

      <nav className={styles.mobileTabs} aria-label="Navegação do painel">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={styles.mobileTab}
            data-active={item.key === active || undefined}
            aria-current={item.key === active ? "page" : undefined}
          >
            {NAV_ICONS[item.key]}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
