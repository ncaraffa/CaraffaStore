"use client";

import { useActionState } from "react";
import { takeoverSessionAction, type TakeoverState } from "./actions";
import { Alert } from "@/components/ui/Alert";
import styles from "./session-conflict.module.css";

const INITIAL: TakeoverState = { status: "idle" };

export function TakeoverForm({ storeSlug }: { storeSlug: string }) {
  const [state, formAction, pending] = useActionState(takeoverSessionAction, INITIAL);

  return (
    <form action={formAction} className={styles.form}>
      {state.message && <Alert tone="danger">{state.message}</Alert>}
      <input type="hidden" name="store" value={storeSlug} />
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? "Entrando…" : "Encerrar a outra sessão e entrar aqui"}
      </button>
    </form>
  );
}
