"use client";

import { useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";
import { Modal } from "./Modal";

interface ConfirmSubmitButtonProps {
  label: ReactNode;
  confirmTitle: string;
  confirmMessage: ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}

/**
 * Botão de submit que abre uma confirmação antes de disparar a Server
 * Action do <form> pai — a lógica/rota de mutação continua exatamente a
 * mesma, isto só adiciona uma etapa de confirmação visual para ações
 * destrutivas (desativar, cancelar, excluir).
 */
export function ConfirmSubmitButton({
  label,
  confirmTitle,
  confirmMessage,
  confirmLabel = "Confirmar",
  variant = "destructive",
  size = "sm",
  disabled,
}: ConfirmSubmitButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={confirmTitle}>
        <p>{confirmMessage}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.25rem" }}>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant={variant}
            onClick={() => setOpen(false)}
          >
            {confirmLabel}
          </Button>
        </div>
      </Modal>
    </>
  );
}
