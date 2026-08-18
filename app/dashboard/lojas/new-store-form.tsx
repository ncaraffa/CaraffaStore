"use client";

import { useActionState } from "react";
import { createStoreAction, type CreateStoreState } from "./actions";
import { Alert } from "@/components/ui/Alert";
import styles from "@/app/dashboard/dashboard-form.module.css";

const INITIAL: CreateStoreState = { status: "idle" };

export function NewStoreForm() {
  const [state, formAction, pending] = useActionState(createStoreAction, INITIAL);

  if (state.status === "success") {
    return (
      <Alert tone="success">
        Loja <strong>{state.createdSlug}</strong> criada. Ela já está coberta pela sua assinatura atual — nenhuma
        cobrança nova foi gerada.
      </Alert>
    );
  }

  return (
    <form action={formAction} className={styles.form}>
      {state.message && <Alert tone="danger">{state.message}</Alert>}

      <div className={styles.field}>
        <label htmlFor="new-store-name" className={styles.label}>
          Nome da loja
        </label>
        <input
          id="new-store-name"
          name="name"
          type="text"
          required
          maxLength={120}
          autoComplete="off"
          className={styles.input}
          aria-describedby={state.fieldErrors?.name ? "new-store-name-error" : undefined}
        />
        {state.fieldErrors?.name && (
          <p id="new-store-name-error" className={styles.fieldError}>
            {state.fieldErrors.name}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="new-store-slug" className={styles.label}>
          Endereço da loja
        </label>
        <input
          id="new-store-slug"
          name="slug"
          type="text"
          required
          maxLength={120}
          autoComplete="off"
          inputMode="url"
          placeholder="minha-segunda-loja"
          className={styles.input}
          aria-describedby={state.fieldErrors?.slug ? "new-store-slug-error" : undefined}
        />
        {state.fieldErrors?.slug && (
          <p id="new-store-slug-error" className={styles.fieldError}>
            {state.fieldErrors.slug}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="new-store-whatsapp" className={styles.label}>
          WhatsApp <span className={styles.optional}>(opcional)</span>
        </label>
        <input
          id="new-store-whatsapp"
          name="whatsapp"
          type="tel"
          maxLength={20}
          autoComplete="off"
          inputMode="tel"
          className={styles.input}
        />
      </div>

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? "Criando…" : "Criar loja"}
      </button>
    </form>
  );
}
