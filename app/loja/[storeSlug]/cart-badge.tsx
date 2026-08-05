"use client";

import { useCart } from "@/lib/cart/use-cart";

export function CartBadge({ storeSlug }: { storeSlug: string }) {
  const { itemCount } = useCart(storeSlug);
  return (
    <a href={`/loja/${storeSlug}/carrinho`} className="cart-badge">
      Carrinho{itemCount > 0 ? ` (${itemCount})` : ""}
    </a>
  );
}
