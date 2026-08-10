import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  /** `end` põe o ícone depois do texto e o faz deslizar no hover — para setas de avanço. */
  iconPosition?: "start" | "end";
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  icon,
  iconPosition = "start",
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [styles.btn, styles[variant], styles[size], fullWidth ? styles.fullWidth : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  const spinner = <span className={styles.spinner} aria-hidden="true" />;
  const trailing = iconPosition === "end" && !loading;

  return (
    <button
      className={classes}
      data-icon-end={trailing || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? spinner : trailing ? null : icon}
      <span>{children}</span>
      {trailing && <span className={styles.trailingIcon}>{icon}</span>}
    </button>
  );
}
