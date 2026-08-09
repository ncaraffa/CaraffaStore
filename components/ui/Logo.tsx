import styles from "./Logo.module.css";

/**
 * Marca da CaraffaStore.
 *
 * O símbolo é uma jarra ("caraffa", em italiano) desenhada em geometria
 * fechada, cortada por uma linha de nível. A linha não é ornamento: é o
 * mesmo motivo usado no produto para estoque, progresso de onboarding e
 * hierarquia de plano — o que se enche e o que se serve.
 *
 * O furo da linha é feito por `fill-rule: evenodd` no mesmo path, então o
 * símbolo é um único caminho, sem `clipPath`/`mask` (nada de id duplicado
 * quando a marca aparece mais de uma vez na página) e legível a 16px.
 */
export function CaraffaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect x="8.7" y="2.4" width="6.6" height="2.9" rx="1.45" fill="currentColor" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.6 5.1h4.8v3.1c0 1.05.45 2.05 1.24 2.74l2.16 1.96c1.14 1 1.8 2.45 1.8 3.97v.53a3.2 3.2 0 0 1-3.2 3.2H7.6a3.2 3.2 0 0 1-3.2-3.2v-.53c0-1.52.66-2.97 1.8-3.97l2.16-1.96C9.15 10.25 9.6 9.25 9.6 8.2V5.1ZM5.9 13.6h12.2v1.5H5.9v-1.5Z"
      />
    </svg>
  );
}

export type LogoSize = "sm" | "md" | "lg";

interface LogoProps {
  size?: LogoSize;
  /** `tile` põe o símbolo em um selo cobalto; `plain` deixa o símbolo solto em azul. */
  variant?: "tile" | "plain";
  /** Só o símbolo, sem a palavra — para espaços apertados (sidebar colapsada, favicon inline). */
  markOnly?: boolean;
  /** Esconde a palavra abaixo de 420px, onde ela rouba a largura das ações do header. */
  compact?: boolean;
  className?: string;
}

export function Logo({ size = "md", variant = "tile", markOnly = false, compact = false, className }: LogoProps) {
  return (
    <span
      className={[styles.logo, styles[size], compact ? styles.compact : "", className].filter(Boolean).join(" ")}
      data-variant={variant}
    >
      <span className={styles.mark}>
        <CaraffaMark className={styles.glyph} />
      </span>
      {!markOnly && <span className={styles.wordmark}>CaraffaStore</span>}
    </span>
  );
}
