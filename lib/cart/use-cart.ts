"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  cartEventName,
  clearCart,
  getCartSnapshot,
  getServerCartSnapshot,
  readCart,
  writeCart,
  type CartItem,
} from "./storage";

const MAX_QUANTITY = 999;

function subscribe(storeSlug: string, callback: () => void): () => void {
  const eventName = cartEventName(storeSlug);
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * useSyncExternalStore (não useEffect+setState) é a forma correta do
 * React de ler/assinar um estado externo mutável como localStorage —
 * evita o anti-padrão de "hidratar" via efeito (que causaria uma
 * cascata de renders e diverge do snapshot do servidor até o efeito
 * rodar) e mantém o carrinho sempre em sincronia com localStorage/outras
 * abas sem nenhum Context/Provider.
 */
export function useCart(storeSlug: string) {
  const items = useSyncExternalStore(
    useCallback((callback) => subscribe(storeSlug, callback), [storeSlug]),
    () => getCartSnapshot(storeSlug),
    getServerCartSnapshot,
  );

  const addItem = useCallback(
    (item: CartItem) => {
      const current = readCart(storeSlug);
      const existing = current.items.find((i) => i.productId === item.productId);
      const nextItems = existing
        ? current.items.map((i) =>
            i.productId === item.productId
              ? { ...i, quantity: Math.min(MAX_QUANTITY, i.quantity + item.quantity) }
              : i,
          )
        : [...current.items, { ...item, quantity: Math.min(MAX_QUANTITY, item.quantity) }];
      writeCart(storeSlug, { items: nextItems });
    },
    [storeSlug],
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      const current = readCart(storeSlug);
      const nextItems =
        quantity <= 0
          ? current.items.filter((i) => i.productId !== productId)
          : current.items.map((i) =>
              i.productId === productId ? { ...i, quantity: Math.min(MAX_QUANTITY, quantity) } : i,
            );
      writeCart(storeSlug, { items: nextItems });
    },
    [storeSlug],
  );

  const removeItem = useCallback((productId: string) => setQuantity(productId, 0), [setQuantity]);

  const clear = useCallback(() => clearCart(storeSlug), [storeSlug]);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotalCents = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);

  return { cart: { items }, addItem, setQuantity, removeItem, clear, itemCount, subtotalCents };
}
