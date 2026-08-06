"use client";

import { useActionState, useState } from "react";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { slugify } from "@/lib/catalog/slugify";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
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
    <Card>
      <form action={formAction} noValidate>
        <input type="hidden" name="storeSlug" value={storeSlug} />
        {product && <input type="hidden" name="productId" value={product.id} />}

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
            maxLength={200}
            defaultValue={product?.name ?? ""}
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
            maxLength={120}
            value={slugValue}
            onChange={(e) => {
              setSlugTouched(true);
              setSlugValue(e.target.value);
            }}
            aria-invalid={Boolean(state.fieldErrors?.slug)}
          />
        </Field>

        <Field label="Descrição (opcional)" htmlFor="description">
          <Textarea id="description" name="description" maxLength={4000} defaultValue={product?.description ?? ""} />
        </Field>

        <Field label="Preço (R$)" htmlFor="price" required error={state.fieldErrors?.priceCents}>
          <Input
            id="price"
            name="price"
            inputMode="decimal"
            required
            defaultValue={product ? centsToInputValue(product.price_cents) : ""}
            placeholder="19,90"
            aria-invalid={Boolean(state.fieldErrors?.priceCents)}
          />
        </Field>

        <Field label="SKU (opcional)" htmlFor="sku">
          <Input id="sku" name="sku" maxLength={64} defaultValue={product?.sku ?? ""} />
        </Field>

        <Field label="Categoria (opcional)" htmlFor="categoryId">
          <Select id="categoryId" name="categoryId" defaultValue={product?.category_id ?? ""}>
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        {!product && (
          <Field
            label="Estoque inicial"
            htmlFor="stock"
            required
            error={state.fieldErrors?.stock}
            hint="Depois de criado, ajustes de estoque ficam numa seção própria (com motivo registrado)."
          >
            <Input
              id="stock"
              name="stock"
              type="number"
              min={0}
              required
              defaultValue={0}
              aria-invalid={Boolean(state.fieldErrors?.stock)}
            />
          </Field>
        )}

        <Button type="submit" loading={pending}>
          {product ? "Salvar alterações" : "Criar produto"}
        </Button>
      </form>
    </Card>
  );
}
