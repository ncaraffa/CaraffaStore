"use client";

import { useActionState } from "react";
import { saveStoreNameAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

export function StoreNameStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(saveStoreNameAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction} noValidate>
      <h2>Nome da loja</h2>
      {state.status === "error" && state.message && (
        <div style={{ marginBottom: "1.25rem" }}>
          <Alert tone="danger">{state.message}</Alert>
        </div>
      )}

      <Field label="Nome da loja" htmlFor="storeName" required error={state.fieldErrors?.storeName}>
        <Input
          id="storeName"
          name="storeName"
          defaultValue={progress.store_name ?? ""}
          required
          minLength={2}
          maxLength={120}
          aria-invalid={Boolean(state.fieldErrors?.storeName)}
        />
      </Field>

      <Button type="submit" size="lg" fullWidth loading={pending}>
        Continuar
      </Button>
    </form>
  );
}
