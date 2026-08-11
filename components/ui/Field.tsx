import type { ReactNode } from "react";
import { InfoTooltip } from "./InfoTooltip";
import styles from "./Field.module.css";

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Explicação curta em linguagem simples do que este campo significa —
   * mostrada num ícone (i) ao lado do rótulo, pro cliente leigo nunca
   * precisar sair do site pra pesquisar o que está preenchendo. */
  info?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, info, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={styles.label}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            {" "}
            *
          </span>
        )}
        {info && <InfoTooltip label={`O que significa "${label}"?`}>{info}</InfoTooltip>}
      </label>
      {children}
      {hint && !error && <p className={styles.hint}>{hint}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
