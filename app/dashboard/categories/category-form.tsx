"use client";

import { useActionState, useState } from "react";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { slugify } from "@/lib/catalog/slugify";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import type { CategoryFormState } from "./actions";

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
};

export function CategoryForm({
  storeSlug,
  action,
  category,
}: {
  storeSlug: string;
  action: (prev: CategoryFormState, formData: FormData) => Promise<CategoryFormState>;
  category?: Category;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_ACTION_STATE);
  const [slugTouched, setSlugTouched] = useState(Boolean(category));
  const [slugValue, setSlugValue] = useState(category?.slug ?? "");

  return (
    <Card>
      <form action={formAction} noValidate>
        <input type="hidden" name="storeSlug" value={storeSlug} />
        {category && <input type="hidden" name="categoryId" value={category.id} />}

        {state.status === "error" && state.message && (
          <div style={{ marginBottom: "1.25rem" }}>
            <Alert tone="danger">{state.message}</Alert>
          </div>
        )}

        <Field label="Nome" htmlFor="name" required error={state.fieldErrors?.name}>
          <Input
            id="name"
            name="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={category?.name ?? ""}
            onChange={(e) => {
              if (!slugTouched) setSlugValue(slugify(e.target.value));
            }}
            aria-invalid={Boolean(state.fieldErrors?.name)}
          />
        </Field>

        <Field label="Endereço (slug)" htmlFor="slug" required error={state.fieldErrors?.slug}>
          <Input
            id="slug"
            name="slug"
            required
            maxLength={80}
            value={slugValue}
            onChange={(e) => {
              setSlugTouched(true);
              setSlugValue(e.target.value);
            }}
            aria-invalid={Boolean(state.fieldErrors?.slug)}
          />
        </Field>

        <Field label="Descrição (opcional)" htmlFor="description">
          <Textarea id="description" name="description" maxLength={2000} defaultValue={category?.description ?? ""} />
        </Field>

        <Field label="Ordem de exibição" htmlFor="displayOrder">
          <Input
            id="displayOrder"
            name="displayOrder"
            type="number"
            min={0}
            max={10000}
            defaultValue={category?.display_order ?? 0}
          />
        </Field>

        <Button type="submit" size="lg" loading={pending}>
          {category ? "Salvar alterações" : "Criar categoria"}
        </Button>
      </form>
    </Card>
  );
}
