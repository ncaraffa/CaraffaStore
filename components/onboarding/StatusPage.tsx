import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import styles from "./StatusPage.module.css";

export type StatusTone = "neutral" | "success" | "warning" | "danger";

/**
 * Shell compartilhado por pending-payment, suspended, not-found e sucesso
 * do pedido — `tone` diferencia visualmente cada contexto (o ícone muda
 * de cor conforme o significado: sucesso é verde, suspensão é vermelha,
 * "não encontrado" é neutro) em vez de todas as telas usarem o mesmo azul
 * genérico independente do que aconteceu.
 */
export function StatusPage({
  icon,
  title,
  children,
  actions,
  tone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <div className={styles.shell}>
      <Link href="/" className={styles.logoLink}>
        <Logo size="md" compact />
      </Link>
      <div className={styles.card}>
        <span className={styles.icon} data-tone={tone}>
          {icon}
        </span>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.body}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
