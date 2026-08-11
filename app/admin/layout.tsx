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
 * Camada visual deliberadamente diferente do dashboard de loja (superfície
 * escura, selo de acesso exclusivo) — ninguém deve confundir esta área com
 * o painel de um lojista comum. `requirePlatformAdmin` já barra qualquer
 * sessão fora de `platform_admins` antes de renderizar.
 *
 * O logo usa `tone="inverse"`: o padrão pinta a palavra em `--cs-ink`
 * (azul-marinho), que desaparece por completo sobre o header escuro.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const { email } = await requirePlatformAdmin(supabase);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Logo size="md" tone="inverse" />
          <span className={styles.divider} aria-hidden="true" />
          <span className={styles.crest}>
            <IconShield />
            Painel do Proprietário
          </span>
        </div>

        <div className={styles.identity}>
          {email && (
            <span className={styles.account}>
              <span className={styles.accountLabel}>Sessão de dono</span>
              <span className={styles.accountEmail}>{email}</span>
            </span>
          )}
          <form action="/logout" method="post">
            <button type="submit" className={styles.logoutButton}>
              <IconLogout />
              Sair
            </button>
          </form>
        </div>
      </header>

      <main className={styles.content}>{children}</main>
    </div>
  );
}
