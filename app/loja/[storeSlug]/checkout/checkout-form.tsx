"use client";

import { useActionState, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart/use-cart";
import { clearCart } from "@/lib/cart/storage";
import {
  getServerCouponSnapshot,
  readAppliedCoupon,
  subscribeToCoupon,
  writeAppliedCoupon,
} from "@/lib/cart/coupon-storage";
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
import { IconArrowRight, IconShield, IconShoppingCart } from "@/components/ui/icons";
import styles from "./checkout.module.css";

export function CheckoutForm({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const router = useRouter();
  const { cart, subtotalCents } = useCart(storeSlug);
  const [state, formAction, pending] = useActionState(submitCheckoutAction, IDLE_ACTION_STATE as CheckoutState);
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  // useSyncExternalStore em vez de useEffect+setState: mesma razão do
  // useCart — localStorage é um store externo, e "hidratar" por efeito
  // causa render em cascata além de divergir do snapshot do servidor.
  // Só o CÓDIGO é lido; desconto e total continuam vindo do banco.
  const couponCode = useSyncExternalStore(
    useCallback((cb) => subscribeToCoupon(storeSlug, cb), [storeSlug]),
    () => readAppliedCoupon(storeSlug),
    getServerCouponSnapshot,
  );
  // Gerada uma única vez por carregamento da página (uma "tentativa real
  // de checkout") — reenvios dentro desta mesma página (duplo clique,
  // retry após erro de rede) reusam a MESMA key, então o backend
  // (create_order, 0006_orders.sql) nunca cria pedido nem baixa estoque
  // duas vezes.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (state.status === "success" && state.publicCode) {
      clearCart(storeSlug);
      writeAppliedCoupon(storeSlug, null);
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

  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const itemsJson = JSON.stringify(cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })));

  return (
    <>
      <StorefrontHeader storeSlug={storeSlug} storeName={storeName} backHref={`/loja/${storeSlug}/carrinho`} backLabel="Carrinho" />
      <main className={styles.main}>
        <h1 className={styles.title}>Finalizar pedido</h1>

        {/* Resumo do pedido — a primeira coisa, não uma linha de texto
            perdida embaixo do título. */}
        <div className={styles.summary}>
          <span className={styles.summaryCount}>
            {itemCount} {itemCount === 1 ? "item" : "itens"}
          </span>
          {/* TASK-012 — com cupom aplicado, este número é o SUBTOTAL, não
              o valor a pagar: o desconto é calculado no banco no momento
              do checkout. Rotular como "total" aqui mostraria R$200 para
              quem vai pagar R$180. O valor final aparece no Pix. */}
          <span className={styles.summaryTotal}>{formatPriceCents(subtotalCents)}</span>
        </div>

        {couponCode && (
          <p className={styles.couponNote}>
            Cupom <strong>{couponCode}</strong> aplicado — o desconto entra no valor final do Pix.
          </p>
        )}

        <Card>
          <form action={formAction} noValidate>
            <input type="hidden" name="storeSlug" value={storeSlug} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <input type="hidden" name="items" value={itemsJson} />
            {/* Só o CÓDIGO viaja. Desconto e total são recalculados no
                banco dentro de create_order — nada do que estiver aqui
                influencia o valor cobrado. */}
            <input type="hidden" name="couponCode" value={couponCode ?? ""} />

            {state.status === "error" && state.message && (
              <div className={styles.alertGap}>
                <Alert tone="danger">{state.message}</Alert>
              </div>
            )}

            <p className={styles.sectionLabel}>Seus dados</p>
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
                autoComplete="tel"
                placeholder="(11) 99999-8888"
                aria-invalid={Boolean(state.fieldErrors?.customerPhone)}
              />
            </Field>

            <p className={styles.sectionLabel}>Pagamento via Pix</p>
            <Field label="E-mail" htmlFor="payerEmail" required error={state.fieldErrors?.payerEmail}>
              <Input
                id="payerEmail"
                name="payerEmail"
                type="email"
                required
                maxLength={200}
                autoComplete="email"
                placeholder="voce@example.com"
                aria-invalid={Boolean(state.fieldErrors?.payerEmail)}
              />
            </Field>

            <Field
              label="CPF ou CNPJ"
              htmlFor="payerDocument"
              required
              error={state.fieldErrors?.payerDocument}
              hint="Usado só para processar o Pix — o número completo não fica guardado na loja."
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

            <p className={styles.sectionLabel}>Entrega</p>
            <div className={styles.fulfillmentField}>
              <div className={styles.fulfillmentOptions}>
                <label className={styles.fulfillmentOption} data-active={fulfillment === "pickup" || undefined}>
                  <input
                    type="radio"
                    name="fulfillmentMethod"
                    value="pickup"
                    checked={fulfillment === "pickup"}
                    onChange={() => setFulfillment("pickup")}
                    className={styles.fulfillmentRadio}
                  />
                  Retirada
                </label>
                <label className={styles.fulfillmentOption} data-active={fulfillment === "delivery" || undefined}>
                  <input
                    type="radio"
                    name="fulfillmentMethod"
                    value="delivery"
                    checked={fulfillment === "delivery"}
                    onChange={() => setFulfillment("delivery")}
                    className={styles.fulfillmentRadio}
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

            <Button type="submit" size="lg" fullWidth loading={pending} icon={<IconArrowRight />} iconPosition="end">
              Enviar pedido
            </Button>

            <p className={styles.trustLine}>
              <IconShield />
              Pagamento processado com segurança pelo Mercado Pago
            </p>
          </form>
        </Card>
      </main>
    </>
  );
}
