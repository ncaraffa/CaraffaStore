import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./FormControls.module.css";

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={[styles.checkboxRow, className ?? ""].filter(Boolean).join(" ")}>
      <input type="checkbox" className={styles.checkbox} {...rest} />
      {label}
    </label>
  );
}
