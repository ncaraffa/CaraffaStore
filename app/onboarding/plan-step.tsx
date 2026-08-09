"use client";

import { useActionState } from "react";
import { savePlanAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "./plan-step.module.css";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

/**
 * `code` é o identificador técnico gravado em `plan_code`, travado por
 * CHECK constraint em `in (30, 50, 80)` (supabase/migrations/0002_auth_
 * onboarding.sql) — nunca renomeie nem troque esses três números sem uma
 * migration. `price` é só o texto comercial exibido: o Profissional
 * (código 80) foi reprecificado para R$ 70 sem alterar o código interno,
 * exatamente para não exigir migration nesta rodada. Ver docs/PLANS-SPEC.md.
 */
const PLANS = [
  { code: 30, label: "Essencial", price: 30 },
  { code: 50, label: "Crescimento", price: 50 },
  { code: 80, label: "Profissional", price: 70 },
] as const;

export function PlanStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(savePlanAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction} noValidate>
      <h2>Escolha um plano</h2>
      <p className={styles.hint}>
        Só o registro da escolha inicial — sem cobrança nesta etapa. Benefícios e cobrança real chegam em uma etapa
        futura.
      </p>
      {state.status === "error" && state.message && (
        <div style={{ marginBottom: "1.25rem" }}>
          <Alert tone="danger">{state.message}</Alert>
        </div>
      )}

      <fieldset className={styles.fieldset}>
        <legend className="visually-hidden">Plano</legend>
        <div className={styles.grid}>
          {PLANS.map((plan) => (
            <label key={plan.code} className={styles.option}>
              <input type="radio" name="planCode" value={plan.code} defaultChecked={progress.plan_code === plan.code} required />
              <span className={styles.optionName}>{plan.label}</span>
              <span className={styles.optionPrice}>R$ {plan.price}/mês</span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.planCode && <p className={styles.error}>{state.fieldErrors.planCode}</p>}
      </fieldset>

      <Button type="submit" loading={pending}>
        Continuar
      </Button>
    </form>
  );
}
