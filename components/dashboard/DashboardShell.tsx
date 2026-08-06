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
  IconMenu,
  IconClose,
  IconLogout,
  IconExternalLink,
  IconChevronDown,
} from "@/components/ui/icons";
import { dashboardNavItems, type DashboardNavKey } from "./nav-items";
import styles from "./DashboardShell.module.css";

const NAV_ICONS: Record<DashboardNavKey, ReactNode> = {
  painel: <IconHome />,
  categorias: <IconTag />,
  produtos: <IconBox />,
  pedidos: <IconReceipt />,
  pagamentos: <IconCreditCard />,
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

export function DashboardShell({ storeName, storeSlug, storeStatus, active, breadcrumbs, children }: DashboardShellProps) {
  const items = dashboardNavItems(storeSlug);
  const status = STATUS_LABEL[storeStatus];

  return (
    <div className={styles.shell}>
      <input type="checkbox" id="cs-nav-toggle" className={styles.navToggle} aria-hidden="true" />

      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <Link href={`/dashboard?store=${storeSlug}`} aria-label="Ir para o painel">
            <Logo size="sm" />
          </Link>
          <label htmlFor="cs-nav-toggle" className={styles.closeButton} aria-label="Fechar menu">
            <IconClose />
          </label>
        </div>

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

      <label htmlFor="cs-nav-toggle" className={styles.backdrop} aria-hidden="true" />

      <div className={styles.main}>
        <header className={styles.topbar}>
          <label htmlFor="cs-nav-toggle" className={styles.menuButton} aria-label="Abrir menu">
            <IconMenu />
          </label>

          <Link href="/select-store" className={styles.storeSwitcher}>
            <span className={styles.storeName}>{storeName}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
            <IconChevronDown className={styles.switcherIcon} />
          </Link>

          <div className={styles.topbarSpacer} />
        </header>

        <main className={styles.content}>
          {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
          {children}
        </main>
      </div>
    </div>
  );
}
