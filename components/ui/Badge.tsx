import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export type BadgeTone = "success" | "warning" | "danger" | "neutral" | "info";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={[styles.badge, styles[tone]].join(" ")}>{children}</span>;
}
