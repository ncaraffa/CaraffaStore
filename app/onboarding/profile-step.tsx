"use client";

import { useActionState } from "react";
import { saveProfileAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

export function ProfileStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(saveProfileAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction} noValidate>
      <h2>Seus dados</h2>
      {state.status === "error" && state.message && (
        <div style={{ marginBottom: "1.25rem" }}>
          <Alert tone="danger">{state.message}</Alert>
        </div>
      )}

      <Field label="Seu nome" htmlFor="merchantName" required error={state.fieldErrors?.merchantName}>
        <Input
          id="merchantName"
          name="merchantName"
          defaultValue={progress.merchant_name ?? ""}
          required
          minLength={2}
          maxLength={120}
          aria-invalid={Boolean(state.fieldErrors?.merchantName)}
        />
      </Field>

      <Field label="WhatsApp" htmlFor="whatsapp" required error={state.fieldErrors?.whatsapp}>
        <Input
          id="whatsapp"
          name="whatsapp"
          defaultValue={progress.whatsapp ?? ""}
          required
          placeholder="(11) 91234-5678"
          aria-invalid={Boolean(state.fieldErrors?.whatsapp)}
        />
      </Field>

      <Button type="submit" size="lg" fullWidth loading={pending}>
        Continuar
      </Button>
    </form>
  );
}
