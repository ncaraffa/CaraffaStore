import styles from "./Skeleton.module.css";

export function Skeleton({ width, height = "1rem" }: { width?: string; height?: string }) {
  return <span className={styles.skeleton} style={{ width: width ?? "100%", height }} aria-hidden="true" />;
}

export function Spinner({ size = "1.25rem" }: { size?: string }) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Carregando"
    />
  );
}
