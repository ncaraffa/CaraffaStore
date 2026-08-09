import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { AuthScene } from "@/components/auth/AuthScene";
import styles from "./auth-shell.module.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.visual}>
        <AuthScene />
      </div>

      <div className={styles.formSide}>
        <div className={styles.formSideInner}>
          <Link href="/" className={styles.logoLink}>
            <Logo size="md" compact />
          </Link>

          <div className={styles.card}>{children}</div>

          <p className={styles.footer}>
            <Link href="/termos">Termos de Uso</Link>
            <span aria-hidden="true">·</span>
            <Link href="/privacidade">Política de Privacidade</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
