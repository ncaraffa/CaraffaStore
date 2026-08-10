import { forwardRef, type InputHTMLAttributes } from "react";
import styles from "./FormControls.module.css";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={[styles.control, className ?? ""].filter(Boolean).join(" ")} {...rest} />;
});
