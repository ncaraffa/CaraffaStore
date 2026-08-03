"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";

export function LoginForm({ next, linkError }: { next: string; linkError?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, IDLE_ACTION_STATE);
  const message = state.status === "error" ? state.message : undefined;

  return (
    <>
      <h1>Entrar</h1>

      {!message && linkError && (
        <p className="form-status" data-tone="error" role="alert">
          {linkError}
        </p>
      )}
      {message && (
        <p className="form-status" data-tone="error" role="alert">
          {message}
        </p>
      )}

      <form action={formAction} noValidate>
        <input type="hidden" name="next" value={next} />

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

        <div className="form-field">
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
          {state.fieldErrors?.password && <small role="alert">{state.fieldErrors.password}</small>}
        </div>

        <button type="submit" disabled={pending}>
          {pending ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <p className="auth-links">
        <Link href="/signup">Criar conta</Link>
        <Link href="/forgot-password">Esqueci minha senha</Link>
      </p>
    </>
  );
}
