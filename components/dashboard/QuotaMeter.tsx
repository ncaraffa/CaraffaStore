import { isNearLimit } from "@/lib/billing/quota-messages";
import styles from "./quota-meter.module.css";

/**
 * Indicador discreto de uso vs. limite — "Produtos 42 / 75" (seção 35 do
 * TASK-012). Não é dashboard: é uma linha, com um aviso suave quando o
 * lojista se aproxima do limite e um estado claro quando ele já chegou.
 *
 * Puramente informativo. Esconder ou mostrar isto não muda nada do que o
 * servidor permite.
 */
export function QuotaMeter({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const full = used >= limit;
  const near = isNearLimit(used, limit);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  const tone = full ? styles.full : near ? styles.near : styles.ok;

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={`${styles.value} ${tone}`}>
          {used.toLocaleString("pt-BR")} / {limit.toLocaleString("pt-BR")}
        </span>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${label}: ${used} de ${limit}`}
      >
        <div className={`${styles.fill} ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
