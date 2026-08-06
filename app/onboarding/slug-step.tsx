"use client";

import { useActionState } from "react";
import { saveSlugAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

export function SlugStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(saveSlugAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction} noValidate>
      <h2>Endereço da loja</h2>
      {state.status === "error" && state.message && (
        <div style={{ marginBottom: "1.25rem" }}>
          <Alert tone="danger">{state.message}</Alert>
        </div>
      )}

      <Field
        label="Endereço (slug)"
        htmlFor="slug"
        required
        error={state.fieldErrors?.slug}
        hint="Só letras minúsculas, números e hífen. É normalizado automaticamente e pode ser alterado até você concluir o cadastro — depois disso fica bloqueado."
      >
        <Input
          id="slug"
          name="slug"
          defaultValue={progress.slug ?? ""}
          required
          maxLength={80}
          aria-invalid={Boolean(state.fieldErrors?.slug)}
        />
      </Field>

      <Button type="submit" loading={pending}>
        Continuar
      </Button>
    </form>
  );
}
