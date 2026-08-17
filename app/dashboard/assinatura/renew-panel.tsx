"use client";

import { useState } from "react";
import type { PlanCode } from "@/lib/supabase/types";
import { Button } from "@/components/ui/Button";
import { IconRotate } from "@/components/ui/icons";
import { RenewForm } from "./renew-form";
import styles from "./subscription.module.css";

/**
 * O formulário de renovação fica atrás de um clique de propósito: no dia a
 * dia esta tela é consultada ("até quando estou pago?"), não usada para
 * pagar. Deixar o formulário sempre aberto empurraria a informação que o
 * lojista veio buscar para baixo da dobra.
 *
 * A exceção é quando a assinatura está vencendo ou já venceu — aí a ação
 * É o assunto da tela, e `defaultOpen` abre o formulário direto, sem o
 * clique intermediário.
 */
export function RenewPanel({
  storeSlug,
  currentPlanCode,
  defaultEmail,
  defaultOpen = false,
  ctaLabel = "Renovar assinatura",
}: {
  storeSlug: string;
  currentPlanCode: PlanCode | null;
  defaultEmail: string;
  defaultOpen?: boolean;
  ctaLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!open) {
    return (
      <div className={styles.renewCta}>
        <Button type="button" size="lg" icon={<IconRotate />} onClick={() => setOpen(true)}>
          {ctaLabel}
        </Button>
        <p className={styles.renewCtaHint}>
          Você escolhe o plano na próxima etapa e paga por Pix. Sua loja continua exatamente como está.
        </p>
      </div>
    );
  }

  return (
    <RenewForm
      storeSlug={storeSlug}
      currentPlanCode={currentPlanCode}
      defaultEmail={defaultEmail}
      onCancel={defaultOpen ? undefined : () => setOpen(false)}
    />
  );
}
