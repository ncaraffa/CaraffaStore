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
import { formatCityState } from "@/lib/shipping/format";
import { quoteMessage } from "@/lib/shipping/messages";
import type { ShippingQuote } from "@/lib/shipping/service";
import { submitCheckoutAction, type CheckoutState } from "./actions";
import { quoteShippingAction } from "./shipping-actions";
import { EMPTY_SHIPPING_ADDRESS, ShippingFields, type ShippingAddressState } from "./shipping-fields";
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

export function CheckoutForm({
  storeSlug,
  storeName,
  /**
   * A loja tem entrega com frete configurado? Vem do servidor
   * (shipping_quote com carrinho vazio) para a primeira pintura já ser a
   * certa — sem piscar entre dois formulários diferentes de endereço.
   */
  shippingEnabled,
}: {
  storeSlug: string;
  storeName: string;
  shippingEnabled: boolean;
}) {
  const router = useRouter();
  const { cart, subtotalCents } = useCart(storeSlug);
  const [state, formAction, pending] = useActionState(submitCheckoutAction, IDLE_ACTION_STATE as CheckoutState);
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [address, setAddress] = useState<ShippingAddressState>(EMPTY_SHIPPING_ADDRESS);
  /**
   * Dados do comprador em estado controlado.
   *
   * Não é preferência de estilo: o React limpa os campos NÃO controlados
   * de um `<form action={...}>` assim que a action retorna. Com campos
   * soltos, qualquer recusa do servidor — cupom vencido, estoque que
   * acabou, o total que mudou no meio do preenchimento — apagava nome,
   * telefone, e-mail e CPF, e a pessoa recomeçava do zero logo depois de
   * ler "envie de novo".
   */
  const [buyer, setBuyer] = useState({
    customerName: "",
    customerPhone: "",
    payerEmail: "",
    payerDocument: "",
    customerNotes: "",
    deliveryAddress: "",
  });
  const setBuyerField = (field: keyof typeof buyer) => (event: { target: { value: string } }) =>
    setBuyer((current) => ({ ...current, [field]: event.target.value }));
  /**
   * Resumo financeiro calculado NO SERVIDOR (produtos, desconto, frete,
   * total). Nunca é somado aqui: a mesma RPC que responde esta prévia é
   * a que create_order usa para gravar o pedido, então o que aparece na
   * tela é o que o Pix vai cobrar.
   */
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

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

  const itemsKey = useMemo(
    () => cart.items.map((item) => `${item.productId}:${item.quantity}`).join(","),
    [cart.items],
  );

  const wantsShipping = shippingEnabled && fulfillment === "delivery";

  /**
   * Recalcula o resumo sempre que muda algo que afeta o valor: itens,
   * cupom, modalidade ou destino. Com um respiro de 350ms para não
   * disparar uma chamada por tecla enquanto o CEP está sendo digitado.
   */
  useEffect(() => {
    let cancelled = false;

    // Todo o setState acontece dentro do timer, nunca no corpo do efeito:
    // um setState síncrono aqui dispararia render em cascata a cada tecla
    // do CEP (react-hooks/set-state-in-effect). Os 350ms também servem de
    // respiro para não chamar o servidor letra a letra.
    const timer = setTimeout(async () => {
      if (cancelled) return;

      // Carrinho vazio, ou loja sem frete configurado: não há resumo de
      // servidor a mostrar — o carrinho já exibe subtotal e desconto, e
      // nada mais entra na conta.
      if (cart.items.length === 0 || !shippingEnabled) {
        setQuote(null);
        setQuoting(false);
        return;
      }

      setQuoting(true);
      const result = await quoteShippingAction({
        storeSlug,
        items: cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        couponCode: couponCode ?? null,
        // Só o CEP. Cidade e UF não são enviadas: o servidor as resolve
        // e devolve em destCity/destState, que é o que a tela exibe.
        postalCode: wantsShipping ? address.postalCode : null,
      });
      if (cancelled) return;
      setQuote(result.status === "ok" && result.quote ? result.quote : null);
      setQuoting(false);
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    storeSlug,
    shippingEnabled,
    itemsKey,
    cart.items,
    couponCode,
    wantsShipping,
    address.postalCode,
    // O backend recusou por total divergente (o lojista mudou a tabela
    // enquanto o comprador preenchia). Recotiza, senão a mensagem
    // "confira o novo total" apontaria para o número velho ainda na tela
    // — e o reenvio falharia em looping.
    state.code,
  ]);

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

  // Só mostra a linha de frete quando ela já significa alguma coisa: com
  // o destino incompleto, um "Frete R$ 0,00" seria mentira.
  const showShippingLine = wantsShipping && quote?.available === true;
  const shippingIsFree = quote?.rule === "free";

  const totalToShow = quote ? quote.totalCents : null;
  const missingForFreeShipping =
    quote && quote.freeShippingEnabled && quote.freeShippingMinimumCents !== null && quote.rule !== "free"
      ? quote.freeShippingMinimumCents - (quote.subtotalCents - quote.discountCents)
      : null;

  /**
   * Destino que o SERVIDOR confirmou pelo CEP. Prioriza o que veio da
   * cotação (é literalmente o par que decidiu o preço); antes dela
   * chegar, usa o que a busca de CEP devolveu, que veio do mesmo lugar.
   */
  const destination =
    formatCityState(quote?.destCity ?? null, quote?.destState ?? null) ??
    formatCityState(address.city || null, address.state || null);

  /**
   * O pedido só pode ser enviado quando a conta está fechada: com
   * entrega, isso significa ter uma cotação disponível. Sem ela, o
   * backend recusaria de qualquer forma (destino não resolvido) — travar
   * o botão evita mandar o comprador contra um erro previsível.
   */
  const canSubmit = !wantsShipping || quote?.available === true;

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
          {/* TASK-012/013 — sem resumo do servidor este número é o
              SUBTOTAL, não o valor a pagar: desconto e frete são
              calculados no banco no momento do checkout. Rotular como
              "total" aqui mostraria R$200 para quem vai pagar R$180. */}
          <span className={styles.summaryTotal}>{formatPriceCents(totalToShow ?? subtotalCents)}</span>
        </div>

        {quote && (
          <div className={styles.breakdown} aria-live="polite">
            <div className={styles.breakdownRow}>
              <span>Produtos</span>
              <span className={styles.breakdownValue}>{formatPriceCents(quote.subtotalCents)}</span>
            </div>
            {quote.discountCents > 0 && (
              <div className={styles.breakdownRow}>
                <span>Desconto{couponCode ? ` · ${couponCode}` : ""}</span>
                <span className={styles.breakdownValue}>−{formatPriceCents(quote.discountCents)}</span>
              </div>
            )}
            {showShippingLine && (
              <div className={styles.breakdownRow}>
                <span>Frete</span>
                <span className={styles.breakdownValue} data-free={shippingIsFree || undefined}>
                  {shippingIsFree ? "Grátis" : formatPriceCents(quote.shippingCents)}
                </span>
              </div>
            )}
            <div className={styles.breakdownTotal}>
              <span>Total</span>
              <span className={styles.breakdownValue}>{formatPriceCents(quote.totalCents)}</span>
            </div>
            {wantsShipping && !quote.available && quote.reason && (
              <p className={styles.shippingHint}>{quoteMessage(quote.reason) || "Informe o CEP para calcularmos o frete."}</p>
            )}
            {wantsShipping && missingForFreeShipping !== null && missingForFreeShipping > 0 && (
              <p className={styles.shippingHint}>
                Faltam {formatPriceCents(missingForFreeShipping)} para o frete sair grátis.
              </p>
            )}
            {quoting && <p className={styles.shippingHint}>Atualizando valores…</p>}
          </div>
        )}

        {couponCode && !quote && (
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
            {/* Idem: isto diz ao servidor QUAL endereço validar, nunca
                quanto cobrar. Quem decide o frete é a configuração real
                da loja, lida dentro da transação do pedido. */}
            <input type="hidden" name="shippingEnabled" value={shippingEnabled ? "true" : "false"} />
            {/* O total que está na tela viaja como TRAVA, não como
                preço: se o valor recalculado no banco não bater com
                este, o pedido é recusado em vez de cobrar em silêncio
                algo diferente do que o comprador viu. Mandar um número
                menor aqui não barateia nada — só faz o pedido falhar. */}
            {quote?.available === true && (
              <input type="hidden" name="expectedTotalCents" value={quote.totalCents} />
            )}

            {state.status === "error" && state.message && (
              <div className={styles.alertGap}>
                <Alert tone="danger">{state.message}</Alert>
              </div>
            )}

            <p className={styles.sectionLabel}>Seus dados</p>
            <Field label="Nome" htmlFor="customerName" required error={state.fieldErrors?.customerName}>
              <Input
                id="customerName"
                name="customerName"
                required
                maxLength={120}
                value={buyer.customerName}
                onChange={setBuyerField("customerName")}
                aria-invalid={Boolean(state.fieldErrors?.customerName)}
              />
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
                value={buyer.customerPhone}
                onChange={setBuyerField("customerPhone")}
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
                value={buyer.payerEmail}
                onChange={setBuyerField("payerEmail")}
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
                value={buyer.payerDocument}
                onChange={setBuyerField("payerDocument")}
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

            {fulfillment === "delivery" &&
              (shippingEnabled ? (
                <ShippingFields
                  address={address}
                  onChange={setAddress}
                  fieldErrors={state.fieldErrors}
                  destination={destination}
                />
              ) : (
                /* Loja que ainda não configurou frete: caminho de sempre,
                   endereço em texto livre e sem cobrança de entrega. */
                <Field label="Endereço de entrega" htmlFor="deliveryAddress" required error={state.fieldErrors?.deliveryAddress}>
                  <Textarea
                    id="deliveryAddress"
                    name="deliveryAddress"
                    maxLength={500}
                    required
                    value={buyer.deliveryAddress}
                    onChange={setBuyerField("deliveryAddress")}
                    aria-invalid={Boolean(state.fieldErrors?.deliveryAddress)}
                  />
                </Field>
              ))}

            <Field label="Observações (opcional)" htmlFor="customerNotes">
              <Textarea
                id="customerNotes"
                name="customerNotes"
                maxLength={1000}
                value={buyer.customerNotes}
                onChange={setBuyerField("customerNotes")}
              />
            </Field>

            <p className={styles.legal}>
              Ao enviar o pedido, você concorda com os <Link href="/termos">Termos de Uso</Link> e a{" "}
              <Link href="/privacidade">Política de Privacidade</Link>.
            </p>

            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={pending}
              disabled={!canSubmit}
              icon={<IconArrowRight />}
              iconPosition="end"
            >
              {wantsShipping && quote?.available === true && totalToShow !== null
                ? `Enviar pedido · ${formatPriceCents(totalToShow)}`
                : "Enviar pedido"}
            </Button>

            {!canSubmit && (
              <p className={styles.shippingHint}>
                Precisamos confirmar o CEP para calcular o frete antes de fechar o pedido. Se preferir, escolha retirada.
              </p>
            )}

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
