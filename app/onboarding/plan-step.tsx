"use client";

import { useActionState } from "react";
import { savePlanAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "./plan-step.module.css";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

const PLANS = [
  { code: 30, label: "Essencial" },
  { code: 50, label: "Profissional" },
  { code: 80, label: "Avançado" },
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
              <span className={styles.optionPrice}>R$ {plan.code}/mês</span>
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
