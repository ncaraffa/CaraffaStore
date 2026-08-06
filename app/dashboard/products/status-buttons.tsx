import { setProductStatusAction } from "./actions";
import type { ProductStatus } from "@/lib/supabase/types";
import { Button } from "@/components/ui/Button";
import styles from "./status-buttons.module.css";

function StatusButton({
  storeSlug,
  productId,
  targetStatus,
  label,
  variant,
}: {
  storeSlug: string;
  productId: string;
  targetStatus: ProductStatus;
  label: string;
  variant: "primary" | "outline";
}) {
  return (
    <form action={setProductStatusAction}>
      <input type="hidden" name="storeSlug" value={storeSlug} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="status" value={targetStatus} />
      <Button type="submit" variant={variant} size="sm">
        {label}
      </Button>
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
    <div className={styles.row}>
      {status !== "published" && (
        <StatusButton storeSlug={storeSlug} productId={productId} targetStatus="published" label="Publicar" variant="primary" />
      )}
      {status === "published" && (
        <StatusButton storeSlug={storeSlug} productId={productId} targetStatus="draft" label="Despublicar" variant="outline" />
      )}
      {status !== "archived" && (
        <StatusButton storeSlug={storeSlug} productId={productId} targetStatus="archived" label="Arquivar" variant="outline" />
      )}
      {status === "archived" && (
        <StatusButton
          storeSlug={storeSlug}
          productId={productId}
          targetStatus="draft"
          label="Reativar (rascunho)"
          variant="outline"
        />
      )}
    </div>
  );
}
