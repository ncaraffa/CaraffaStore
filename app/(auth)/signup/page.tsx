"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signupAction } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { PasswordGuide } from "@/components/auth/PasswordGuide";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "../auth-form.module.css";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, IDLE_ACTION_STATE);
  // Só o comprimento — a senha em si nunca é guardada em estado.
  const [passwordLength, setPasswordLength] = useState(0);

  return (
    <>
      <h1>Criar conta na CaraffaStore</h1>
      <p className={styles.subtitle}>
        E-mail e senha, confirmação por e-mail e pronto. Sem cartão de crédito nesta etapa.
      </p>

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

          <Field
            label="Senha"
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

          {/* Preenchido por um widget de CAPTCHA real quando ativado
              (CAPTCHA_ENABLED=true); sem efeito no dev local. */}
          <input type="hidden" name="captchaToken" value="" />

          <Button type="submit" size="lg" fullWidth loading={pending}>
            Criar conta
          </Button>
        </form>
      )}

      <p className={styles.links}>
        <Link href="/login">Já tenho conta</Link>
      </p>
    </>
  );
}
