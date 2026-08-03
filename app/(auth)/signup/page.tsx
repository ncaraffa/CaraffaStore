"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, IDLE_ACTION_STATE);

  return (
    <>
      <h1>Criar conta</h1>

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
              aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
            />
            {state.fieldErrors?.email && (
              <small id="email-error" role="alert">
                {state.fieldErrors.email}
              </small>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="password">Senha</label>
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
            <small id="password-hint">
              Pelo menos {MIN_PASSWORD_LENGTH} caracteres. Frases com espaços são aceitas; não é
              obrigatório usar maiúsculas, números ou símbolos.
            </small>
            {state.fieldErrors?.password && (
              <small role="alert">{state.fieldErrors.password}</small>
            )}
          </div>

          {/* Preenchido por um widget de CAPTCHA real quando ativado
              (CAPTCHA_ENABLED=true); sem efeito no dev local. */}
          <input type="hidden" name="captchaToken" value="" />

          <button type="submit" disabled={pending}>
            {pending ? "Criando conta..." : "Criar conta"}
          </button>
        </form>
      )}

      <p className="auth-links">
        <Link href="/login">Já tenho conta</Link>
      </p>
    </>
  );
}
