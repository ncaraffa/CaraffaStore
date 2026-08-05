"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart/use-cart";
import { clearCart } from "@/lib/cart/storage";
import { formatPriceCents } from "@/lib/catalog/format";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { submitCheckoutAction, type CheckoutState } from "./actions";

export function CheckoutForm({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const router = useRouter();
  const { cart, subtotalCents } = useCart(storeSlug);
  const [state, formAction, pending] = useActionState(submitCheckoutAction, IDLE_ACTION_STATE as CheckoutState);
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  // Gerada uma única vez por carregamento da página (uma "tentativa real
  // de checkout") — reenvios dentro desta mesma página (duplo clique,
  // retry após erro de rede) reusam a MESMA key, então o backend
  // (create_order, 0006_orders.sql) nunca cria pedido nem baixa estoque
  // duas vezes.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (state.status === "success" && state.publicCode) {
      clearCart(storeSlug);
      router.push(`/loja/${storeSlug}/pedido/${state.publicCode}/pagamento`);
    }
  }, [state, storeSlug, router]);

  if (cart.items.length === 0 && state.status !== "success") {
    return (
      <main>
        <p>
          <a href={`/loja/${storeSlug}`}>← {storeName}</a>
        </p>
        <p>Seu carrinho está vazio.</p>
      </main>
    );
  }

  const itemsJson = JSON.stringify(cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })));

  return (
    <main>
      <p>
        <a href={`/loja/${storeSlug}/carrinho`}>← Carrinho</a>
      </p>
      <h1>Finalizar pedido — {storeName}</h1>
      <p className="cart-subtotal">Total: {formatPriceCents(subtotalCents)}</p>

      <form action={formAction} noValidate>
        <input type="hidden" name="storeSlug" value={storeSlug} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="items" value={itemsJson} />

        {state.status === "error" && state.message && (
          <p className="form-status" data-tone="error" role="alert">
            {state.message}
          </p>
        )}

        <div className="form-field">
          <label htmlFor="customerName">Nome</label>
          <input
            id="customerName"
            name="customerName"
            required
            maxLength={120}
            aria-invalid={Boolean(state.fieldErrors?.customerName)}
          />
          {state.fieldErrors?.customerName && <small role="alert">{state.fieldErrors.customerName}</small>}
        </div>

        <div className="form-field">
          <label htmlFor="customerPhone">Telefone / WhatsApp</label>
          <input
            id="customerPhone"
            name="customerPhone"
            required
            maxLength={30}
            inputMode="tel"
            placeholder="(11) 99999-8888"
            aria-invalid={Boolean(state.fieldErrors?.customerPhone)}
          />
          {state.fieldErrors?.customerPhone && <small role="alert">{state.fieldErrors.customerPhone}</small>}
        </div>

        <div className="form-field">
          <label htmlFor="payerEmail">E-mail (para o pagamento Pix)</label>
          <input
            id="payerEmail"
            name="payerEmail"
            type="email"
            required
            maxLength={200}
            placeholder="voce@example.com"
            aria-invalid={Boolean(state.fieldErrors?.payerEmail)}
          />
          {state.fieldErrors?.payerEmail && <small role="alert">{state.fieldErrors.payerEmail}</small>}
        </div>

        <div className="form-field">
          <label htmlFor="payerDocument">CPF ou CNPJ (para o pagamento Pix)</label>
          <input
            id="payerDocument"
            name="payerDocument"
            required
            inputMode="numeric"
            maxLength={20}
            placeholder="000.000.000-00"
            aria-invalid={Boolean(state.fieldErrors?.payerDocument)}
          />
          {state.fieldErrors?.payerDocument && <small role="alert">{state.fieldErrors.payerDocument}</small>}
          <small>
            Seus dados são usados só para processar o pagamento Pix — o CPF/CNPJ completo não fica guardado na loja.
          </small>
        </div>

        <div className="form-field">
          <label>Modalidade</label>
          <div className="fulfillment-options">
            <label>
              <input
                type="radio"
                name="fulfillmentMethod"
                value="pickup"
                checked={fulfillment === "pickup"}
                onChange={() => setFulfillment("pickup")}
              />
              Retirada
            </label>
            <label>
              <input
                type="radio"
                name="fulfillmentMethod"
                value="delivery"
                checked={fulfillment === "delivery"}
                onChange={() => setFulfillment("delivery")}
              />
              Entrega
            </label>
          </div>
        </div>

        {fulfillment === "delivery" && (
          <div className="form-field">
            <label htmlFor="deliveryAddress">Endereço de entrega</label>
            <textarea
              id="deliveryAddress"
              name="deliveryAddress"
              maxLength={500}
              required
              aria-invalid={Boolean(state.fieldErrors?.deliveryAddress)}
            />
            {state.fieldErrors?.deliveryAddress && <small role="alert">{state.fieldErrors.deliveryAddress}</small>}
          </div>
        )}

        <div className="form-field">
          <label htmlFor="customerNotes">Observações (opcional)</label>
          <textarea id="customerNotes" name="customerNotes" maxLength={1000} />
        </div>

        <button type="submit" disabled={pending}>
          {pending ? "Enviando..." : "Enviar pedido"}
        </button>
      </form>
    </main>
  );
}
