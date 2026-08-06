import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./FormControls.module.css";

interface SwitchProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
}

export function Switch({ label, className, ...rest }: SwitchProps) {
  return (
    <label className={[styles.switch, className ?? ""].filter(Boolean).join(" ")}>
      <input type="checkbox" role="switch" className={styles.switchInput} {...rest} />
      <span className={styles.switchTrack}>
        <span className={styles.switchThumb} />
      </span>
      {label}
    </label>
  );
}
