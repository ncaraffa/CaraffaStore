"use client";

import { useActionState } from "react";
import { resendVerificationAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "../auth-form.module.css";

export function ResendForm() {
  const [state, formAction, pending] = useActionState(resendVerificationAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction}>
      {state.status !== "idle" && state.message && (
        <div className={styles.alertGap}>
          <Alert tone={state.status === "error" ? "danger" : "success"}>{state.message}</Alert>
        </div>
      )}
      <Button type="submit" variant="outline" loading={pending}>
        Reenviar confirmação
      </Button>
    </form>
  );
}
