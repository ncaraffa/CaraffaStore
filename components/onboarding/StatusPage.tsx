import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import styles from "./StatusPage.module.css";

export function StatusPage({ icon, title, children, actions }: { icon: ReactNode; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.shell}>
      <Link href="/" className={styles.logoLink}>
        <Logo size="md" />
      </Link>
      <div className={styles.card}>
        <span className={styles.icon}>{icon}</span>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.body}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
