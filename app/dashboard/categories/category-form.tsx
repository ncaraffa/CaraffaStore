"use client";

import { useActionState, useState } from "react";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { slugify } from "@/lib/catalog/slugify";
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
    <form action={formAction} noValidate>
      <input type="hidden" name="storeSlug" value={storeSlug} />
      {category && <input type="hidden" name="categoryId" value={category.id} />}

      {state.status === "error" && state.message && (
        <p className="form-status" data-tone="error" role="alert">
          {state.message}
        </p>
      )}

      <div className="form-field">
        <label htmlFor="name">Nome</label>
        <input
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
        {state.fieldErrors?.name && <small role="alert">{state.fieldErrors.name}</small>}
      </div>

      <div className="form-field">
        <label htmlFor="slug">Endereço (slug)</label>
        <input
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
        {state.fieldErrors?.slug && <small role="alert">{state.fieldErrors.slug}</small>}
      </div>

      <div className="form-field">
        <label htmlFor="description">Descrição (opcional)</label>
        <textarea id="description" name="description" maxLength={2000} defaultValue={category?.description ?? ""} />
      </div>

      <div className="form-field">
        <label htmlFor="displayOrder">Ordem de exibição</label>
        <input
          id="displayOrder"
          name="displayOrder"
          type="number"
          min={0}
          max={10000}
          defaultValue={category?.display_order ?? 0}
        />
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Salvando..." : category ? "Salvar alterações" : "Criar categoria"}
      </button>
    </form>
  );
}
