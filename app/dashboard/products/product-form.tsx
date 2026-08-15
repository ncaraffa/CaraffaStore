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

        <Field
          label="Nome"
          htmlFor="name"
          required
          error={state.fieldErrors?.name}
          info="O nome do produto exatamente como o cliente vai ver no seu catálogo."
        >
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

        <Field
          label="Endereço do produto"
          htmlFor="slug"
          required
          error={state.fieldErrors?.slug}
          info="O endereço deste produto dentro da sua loja, usado no link que você compartilha (ex.: /produto/nome-do-produto). É gerado a partir do nome, mas você pode editar."
        >
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

        <Field
          label="Descrição (opcional)"
          htmlFor="description"
          info="Texto que aparece na página do produto com mais detalhes pro cliente — ingredientes, tamanho, material, o que vier. Pode deixar em branco."
        >
          <Textarea id="description" name="description" maxLength={4000} defaultValue={product?.description ?? ""} />
        </Field>

        <Field
          label="Preço (R$)"
          htmlFor="price"
          required
          error={state.fieldErrors?.priceCents}
          info="O preço de venda desse produto pro cliente final, em reais."
        >
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

        <Field
          label="SKU (opcional)"
          htmlFor="sku"
          info="Um código interno seu pra identificar o produto no seu controle de estoque — o cliente nunca vê isso. Se você não usa esse tipo de código, pode deixar em branco."
        >
          <Input id="sku" name="sku" maxLength={64} defaultValue={product?.sku ?? ""} />
        </Field>

        <Field
          label="Categoria (opcional)"
          htmlFor="categoryId"
          info="Agrupa produtos parecidos pra facilitar a busca do cliente na sua loja, tipo 'Bebidas' ou 'Sobremesas'."
        >
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
            info="Quantas unidades desse produto você tem disponível agora pra vender. Esse número baixa sozinho a cada pedido pago."
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

        <Button type="submit" size="lg" loading={pending}>
          {product ? "Salvar alterações" : "Criar produto"}
        </Button>
      </form>
    </Card>
  );
}
