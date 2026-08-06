"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "../auth-form.module.css";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, IDLE_ACTION_STATE);

  return (
    <>
      <h1>Recuperar senha</h1>
      <p className={styles.subtitle}>Enviamos um link de redefinição para o e-mail cadastrado.</p>

      {state.status === "success" && state.message && (
        <div className={styles.alertGap}>
          <Alert tone="success">{state.message}</Alert>
        </div>
      )}
      {state.status === "error" && state.message && (
        <div className={styles.alertGap}>
          <Alert tone="danger">{state.message}</Alert>
        </div>
      )}

      {state.status !== "success" && (
        <form action={formAction} noValidate>
          <Field label="E-mail" htmlFor="email" required error={state.fieldErrors?.email}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(state.fieldErrors?.email)}
            />
          </Field>

          <input type="hidden" name="captchaToken" value="" />

          <Button type="submit" fullWidth loading={pending}>
            Enviar instruções
          </Button>
        </form>
      )}

      <p className={styles.links}>
        <Link href="/login">Voltar para login</Link>
      </p>
    </>
  );
}
