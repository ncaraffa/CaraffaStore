"use client";

import { useActionState } from "react";
import { saveStoreNameAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

export function StoreNameStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(saveStoreNameAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction} noValidate>
      <h2>Nome da loja</h2>
      {state.status === "error" && state.message && (
        <p className="form-status" data-tone="error" role="alert">
          {state.message}
        </p>
      )}

      <div className="form-field">
        <label htmlFor="storeName">Nome da loja</label>
        <input
          id="storeName"
          name="storeName"
          defaultValue={progress.store_name ?? ""}
          required
          minLength={2}
          maxLength={120}
          aria-invalid={Boolean(state.fieldErrors?.storeName)}
        />
        {state.fieldErrors?.storeName && <small role="alert">{state.fieldErrors.storeName}</small>}
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Continuar"}
      </button>
    </form>
  );
}
