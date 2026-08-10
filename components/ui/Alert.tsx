import type { ReactNode } from "react";
import styles from "./Alert.module.css";

export type AlertTone = "success" | "warning" | "danger" | "info";

const ICONS: Record<AlertTone, string> = {
  success: "✓",
  warning: "!",
  danger: "✕",
  info: "i",
};

export function Alert({ tone = "info", title, children }: { tone?: AlertTone; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={[styles.alert, styles[tone]].join(" ")} role={tone === "danger" ? "alert" : "status"}>
      <span className={styles.icon} aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div>
        {title && <p className={styles.title}>{title}</p>}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
