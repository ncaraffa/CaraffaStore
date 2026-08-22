"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveAndStorePostalCode } from "@/lib/shipping/service-only/postal-code-store";
import { quoteShipping, type ShippingQuote } from "@/lib/shipping/service";
import { normalizePostalCode } from "@/lib/shipping/format";

/**
 * As duas perguntas que o checkout faz ao servidor enquanto o comprador
 * preenche o endereço. Nenhuma das duas cria pedido, reserva estoque ou
 * cobra qualquer coisa — e nenhuma delas aceita um valor em dinheiro,
 * nem uma cidade, como entrada.
 */

export interface PostalCodeLookupResult {
  status: "found" | "not_found" | "invalid" | "unavailable";
  street: string | null;
  neighborhood: string | null;
  /** Cidade/UF são exibidas, nunca reenviadas: o servidor já as guardou. */
  city: string | null;
  state: string | null;
}

/**
 * Busca o endereço de um CEP e, quando encontra, registra cidade/UF no
 * banco (via service_role) para que o cálculo de frete possa usá-las.
 *
 * É este registro — e não o formulário — que decide a faixa de frete
 * depois. O que volta daqui serve para preencher a tela.
 *
 * Quando o serviço externo falha, devolve `unavailable` em vez de
 * lançar: o comprador continua conseguindo preencher rua, número,
 * complemento e bairro. O que ele não consegue é escolher a cidade que
 * define o preço.
 */
export async function lookupPostalCodeAction(rawPostalCode: string): Promise<PostalCodeLookupResult> {
  const result = await resolveAndStorePostalCode(String(rawPostalCode ?? ""));

  if (result.status !== "found") {
    return { status: result.status, street: null, neighborhood: null, city: null, state: null };
  }

  return {
    status: "found",
    street: result.address.street,
    neighborhood: result.address.neighborhood,
    city: result.address.city,
    state: result.address.state,
  };
}

export interface ShippingQuoteResult {
  status: "ok" | "error";
  quote?: ShippingQuote;
}

/**
 * Recalcula o resumo inteiro do pedido (produtos, desconto, frete,
 * total) no servidor.
 *
 * Os itens vão como (id, quantidade) e o destino vai como CEP — nada
 * mais. Preço, desconto, frete e a cidade que decide a faixa são todos
 * relidos no banco pela RPC shipping_quote. Por isso o número que
 * aparece na tela é o mesmo que create_order vai gravar, e um carrinho
 * ou endereço adulterado no navegador não muda nem a exibição.
 */
export async function quoteShippingAction(input: {
  storeSlug: string;
  items: { productId: string; quantity: number }[];
  couponCode?: string | null;
  postalCode?: string | null;
}): Promise<ShippingQuoteResult> {
  const supabase = await createServerSupabaseClient();

  try {
    const quote = await quoteShipping(supabase, {
      storeSlug: String(input.storeSlug ?? ""),
      items: (input.items ?? []).slice(0, 50).map((item) => ({
        productId: String(item.productId),
        quantity: Number(item.quantity),
      })),
      couponCode: input.couponCode ?? null,
      postalCode: input.postalCode ? normalizePostalCode(input.postalCode) : null,
    });
    return { status: "ok", quote };
  } catch {
    // Falha de infraestrutura não pode virar checkout travado: a tela
    // esconde o resumo calculado e o pedido continua sendo validado —
    // e cobrado — pelo banco no envio.
    return { status: "error" };
  }
}
