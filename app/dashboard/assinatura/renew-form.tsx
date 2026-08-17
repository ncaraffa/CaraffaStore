"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { renewSubscriptionAction, type RenewSubscriptionState } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { PLATFORM_PLANS } from "@/lib/billing/plans";
import type { PlanCode } from "@/lib/supabase/types";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { IconCheck, IconShield } from "@/components/ui/icons";
import styles from "./subscription.module.css";

/**
 * Renovação em um passo só: escolher o plano e pagar acontecem no mesmo
 * formulário, em vez de uma tela de escolha seguida de outra de
 * pagamento. O lojista já é cliente — o que ele precisa decidir ("continuo
 * ou mudo de faixa?") cabe ao lado do que ele precisa digitar, e o plano
 * atual já vem selecionado, então "só renovar" é um clique.
 *
 * O e-mail vem preenchido da conta logada. O CPF/CNPJ não vem, e isso é
 * proposital: o sistema guarda só os 4 últimos dígitos do documento
 * (billing_charges.payer_doc_last4, 0008_saas_billing.sql) — nunca o
 * número inteiro. Preencher esse campo sozinho exigiria passar a guardar
 * um dado sensível que hoje não é guardado; digitar de novo é o preço de
 * não armazenar CPF completo, e o texto de apoio diz isso ao lojista em
 * vez de deixar parecer um esquecimento do produto.
 */
export function RenewForm({
  storeSlug,
  currentPlanCode,
  defaultEmail,
  onCancel,
}: {
  storeSlug: string;
  currentPlanCode: PlanCode | null;
  defaultEmail: string;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    renewSubscriptionAction,
    IDLE_ACTION_STATE as RenewSubscriptionState,
  );
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>(currentPlanCode ?? 30);

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [state, router]);

  const selected = PLATFORM_PLANS.find((plan) => plan.code === selectedPlan);

  return (
    <Card>
      <form action={formAction} noValidate>
        <input type="hidden" name="storeSlug" value={storeSlug} />

        {state.status === "error" && state.message && (
          <div className={styles.alertGap}>
            <Alert tone="danger">{state.message}</Alert>
          </div>
        )}

        <fieldset className={styles.planFieldset}>
          <legend className={styles.planLegend}>Plano da renovação</legend>
          <p className={styles.planHint}>
            Os três dão acesso a todos os recursos, sem limite de produtos ou pedidos — o que muda é o nível de
            acompanhamento. Você pode continuar no mesmo plano, subir ou descer de faixa.
          </p>

          <div className={styles.planGrid}>
            {PLATFORM_PLANS.map((plan) => {
              const isCurrent = plan.code === currentPlanCode;
              return (
                <label key={plan.code} className={styles.planOption} data-selected={plan.code === selectedPlan || undefined}>
                  <input
                    type="radio"
                    name="planCode"
                    value={plan.code}
                    checked={plan.code === selectedPlan}
                    onChange={() => setSelectedPlan(plan.code)}
                    className={styles.planRadio}
                  />
                  {isCurrent && <span className={styles.planBadge}>Plano atual</span>}
                  <span className={styles.planLevel} aria-hidden="true">
                    <span data-on={plan.tier >= 1 || undefined} />
                    <span data-on={plan.tier >= 2 || undefined} />
                    <span data-on={plan.tier >= 3 || undefined} />
                  </span>
                  <span className={styles.planName}>{plan.label}</span>
                  <span className={styles.planPrice}>
                    <span className={styles.planCurrency}>R$</span>
                    {plan.price}
                    <span className={styles.planPeriod}>/mês</span>
                  </span>
                  <span className={styles.planCheck} aria-hidden="true">
                    <IconCheck />
                  </span>
                </label>
              );
            })}
          </div>
          {state.fieldErrors?.planCode && <p className={styles.fieldError}>{state.fieldErrors.planCode}</p>}
        </fieldset>

        <Field label="E-mail" htmlFor="payerEmail" required error={state.fieldErrors?.payerEmail}>
          <Input
            id="payerEmail"
            name="payerEmail"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            defaultValue={defaultEmail}
            aria-invalid={Boolean(state.fieldErrors?.payerEmail)}
          />
        </Field>

        <Field
          label="CPF ou CNPJ"
          htmlFor="payerDocument"
          required
          error={state.fieldErrors?.payerDocument}
          hint="Pedimos de novo porque o número completo nunca fica guardado — só os 4 últimos dígitos, para conferência."
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
          {selected ? `Gerar Pix de R$ ${selected.price}` : "Gerar cobrança Pix"}
        </Button>

        {onCancel && (
          <Button type="button" variant="ghost" fullWidth onClick={onCancel}>
            Cancelar
          </Button>
        )}

        <p className={styles.trustLine}>
          <IconShield />
          Pagamento processado com segurança pelo Mercado Pago
        </p>
      </form>
    </Card>
  );
}
