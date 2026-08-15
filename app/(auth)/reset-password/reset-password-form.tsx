"use client";

import { useActionState, useState } from "react";
import { resetPasswordAction } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { PasswordGuide } from "@/components/auth/PasswordGuide";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "../auth-form.module.css";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, IDLE_ACTION_STATE);
  // Ver signup: só o comprimento vai para o estado, nunca a senha.
  const [passwordLength, setPasswordLength] = useState(0);

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
          hint={<PasswordGuide length={passwordLength} />}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            onChange={(event) => setPasswordLength(event.currentTarget.value.length)}
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
