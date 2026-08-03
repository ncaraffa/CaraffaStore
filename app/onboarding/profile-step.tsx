"use client";

import { useActionState } from "react";
import { saveProfileAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

export function ProfileStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(saveProfileAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction} noValidate>
      <h2>Seus dados</h2>
      {state.status === "error" && state.message && (
        <p className="form-status" data-tone="error" role="alert">
          {state.message}
        </p>
      )}

      <div className="form-field">
        <label htmlFor="merchantName">Seu nome</label>
        <input
          id="merchantName"
          name="merchantName"
          defaultValue={progress.merchant_name ?? ""}
          required
          minLength={2}
          maxLength={120}
          aria-invalid={Boolean(state.fieldErrors?.merchantName)}
        />
        {state.fieldErrors?.merchantName && <small role="alert">{state.fieldErrors.merchantName}</small>}
      </div>

      <div className="form-field">
        <label htmlFor="whatsapp">WhatsApp</label>
        <input
          id="whatsapp"
          name="whatsapp"
          defaultValue={progress.whatsapp ?? ""}
          required
          placeholder="(11) 91234-5678"
          aria-invalid={Boolean(state.fieldErrors?.whatsapp)}
        />
        {state.fieldErrors?.whatsapp && <small role="alert">{state.fieldErrors.whatsapp}</small>}
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Continuar"}
      </button>
    </form>
  );
}
