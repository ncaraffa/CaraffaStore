"use client";

import { useActionState } from "react";
import { savePlanAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

const PLANS = [
  { code: 30, label: "R$ 30/mês" },
  { code: 50, label: "R$ 50/mês" },
  { code: 80, label: "R$ 80/mês" },
] as const;

export function PlanStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(savePlanAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction} noValidate>
      <h2>Escolha um plano</h2>
      <p className="form-hint">
        Só o registro da escolha inicial — sem cobrança nesta etapa. Benefícios e cobrança real
        chegam em uma etapa futura.
      </p>
      {state.status === "error" && state.message && (
        <p className="form-status" data-tone="error" role="alert">
          {state.message}
        </p>
      )}

      <fieldset className="form-field">
        <legend>Plano</legend>
        {PLANS.map((plan) => (
          <label key={plan.code} style={{ display: "flex", gap: "0.5rem", fontWeight: 400 }}>
            <input
              type="radio"
              name="planCode"
              value={plan.code}
              defaultChecked={progress.plan_code === plan.code}
              required
            />
            {plan.label}
          </label>
        ))}
        {state.fieldErrors?.planCode && <small role="alert">{state.fieldErrors.planCode}</small>}
      </fieldset>

      <button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Continuar"}
      </button>
    </form>
  );
}
