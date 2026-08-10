"use client";

import { useActionState } from "react";
import { savePlanAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";
import { PLATFORM_PLANS as PLANS } from "@/lib/billing/plans";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { IconCheck } from "@/components/ui/icons";
import styles from "./plan-step.module.css";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

export function PlanStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(savePlanAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction} noValidate>
      <h2>Escolha um plano</h2>
      <p className={styles.hint}>
        Só o registro da escolha inicial — sem cobrança nesta etapa. Você pode revisar isso depois com o suporte.
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
            <label key={plan.code} className={styles.option} data-featured={plan.featured || undefined}>
              {plan.featured && <span className={styles.badge}>Recomendado</span>}
              <input
                type="radio"
                name="planCode"
                value={plan.code}
                defaultChecked={progress.plan_code === plan.code}
                required
                className={styles.radio}
              />
              <span className={styles.level} aria-hidden="true">
                <span data-on={plan.tier >= 1 || undefined} />
                <span data-on={plan.tier >= 2 || undefined} />
                <span data-on={plan.tier >= 3 || undefined} />
              </span>
              <span className={styles.optionName}>{plan.label}</span>
              <span className={styles.optionPrice}>
                <span className={styles.currency}>R$</span>
                {plan.price}
                <span className={styles.period}>/mês</span>
              </span>
              <span className={styles.checkBadge} aria-hidden="true">
                <IconCheck />
              </span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.planCode && <p className={styles.error}>{state.fieldErrors.planCode}</p>}
      </fieldset>

      <Button type="submit" size="lg" fullWidth loading={pending}>
        Continuar
      </Button>
    </form>
  );
}
