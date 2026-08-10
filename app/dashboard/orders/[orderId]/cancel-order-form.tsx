"use client";

import { cancelOrderAction } from "../actions";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";

export function CancelOrderForm({ storeSlug, orderId, isPix = false }: { storeSlug: string; orderId: string; isPix?: boolean }) {
  const confirmMessage = isPix
    ? "Vamos conferir o pagamento no Mercado Pago antes de cancelar — se já estiver pago, o cancelamento será recusado (sem reembolso nesta versão)."
    : "O estoque reservado para este pedido será devolvido.";

  return (
    <form action={cancelOrderAction}>
      <input type="hidden" name="storeSlug" value={storeSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <ConfirmSubmitButton
        label="Cancelar pedido"
        confirmTitle="Cancelar pedido"
        confirmMessage={confirmMessage}
        confirmLabel="Cancelar pedido"
      />
    </form>
  );
}
