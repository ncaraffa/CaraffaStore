"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBillingChargeAction, type BillingChargeState } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { IconShield } from "@/components/ui/icons";
import styles from "./pending-payment.module.css";

/**
 * Coleta os dados que faltam para gerar o Pix da assinatura (onboarding
 * não pede CPF/CNPJ) e dispara createBillingChargeAction. Em sucesso, só
 * pede um router.refresh() — a própria Server Action já criou/reaproveitou
 * a cobrança no banco; a página busca a cobrança atual de novo e passa a
 * mostrar o QR (BillingStatusClient), sem navegação para outra URL.
 */
export function BillingForm({ storeSlug }: { storeSlug: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createBillingChargeAction, IDLE_ACTION_STATE as BillingChargeState);

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [state, router]);

  return (
    <Card>
      <form action={formAction} noValidate>
        <input type="hidden" name="storeSlug" value={storeSlug} />

        {state.status === "error" && state.message && (
          <div className={styles.alertGap}>
            <Alert tone="danger">{state.message}</Alert>
          </div>
        )}

        <Field label="E-mail" htmlFor="payerEmail" required error={state.fieldErrors?.payerEmail}>
          <Input
            id="payerEmail"
            name="payerEmail"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            placeholder="voce@example.com"
            aria-invalid={Boolean(state.fieldErrors?.payerEmail)}
          />
        </Field>

        <Field
          label="CPF ou CNPJ"
          htmlFor="payerDocument"
          required
          error={state.fieldErrors?.payerDocument}
          hint="Usado só para processar o Pix da assinatura — o número completo não fica guardado."
        >
          <Input
            id="payerDocument"
            name="payerDocument"
            required
            inputMode="numeric"
            maxLength={20}
            placeholder="000.000.000-00"
            aria-invalid={Boolean(state.fieldErrors?.payerDocument)}
          />
        </Field>

        <Button type="submit" size="lg" fullWidth loading={pending}>
          Gerar cobrança Pix
        </Button>

        <p className={styles.trustLine}>
          <IconShield />
          Pagamento processado com segurança pelo Mercado Pago
        </p>
      </form>
    </Card>
  );
}
