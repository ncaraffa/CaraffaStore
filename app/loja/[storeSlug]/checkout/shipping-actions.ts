"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { lookupPostalCode } from "@/lib/shipping/postal-code-lookup";
import { quoteShipping, type ShippingQuote } from "@/lib/shipping/service";
import { normalizePostalCode } from "@/lib/shipping/format";

/**
 * As duas perguntas que o checkout faz ao servidor enquanto o comprador
 * preenche o endereço. Nenhuma das duas cria pedido, reserva estoque ou
 * cobra qualquer coisa — e nenhuma delas aceita um valor em dinheiro
 * como entrada.
 */

export interface PostalCodeLookupResult {
  status: "found" | "not_found" | "invalid" | "unavailable";
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

/**
 * Busca o endereço de um CEP.
 *
 * Quando o serviço externo falha, devolve `unavailable` em vez de
 * lançar: o checkout precisa continuar utilizável com o endereço
 * preenchido à mão. O CEP em si permanece obrigatório — é ele que
 * identifica o destino no pedido.
 */
export async function lookupPostalCodeAction(rawPostalCode: string): Promise<PostalCodeLookupResult> {
  const result = await lookupPostalCode(String(rawPostalCode ?? ""));

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
 * Os itens vão como (id, quantidade) e nada mais: preço, desconto e
 * frete são todos relidos do banco pela RPC shipping_quote. Por isso o
 * número que aparece na tela é o mesmo que create_order vai gravar — e
 * um carrinho adulterado no navegador não muda nem a exibição.
 */
export async function quoteShippingAction(input: {
  storeSlug: string;
  items: { productId: string; quantity: number }[];
  couponCode?: string | null;
  postalCode?: string | null;
  city?: string | null;
  state?: string | null;
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
      city: input.city ?? null,
      state: input.state ?? null,
    });
    return { status: "ok", quote };
  } catch {
    // Falha de infraestrutura não pode virar checkout travado: a tela
    // esconde o resumo calculado e o pedido continua sendo validado —
    // e cobrado — pelo banco no envio.
    return { status: "error" };
  }
}
