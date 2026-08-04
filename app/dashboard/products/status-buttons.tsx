import { setProductStatusAction } from "./actions";
import type { ProductStatus } from "@/lib/supabase/types";

function StatusButton({
  storeSlug,
  productId,
  targetStatus,
  label,
}: {
  storeSlug: string;
  productId: string;
  targetStatus: ProductStatus;
  label: string;
}) {
  return (
    <form action={setProductStatusAction} style={{ display: "inline" }}>
      <input type="hidden" name="storeSlug" value={storeSlug} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="status" value={targetStatus} />
      <button type="submit" className="btn-link">
        {label}
      </button>
    </form>
  );
}

export function StatusButtons({
  storeSlug,
  productId,
  status,
}: {
  storeSlug: string;
  productId: string;
  status: ProductStatus;
}) {
  return (
    <div className="table-actions">
      {status !== "published" && (
        <StatusButton storeSlug={storeSlug} productId={productId} targetStatus="published" label="Publicar" />
      )}
      {status === "published" && (
        <StatusButton storeSlug={storeSlug} productId={productId} targetStatus="draft" label="Despublicar" />
      )}
      {status !== "archived" && (
        <StatusButton storeSlug={storeSlug} productId={productId} targetStatus="archived" label="Arquivar" />
      )}
      {status === "archived" && (
        <StatusButton storeSlug={storeSlug} productId={productId} targetStatus="draft" label="Reativar (rascunho)" />
      )}
    </div>
  );
}
