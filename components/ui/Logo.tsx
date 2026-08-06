import styles from "./Logo.module.css";

/**
 * Marca tipográfica provisória da CaraffaStore — preparada para receber
 * um logotipo definitivo depois (o quadrado com "C" é só o selo/monograma,
 * substituível sem tocar em nenhum outro lugar da UI).
 */
export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <span className={[styles.logo, styles[size]].join(" ")}>
      <span className={styles.mark} aria-hidden="true">
        C
      </span>
      <span className={styles.wordmark}>
        Caraffa<span className={styles.storeWord}>Store</span>
      </span>
    </span>
  );
}
