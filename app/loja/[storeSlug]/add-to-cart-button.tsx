"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart/use-cart";

export function AddToCartButton({
  storeSlug,
  productId,
  name,
  slug,
  priceCents,
  stock,
}: {
  storeSlug: string;
  productId: string;
  name: string;
  slug: string | null;
  priceCents: number;
  stock: number;
}) {
  const { addItem } = useCart(storeSlug);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  if (stock === 0) {
    return (
      <span className="badge" data-tone="warning">
        Esgotado
      </span>
    );
  }

  const maxQuantity = Math.min(999, stock);

  return (
    <div className="add-to-cart">
      <input
        type="number"
        min={1}
        max={maxQuantity}
        step={1}
        value={quantity}
        onChange={(e) => {
          const next = Math.trunc(Number(e.target.value));
          setQuantity(Number.isFinite(next) ? Math.max(1, Math.min(maxQuantity, next)) : 1);
        }}
        aria-label={`Quantidade de ${name}`}
      />
      <button
        type="button"
        onClick={() => {
          addItem({ productId, name, slug, priceCents, quantity });
          setAdded(true);
          window.setTimeout(() => setAdded(false), 1500);
        }}
      >
        {added ? "Adicionado!" : "Adicionar ao carrinho"}
      </button>
    </div>
  );
}
