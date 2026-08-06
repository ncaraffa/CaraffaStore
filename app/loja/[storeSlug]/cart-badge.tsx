"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart/use-cart";
import { IconShoppingCart } from "@/components/ui/icons";
import styles from "./cart-badge.module.css";

export function CartBadge({ storeSlug }: { storeSlug: string }) {
  const { itemCount } = useCart(storeSlug);
  return (
    <Link href={`/loja/${storeSlug}/carrinho`} className={styles.badge}>
      <IconShoppingCart />
      Carrinho
      {itemCount > 0 && <span className={styles.count}>{itemCount}</span>}
    </Link>
  );
}
