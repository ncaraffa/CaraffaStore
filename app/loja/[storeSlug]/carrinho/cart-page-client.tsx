"use client";

import { useCart } from "@/lib/cart/use-cart";
import { formatPriceCents } from "@/lib/catalog/format";

export function CartPageClient({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const { cart, setQuantity, removeItem, clear, subtotalCents } = useCart(storeSlug);

  return (
    <main>
      <p>
        <a href={`/loja/${storeSlug}`}>← {storeName}</a>
      </p>
      <h1>Seu carrinho</h1>

      {cart.items.length === 0 ? (
        <p>Seu carrinho está vazio.</p>
      ) : (
        <>
          <ul className="cart-list">
            {cart.items.map((item) => (
              <li key={item.productId} className="cart-item">
                <div className="cart-item-info">
                  <strong>{item.name}</strong>
                  <span>{formatPriceCents(item.priceCents)}</span>
                </div>
                <div className="cart-item-qty">
                  <button
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity - 1)}
                    aria-label={`Diminuir quantidade de ${item.name}`}
                  >
                    −
                  </button>
                  <span aria-live="polite">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity + 1)}
                    aria-label={`Aumentar quantidade de ${item.name}`}
                  >
                    +
                  </button>
                </div>
                <span className="cart-item-total">{formatPriceCents(item.priceCents * item.quantity)}</span>
                <button
                  type="button"
                  className="btn-link"
                  data-tone="danger"
                  onClick={() => removeItem(item.productId)}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>

          <p className="cart-subtotal">Subtotal: {formatPriceCents(subtotalCents)}</p>

          <div className="cart-actions">
            <button type="button" className="btn-link" onClick={clear}>
              Limpar carrinho
            </button>
            <a className="btn-primary-link" href={`/loja/${storeSlug}/checkout`}>
              Finalizar pedido
            </a>
          </div>
        </>
      )}
    </main>
  );
}
