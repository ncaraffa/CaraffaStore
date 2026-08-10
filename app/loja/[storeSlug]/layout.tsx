import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./storefront-layout.module.css";

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      {children}
      <footer className={styles.footer}>
        <p className={styles.attribution}>
          Criado com{" "}
          <Link href="/" className={styles.brandLink}>
            CaraffaStore
          </Link>
        </p>
        <nav className={styles.legalLinks}>
          <Link href="/termos">Termos de Uso</Link>
          <Link href="/privacidade">Política de Privacidade</Link>
        </nav>
      </footer>
    </div>
  );
}
