"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "../auth-form.module.css";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, IDLE_ACTION_STATE);

  return (
    <>
      {state.status === "error" && state.message && (
        <div className={styles.alertGap}>
          <Alert tone="danger">{state.message}</Alert>
        </div>
      )}
      <form action={formAction} noValidate>
        <Field
          label="Nova senha"
          htmlFor="password"
          required
          error={state.fieldErrors?.password}
          hint={`Pelo menos ${MIN_PASSWORD_LENGTH} caracteres. Espaços são aceitos.`}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
        </Field>
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Definir nova senha
        </Button>
      </form>
    </>
  );
}
