import type { ReactNode } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/admin/access-control";
import { Logo } from "@/components/ui/Logo";
import { IconLogout, IconShield } from "@/components/ui/icons";
import styles from "./admin.module.css";

export const metadata = {
  title: "Painel do Proprietário",
};

/**
 * Camada visual deliberadamente diferente do dashboard de loja (fundo
 * escuro, selo "Acesso exclusivo") — ninguém deve confundir esta área
 * com o painel de um lojista comum. `requirePlatformAdmin` já barra
 * qualquer sessão fora de `platform_admins` antes de renderizar.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabaseClient();
  await requirePlatformAdmin(supabase);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Logo size="sm" variant="plain" />
          <span className={styles.divider} aria-hidden="true" />
          <span className={styles.title}>
            <IconShield />
            Painel do Proprietário
          </span>
        </div>
        <form action="/logout" method="post">
          <button type="submit" className={styles.logoutButton}>
            <IconLogout />
            Sair
          </button>
        </form>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
