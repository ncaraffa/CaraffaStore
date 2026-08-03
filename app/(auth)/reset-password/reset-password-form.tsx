"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, IDLE_ACTION_STATE);

  return (
    <>
      {state.status === "error" && state.message && (
        <p className="form-status" data-tone="error" role="alert">
          {state.message}
        </p>
      )}
      <form action={formAction} noValidate>
        <div className="form-field">
          <label htmlFor="password">Nova senha</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            aria-invalid={Boolean(state.fieldErrors?.password)}
            aria-describedby="password-hint"
          />
          <small id="password-hint">Pelo menos {MIN_PASSWORD_LENGTH} caracteres. Espaços são aceitos.</small>
          {state.fieldErrors?.password && <small role="alert">{state.fieldErrors.password}</small>}
        </div>
        <button type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Definir nova senha"}
        </button>
      </form>
    </>
  );
}
