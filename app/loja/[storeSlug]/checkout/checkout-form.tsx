"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart/use-cart";
import { clearCart } from "@/lib/cart/storage";
import { formatPriceCents } from "@/lib/catalog/format";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import { submitCheckoutAction, type CheckoutState } from "./actions";
import { StorefrontHeader } from "@/components/storefront/StorefrontHeader";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconShoppingCart } from "@/components/ui/icons";
import styles from "./checkout.module.css";

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
      <>
        <StorefrontHeader storeSlug={storeSlug} storeName={storeName} backHref={`/loja/${storeSlug}`} />
        <main className={styles.main}>
          <EmptyState icon={<IconShoppingCart />} title="Seu carrinho está vazio" />
        </main>
      </>
    );
  }

  const itemsJson = JSON.stringify(cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })));

  return (
    <>
      <StorefrontHeader storeSlug={storeSlug} storeName={storeName} backHref={`/loja/${storeSlug}/carrinho`} backLabel="Carrinho" />
      <main className={styles.main}>
        <h1 className={styles.title}>Finalizar pedido</h1>
        <p className={styles.total}>Total: {formatPriceCents(subtotalCents)}</p>

        <Card>
          <form action={formAction} noValidate>
            <input type="hidden" name="storeSlug" value={storeSlug} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <input type="hidden" name="items" value={itemsJson} />

            {state.status === "error" && state.message && (
              <div className={styles.alertGap}>
                <Alert tone="danger">{state.message}</Alert>
              </div>
            )}

            <Field label="Nome" htmlFor="customerName" required error={state.fieldErrors?.customerName}>
              <Input id="customerName" name="customerName" required maxLength={120} aria-invalid={Boolean(state.fieldErrors?.customerName)} />
            </Field>

            <Field label="Telefone / WhatsApp" htmlFor="customerPhone" required error={state.fieldErrors?.customerPhone}>
              <Input
                id="customerPhone"
                name="customerPhone"
                required
                maxLength={30}
                inputMode="tel"
                placeholder="(11) 99999-8888"
                aria-invalid={Boolean(state.fieldErrors?.customerPhone)}
              />
            </Field>

            <Field label="E-mail (para o pagamento Pix)" htmlFor="payerEmail" required error={state.fieldErrors?.payerEmail}>
              <Input
                id="payerEmail"
                name="payerEmail"
                type="email"
                required
                maxLength={200}
                placeholder="voce@example.com"
                aria-invalid={Boolean(state.fieldErrors?.payerEmail)}
              />
            </Field>

            <Field
              label="CPF ou CNPJ (para o pagamento Pix)"
              htmlFor="payerDocument"
              required
              error={state.fieldErrors?.payerDocument}
              hint="Seus dados são usados só para processar o pagamento Pix — o CPF/CNPJ completo não fica guardado na loja."
            >
              <Input
                id="payerDocument"
                name="payerDocument"
                required
                inputMode="numeric"
                maxLength={20}
                placeholder="000.000.000-00"
                aria-invalid={Boolean(state.fieldErrors?.payerDocument)}
              />
            </Field>

            <div className={styles.fulfillmentField}>
              <span className={styles.fulfillmentLabel}>Modalidade</span>
              <div className={styles.fulfillmentOptions}>
                <label className={styles.fulfillmentOption}>
                  <input
                    type="radio"
                    name="fulfillmentMethod"
                    value="pickup"
                    checked={fulfillment === "pickup"}
                    onChange={() => setFulfillment("pickup")}
                  />
                  Retirada
                </label>
                <label className={styles.fulfillmentOption}>
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
              <Field label="Endereço de entrega" htmlFor="deliveryAddress" required error={state.fieldErrors?.deliveryAddress}>
                <Textarea id="deliveryAddress" name="deliveryAddress" maxLength={500} required aria-invalid={Boolean(state.fieldErrors?.deliveryAddress)} />
              </Field>
            )}

            <Field label="Observações (opcional)" htmlFor="customerNotes">
              <Textarea id="customerNotes" name="customerNotes" maxLength={1000} />
            </Field>

            <p className={styles.legal}>
              Ao enviar o pedido, você concorda com os <Link href="/termos">Termos de Uso</Link> e a{" "}
              <Link href="/privacidade">Política de Privacidade</Link>.
            </p>

            <Button type="submit" fullWidth loading={pending}>
              Enviar pedido
            </Button>
          </form>
        </Card>
      </main>
    </>
  );
}
