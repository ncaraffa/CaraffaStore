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
  /**
   * `span` renderiza a MESMA aparência sem ser um controle.
   *
   * Use sempre que o botão estiver dentro de um `<Link>`/`<a>`: um
   * `<button>` dentro de um `<a>` é aninhamento inválido em HTML, dá
   * dois pontos de tabulação para uma ação só e faz leitor de tela
   * anunciar "link, botão" na mesma coisa. Com `as="span"` sobra
   * exatamente um controle — o link — com o visual de botão.
   */
  as?: "button" | "span";
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  icon,
  iconPosition = "start",
  as = "button",
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  // `cs-btn` é um gancho global e sem estilo próprio: páginas que
  // precisam recolorir o botão dentro de um contexto específico (a
  // quebra azul da landing, por exemplo) miram nele em vez de mirar no
  // elemento `button` — que deixa de existir na variante `span`.
  const classes = [
    "cs-btn",
    styles.btn,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const spinner = <span className={styles.spinner} aria-hidden="true" />;
  const trailing = iconPosition === "end" && !loading;

  const content = (
    <>
      {loading ? spinner : trailing ? null : icon}
      <span>{children}</span>
      {trailing && <span className={styles.trailingIcon}>{icon}</span>}
    </>
  );

  // Na variante `span` os atributos de botão (type, onClick, disabled…)
  // não são repassados de propósito: quem carrega a semântica e o
  // comportamento é o link em volta.
  if (as === "span") {
    return (
      <span className={classes} data-icon-end={trailing || undefined}>
        {content}
      </span>
    );
  }

  return (
    <button
      className={classes}
      data-icon-end={trailing || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  );
}
