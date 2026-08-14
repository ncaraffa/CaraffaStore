"use client";

import { useActionState, useState } from "react";
import { saveSlugAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { IconLink } from "@/components/ui/icons";
import { getSiteHost, getStoreUrlExample } from "@/lib/config/site";
import styles from "./slug-step.module.css";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

/* Nada de domínio escrito à mão: sai de NEXT_PUBLIC_SITE_URL, então o
   dia em que a CaraffaStore ganhar domínio próprio esta tela acompanha
   sem edição. */
const siteHost = getSiteHost();
const storeUrlExample = getStoreUrlExample();

export function SlugStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(saveSlugAction, IDLE_ACTION_STATE);
  const [slug, setSlug] = useState(progress.slug ?? "");

  return (
    <form action={formAction} noValidate>
      <h2>Endereço da loja</h2>

      {/* Este é o link que o comerciante vai mandar para os clientes —
          mostrar o resultado enquanto ele digita torna o campo concreto
          em vez de um "slug" abstrato. */}
      <div className={styles.preview} aria-hidden="true">
        <IconLink />
        {/* O host encolhe primeiro; o pedaço que o lojista está digitando
            nunca é o cortado quando a tela é estreita. */}
        <span className={styles.previewPath}>
          <span className={styles.previewHost}>{siteHost}</span>
          <span className={styles.previewSlug}>
            /loja/<strong>{slug.trim() || "sua-loja"}</strong>
          </span>
        </span>
      </div>

      {state.status === "error" && state.message && (
        <div style={{ marginBottom: "1.25rem" }}>
          <Alert tone="danger">{state.message}</Alert>
        </div>
      )}

      <Field
        label="Endereço da loja"
        htmlFor="slug"
        required
        error={state.fieldErrors?.slug}
        hint="Só letras minúsculas, números e hífen — a gente ajusta sozinho o que estiver fora do formato. Dá para trocar até concluir o cadastro; depois disso o endereço fica fixo."
        info={`O endereço único da sua loja na internet — é o link que você vai mandar pros seus clientes no WhatsApp, no Instagram e onde mais quiser. Ex.: ${storeUrlExample}.`}
      >
        <Input
          id="slug"
          name="slug"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          required
          maxLength={80}
          aria-invalid={Boolean(state.fieldErrors?.slug)}
        />
      </Field>

      <Button type="submit" size="lg" fullWidth loading={pending}>
        Continuar
      </Button>
    </form>
  );
}
