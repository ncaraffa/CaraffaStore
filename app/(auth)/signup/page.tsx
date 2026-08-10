"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "../auth-form.module.css";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, IDLE_ACTION_STATE);

  return (
    <>
      <h1>Criar conta na CaraffaStore</h1>
      <p className={styles.subtitle}>Comece a vender online em poucos minutos.</p>

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
            hint={`Pelo menos ${MIN_PASSWORD_LENGTH} caracteres. Frases com espaços são aceitas; não é obrigatório usar maiúsculas, números ou símbolos.`}
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
