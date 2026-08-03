"use client";

import { useActionState } from "react";
import { saveSlugAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

export function SlugStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(saveSlugAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction} noValidate>
      <h2>Endereço da loja</h2>
      {state.status === "error" && state.message && (
        <p className="form-status" data-tone="error" role="alert">
          {state.message}
        </p>
      )}

      <div className="form-field">
        <label htmlFor="slug">Endereço (slug)</label>
        <input
          id="slug"
          name="slug"
          defaultValue={progress.slug ?? ""}
          required
          maxLength={80}
          aria-invalid={Boolean(state.fieldErrors?.slug)}
          aria-describedby="slug-hint"
        />
        <small id="slug-hint">
          Só letras minúsculas, números e hífen. É normalizado automaticamente e pode ser
          alterado até você concluir o cadastro — depois disso fica bloqueado.
        </small>
        {state.fieldErrors?.slug && <small role="alert">{state.fieldErrors.slug}</small>}
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Verificando..." : "Continuar"}
      </button>
    </form>
  );
}
