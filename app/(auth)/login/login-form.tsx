"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "../auth-form.module.css";

export function LoginForm({ next, linkError }: { next: string; linkError?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, IDLE_ACTION_STATE);
  const message = state.status === "error" ? state.message : undefined;

  return (
    <>
      <h1>Entrar</h1>
      <p className={styles.subtitle}>Acesse o painel da sua loja na CaraffaStore.</p>

      {!message && linkError && (
        <div className={styles.alertGap}>
          <Alert tone="danger">{linkError}</Alert>
        </div>
      )}
      {message && (
        <div className={styles.alertGap}>
          <Alert tone="danger">{message}</Alert>
        </div>
      )}

      <form action={formAction} noValidate>
        <input type="hidden" name="next" value={next} />

        <Field label="E-mail" htmlFor="email" required error={state.fieldErrors?.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(state.fieldErrors?.email)} />
        </Field>

        <Field label="Senha" htmlFor="password" required error={state.fieldErrors?.password}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
        </Field>

        <Button type="submit" fullWidth loading={pending}>
          Entrar
        </Button>
      </form>

      <p className={styles.links}>
        <Link href="/signup">Criar conta</Link>
        <Link href="/forgot-password">Esqueci minha senha</Link>
      </p>
    </>
  );
}
