"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, IDLE_ACTION_STATE);

  return (
    <>
      <h1>Recuperar senha</h1>

      {state.status === "success" && state.message && (
        <p className="form-status" data-tone="success" role="status">
          {state.message}
        </p>
      )}
      {state.status === "error" && state.message && (
        <p className="form-status" data-tone="error" role="alert">
          {state.message}
        </p>
      )}

      {state.status !== "success" && (
        <form action={formAction} noValidate>
          <div className="form-field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(state.fieldErrors?.email)}
            />
            {state.fieldErrors?.email && <small role="alert">{state.fieldErrors.email}</small>}
          </div>

          <input type="hidden" name="captchaToken" value="" />

          <button type="submit" disabled={pending}>
            {pending ? "Enviando..." : "Enviar instruções"}
          </button>
        </form>
      )}

      <p className="auth-links">
        <Link href="/login">Voltar para login</Link>
      </p>
    </>
  );
}
