"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart/use-cart";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { IconCheck } from "@/components/ui/icons";
import styles from "./add-to-cart-button.module.css";

export function AddToCartButton({
  storeSlug,
  productId,
  name,
  slug,
  priceCents,
  stock,
  imageUrl,
}: {
  storeSlug: string;
  productId: string;
  name: string;
  slug: string | null;
  priceCents: number;
  stock: number;
  imageUrl?: string | null;
}) {
  const { addItem } = useCart(storeSlug);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  if (stock === 0) {
    return <Badge tone="warning">Esgotado</Badge>;
  }

  const maxQuantity = Math.min(999, stock);

  return (
    <div className={styles.row}>
      <Input
        type="number"
        min={1}
        max={maxQuantity}
        step={1}
        value={quantity}
        className={styles.qtyInput}
        onChange={(e) => {
          const next = Math.trunc(Number(e.target.value));
          setQuantity(Number.isFinite(next) ? Math.max(1, Math.min(maxQuantity, next)) : 1);
        }}
        aria-label={`Quantidade de ${name}`}
      />
      <Button
        type="button"
        fullWidth
        icon={added ? <IconCheck /> : undefined}
        onClick={() => {
          addItem({ productId, name, slug, priceCents, quantity, imageUrl });
          setAdded(true);
          window.setTimeout(() => setAdded(false), 1500);
        }}
      >
        {added ? "Adicionado" : "Adicionar ao carrinho"}
      </Button>
    </div>
  );
}
