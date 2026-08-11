"use client";

import { setStoreStatusAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";

export function StoreStatusActions({ storeId, storeName, isSuspended }: { storeId: string; storeName: string; isSuspended: boolean }) {
  return (
    <form action={setStoreStatusAction}>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="action" value={isSuspended ? "reactivate" : "suspend"} />
      {isSuspended ? (
        <ConfirmSubmitButton
          label="Reativar"
          variant="primary"
          confirmTitle={`Reativar "${storeName}"?`}
          confirmMessage="A loja volta exatamente ao status que tinha antes de ser suspensa (não pula etapa de pagamento se ainda não tiver pago)."
          confirmLabel="Reativar loja"
        />
      ) : (
        <ConfirmSubmitButton
          label="Suspender"
          variant="destructive"
          confirmTitle={`Suspender "${storeName}"?`}
          confirmMessage="A loja e o catálogo público ficam bloqueados imediatamente. Pode reativar depois — o status atual fica salvo."
          confirmLabel="Suspender loja"
        />
      )}
    </form>
  );
}
