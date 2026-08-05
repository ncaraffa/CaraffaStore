"use client";

import { cancelOrderAction } from "../actions";

export function CancelOrderForm({ storeSlug, orderId }: { storeSlug: string; orderId: string }) {
  return (
    <form
      action={cancelOrderAction}
      onSubmit={(e) => {
        if (!window.confirm("Cancelar este pedido? O estoque reservado será devolvido.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="storeSlug" value={storeSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit" className="btn-link" data-tone="danger">
        Cancelar pedido
      </button>
    </form>
  );
}
