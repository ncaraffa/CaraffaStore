"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconInfo } from "./icons";
import styles from "./InfoTooltip.module.css";

interface InfoTooltipProps {
  /** Texto curto explicando o campo — em linguagem simples, sem jargão. */
  children: string;
  /** Rótulo acessível do botão, ex.: "O que é o endereço (slug)?". */
  label?: string;
}

/**
 * Ícone (i) que mostra uma explicação curta do campo ao lado. Hover no
 * desktop, toque no mobile (hover não existe em touch) — por isso é tudo
 * controlado por estado em vez de :hover puro em CSS, senão o toque não
 * teria como abrir nem fechar de forma confiável.
 */
export function InfoTooltip({ children, label = "Mais informações" }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <IconInfo />
      </button>
      {open && (
        <span role="tooltip" id={tooltipId} className={styles.bubble}>
          {children}
        </span>
      )}
    </span>
  );
}
