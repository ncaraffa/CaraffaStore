"use client";

import { useActionState, useState } from "react";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { slugify } from "@/lib/catalog/slugify";
import type { ProductFormState } from "./actions";

type Category = { id: string; name: string };

type Product = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  price_cents: number;
  sku: string | null;
  category_id: string | null;
  stock: number;
};

function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function ProductForm({
  storeSlug,
  action,
  categories,
  product,
}: {
  storeSlug: string;
  action: (prev: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  categories: Category[];
  product?: Product;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_ACTION_STATE);
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const [slugValue, setSlugValue] = useState(product?.slug ?? "");

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="storeSlug" value={storeSlug} />
      {product && <input type="hidden" name="productId" value={product.id} />}

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
          maxLength={200}
          defaultValue={product?.name ?? ""}
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
          maxLength={120}
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
        <textarea id="description" name="description" maxLength={4000} defaultValue={product?.description ?? ""} />
      </div>

      <div className="form-field">
        <label htmlFor="price">Preço (R$)</label>
        <input
          id="price"
          name="price"
          inputMode="decimal"
          required
          defaultValue={product ? centsToInputValue(product.price_cents) : ""}
          placeholder="19,90"
          aria-invalid={Boolean(state.fieldErrors?.priceCents)}
        />
        {state.fieldErrors?.priceCents && <small role="alert">{state.fieldErrors.priceCents}</small>}
      </div>

      <div className="form-field">
        <label htmlFor="sku">SKU (opcional)</label>
        <input id="sku" name="sku" maxLength={64} defaultValue={product?.sku ?? ""} />
      </div>

      <div className="form-field">
        <label htmlFor="categoryId">Categoria (opcional)</label>
        <select id="categoryId" name="categoryId" defaultValue={product?.category_id ?? ""}>
          <option value="">Sem categoria</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      {!product && (
        <div className="form-field">
          <label htmlFor="stock">Estoque inicial</label>
          <input
            id="stock"
            name="stock"
            type="number"
            min={0}
            required
            defaultValue={0}
            aria-invalid={Boolean(state.fieldErrors?.stock)}
          />
          {state.fieldErrors?.stock && <small role="alert">{state.fieldErrors.stock}</small>}
          <small>Depois de criado, ajustes de estoque ficam numa seção própria (com motivo registrado).</small>
        </div>
      )}

      <button type="submit" disabled={pending}>
        {pending ? "Salvando..." : product ? "Salvar alterações" : "Criar produto"}
      </button>
    </form>
  );
}
