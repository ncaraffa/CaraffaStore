import type { ReactNode } from "react";
import styles from "./Table.module.css";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>{children}</table>
    </div>
  );
}

export function TableActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
