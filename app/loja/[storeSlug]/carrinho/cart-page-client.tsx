"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart/use-cart";
import { formatPriceCents } from "@/lib/catalog/format";
import { StorefrontHeader } from "@/components/storefront/StorefrontHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconArrowRight, IconBox, IconShoppingCart } from "@/components/ui/icons";
import styles from "./cart.module.css";

export function CartPageClient({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const { cart, setQuantity, removeItem, clear, subtotalCents } = useCart(storeSlug);

  return (
    <>
      <StorefrontHeader storeSlug={storeSlug} storeName={storeName} backHref={`/loja/${storeSlug}`} />
      <main className={styles.main}>
        <h1 className={styles.title}>Seu carrinho</h1>

        {cart.items.length === 0 ? (
          <EmptyState
            icon={<IconShoppingCart />}
            title="Seu carrinho está vazio"
            description="Adicione produtos do catálogo para continuar."
            action={
              <Link href={`/loja/${storeSlug}`}>
                <Button>Ver catálogo</Button>
              </Link>
            }
          />
        ) : (
          <>
            <ul className={styles.list}>
              {cart.items.map((item) => (
                <li key={item.productId} className={styles.item}>
                  <span className={styles.itemThumb} data-empty={!item.imageUrl || undefined}>
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- URL do Supabase Storage
                      <img src={item.imageUrl} alt="" loading="lazy" />
                    ) : (
                      <IconBox />
                    )}
                  </span>

                  <div className={styles.itemInfo}>
                    <strong>{item.name}</strong>
                    <span className={styles.itemPrice}>{formatPriceCents(item.priceCents)} / un.</span>
                  </div>

                  <div className={styles.qty}>
                    <button
                      type="button"
                      className={styles.qtyButton}
                      onClick={() => setQuantity(item.productId, item.quantity - 1)}
                      aria-label={`Diminuir quantidade de ${item.name}`}
                    >
                      −
                    </button>
                    <span aria-live="polite" className={styles.qtyValue}>
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      className={styles.qtyButton}
                      onClick={() => setQuantity(item.productId, item.quantity + 1)}
                      aria-label={`Aumentar quantidade de ${item.name}`}
                    >
                      +
                    </button>
                  </div>

                  <span className={styles.itemTotal}>{formatPriceCents(item.priceCents * item.quantity)}</span>

                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeItem(item.productId)}
                    aria-label={`Remover ${item.name} do carrinho`}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>

            <button type="button" className={styles.clearLink} onClick={clear}>
              Limpar carrinho
            </button>

            {/* Barra fixa no celular: resumo e CTA sempre ao alcance do
                polegar, sem precisar rolar até o fim da lista. */}
            <div className={styles.checkoutBar}>
              <div className={styles.summary}>
                <span className={styles.subtotalLabel}>Subtotal</span>
                <span className={styles.subtotal}>{formatPriceCents(subtotalCents)}</span>
              </div>
              <Link href={`/loja/${storeSlug}/checkout`} className={styles.checkoutLink}>
                <Button size="lg" fullWidth icon={<IconArrowRight />} iconPosition="end">
                  Finalizar pedido
                </Button>
              </Link>
            </div>
          </>
        )}
      </main>
    </>
  );
}
