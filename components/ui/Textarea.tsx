import { forwardRef, type TextareaHTMLAttributes } from "react";
import styles from "./FormControls.module.css";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={[styles.control, className ?? ""].filter(Boolean).join(" ")} {...rest} />;
  },
);
