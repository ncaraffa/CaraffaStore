"use client";

import { useActionState } from "react";
import { adjustStockAction } from "./actions";

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
      <p>
        Estoque atual: <strong>{displayedStock}</strong>
      </p>
      <form action={formAction} noValidate>
        <input type="hidden" name="storeSlug" value={storeSlug} />
        <input type="hidden" name="productId" value={productId} />

        {state.status === "error" && state.message && (
          <p className="form-status" data-tone="error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <p className="form-status" data-tone="success" role="status">
            Estoque atualizado.
          </p>
        )}

        <div className="form-field">
          <label htmlFor="delta">Ajuste (use negativo para reduzir, ex.: -3)</label>
          <input id="delta" name="delta" type="number" required aria-invalid={Boolean(state.fieldErrors?.delta)} />
          {state.fieldErrors?.delta && <small role="alert">{state.fieldErrors.delta}</small>}
        </div>

        <div className="form-field">
          <label htmlFor="reason">Motivo</label>
          <input
            id="reason"
            name="reason"
            required
            maxLength={200}
            placeholder="Venda balcão, contagem, avaria..."
            aria-invalid={Boolean(state.fieldErrors?.reason)}
          />
          {state.fieldErrors?.reason && <small role="alert">{state.fieldErrors.reason}</small>}
        </div>

        <div className="form-field">
          <label htmlFor="reference">Referência (opcional)</label>
          <input id="reference" name="reference" maxLength={120} />
        </div>

        <button type="submit" disabled={pending}>
          {pending ? "Ajustando..." : "Ajustar estoque"}
        </button>
      </form>
    </div>
  );
}
