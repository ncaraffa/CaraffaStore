"use client";

import { setStoreStatusAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { IconBan, IconRotate } from "@/components/ui/icons";

export function StoreStatusActions({
  storeId,
  storeName,
  isSuspended,
}: {
  storeId: string;
  storeName: string;
  isSuspended: boolean;
}) {
  return (
    <form action={setStoreStatusAction}>
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="action" value={isSuspended ? "reactivate" : "suspend"} />
      {isSuspended ? (
        <ConfirmSubmitButton
          label="Reativar"
          icon={<IconRotate />}
          variant="primary"
          confirmTitle={`Reativar "${storeName}"?`}
          confirmMessage="A loja volta exatamente ao status que tinha antes de ser suspensa — se ainda não tinha pago a assinatura, continua aguardando o pagamento."
          confirmLabel="Reativar loja"
        />
      ) : (
        <ConfirmSubmitButton
          label="Bloquear"
          icon={<IconBan />}
          variant="destructive"
          confirmTitle={`Bloquear "${storeName}"?`}
          confirmMessage="O painel do lojista e o catálogo público ficam indisponíveis na hora. Você pode reativar quando quiser — o status atual fica guardado."
          confirmLabel="Bloquear loja"
        />
      )}
    </form>
  );
}
