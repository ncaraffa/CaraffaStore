"use client";

import { useActionState } from "react";
import { adjustStockAction } from "./actions";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "./stock-form.module.css";

const IDLE: { status: "idle" | "error" | "success"; message?: string; fieldErrors?: Record<string, string>; newStock?: number } = {
  status: "idle",
};

export function StockForm({
  storeSlug,
  productId,
  currentStock,
}: {
  storeSlug: string;
  productId: string;
  currentStock: number;
}) {
  const [state, formAction, pending] = useActionState(adjustStockAction, IDLE);
  const displayedStock = state.status === "success" && state.newStock !== undefined ? state.newStock : currentStock;

  return (
    <div>
      <p className={styles.current}>
        Estoque atual: <strong>{displayedStock}</strong>
      </p>
      <form action={formAction} noValidate>
        <input type="hidden" name="storeSlug" value={storeSlug} />
        <input type="hidden" name="productId" value={productId} />

        {state.status === "error" && state.message && (
          <div className={styles.alertGap}>
            <Alert tone="danger">{state.message}</Alert>
          </div>
        )}
        {state.status === "success" && (
          <div className={styles.alertGap}>
            <Alert tone="success">Estoque atualizado.</Alert>
          </div>
        )}

        <Field label="Ajuste (use negativo para reduzir, ex.: -3)" htmlFor="delta" required error={state.fieldErrors?.delta}>
          <Input id="delta" name="delta" type="number" required aria-invalid={Boolean(state.fieldErrors?.delta)} />
        </Field>

        <Field label="Motivo" htmlFor="reason" required error={state.fieldErrors?.reason}>
          <Input
            id="reason"
            name="reason"
            required
            maxLength={200}
            placeholder="Venda balcão, contagem, avaria..."
            aria-invalid={Boolean(state.fieldErrors?.reason)}
          />
        </Field>

        <Field label="Referência (opcional)" htmlFor="reference">
          <Input id="reference" name="reference" maxLength={120} />
        </Field>

        <Button type="submit" variant="outline" loading={pending}>
          Ajustar estoque
        </Button>
      </form>
    </div>
  );
}
