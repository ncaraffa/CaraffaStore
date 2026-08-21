import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ShippingRule } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Acesso ao frete. Toda a regra de negócio — faixa aplicável, acréscimo,
 * frete grátis, autorização, validação — vive no banco
 * (supabase/migrations/0025_store_shipping.sql). Este arquivo só traduz
 * forma, exatamente como lib/coupons/service.ts.
 */
export class ShippingError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "ShippingError";
    this.code = code;
  }
}

export interface ShippingSettingsView {
  isConfigured: boolean;
  enabled: boolean;
  originPostalCode: string | null;
  originCity: string | null;
  originState: string | null;
  sameCityFeeCents: number;
  sameStateFeeCents: number;
  otherStateFeeCents: number;
  additionalFeeCents: number;
  freeShippingEnabled: boolean;
  freeShippingMinimumCents: number | null;
  updatedAt: string | null;
}

export async function getShippingSettings(supabase: Client, storeId: string): Promise<ShippingSettingsView> {
  const { data, error } = await supabase.rpc("shipping_settings_get", { p_store_id: storeId });
  if (error) throw new ShippingError(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ShippingError("unexpected_empty_result");

  return {
    isConfigured: row.is_configured,
    enabled: row.enabled,
    originPostalCode: row.origin_postal_code,
    originCity: row.origin_city,
    originState: row.origin_state,
    sameCityFeeCents: row.same_city_fee_cents,
    sameStateFeeCents: row.same_state_fee_cents,
    otherStateFeeCents: row.other_state_fee_cents,
    additionalFeeCents: row.additional_fee_cents,
    freeShippingEnabled: row.free_shipping_enabled,
    freeShippingMinimumCents: row.free_shipping_minimum_cents,
    updatedAt: row.updated_at,
  };
}

export interface ShippingSettingsInput {
  enabled: boolean;
  originPostalCode: string | null;
  originCity: string | null;
  originState: string | null;
  sameCityFeeCents: number;
  sameStateFeeCents: number;
  otherStateFeeCents: number;
  additionalFeeCents: number;
  freeShippingEnabled: boolean;
  freeShippingMinimumCents: number | null;
}

export async function saveShippingSettings(
  supabase: Client,
  storeId: string,
  input: ShippingSettingsInput,
): Promise<void> {
  const { error } = await supabase.rpc("shipping_settings_upsert", {
    p_store_id: storeId,
    p_enabled: input.enabled,
    p_origin_postal_code: input.originPostalCode,
    p_origin_city: input.originCity,
    p_origin_state: input.originState,
    p_same_city_fee_cents: input.sameCityFeeCents,
    p_same_state_fee_cents: input.sameStateFeeCents,
    p_other_state_fee_cents: input.otherStateFeeCents,
    p_additional_fee_cents: input.additionalFeeCents,
    p_free_shipping_enabled: input.freeShippingEnabled,
    p_free_shipping_minimum_cents: input.freeShippingMinimumCents,
  });

  if (error) throw new ShippingError(error.message);
}

export interface ShippingQuote {
  /** A loja oferece entrega calculada? Falso = checkout segue no caminho de endereço livre. */
  shippingEnabled: boolean;
  /** Deu para calcular com o que foi informado até agora? */
  available: boolean;
  reason: string | null;
  rule: ShippingRule | null;
  shippingCents: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  freeShippingEnabled: boolean;
  freeShippingMinimumCents: number | null;
  originCity: string | null;
  originState: string | null;
}

/**
 * Prévia do frete para o checkout.
 *
 * NÃO cria pedido e NÃO reserva nada. Mas — diferente da prévia de cupom
 * — nem o subtotal é aceito do navegador: a RPC recebe os ITENS e
 * recalcula subtotal, desconto e frete a partir de products/coupons.
 * É por isso que o total mostrado aqui é exatamente o que create_order
 * vai gravar e o que o Mercado Pago vai cobrar.
 */
export async function quoteShipping(
  supabase: Client,
  params: {
    storeSlug: string;
    items: { productId: string; quantity: number }[];
    couponCode?: string | null;
    postalCode?: string | null;
    city?: string | null;
    state?: string | null;
  },
): Promise<ShippingQuote> {
  const { data, error } = await supabase.rpc("shipping_quote", {
    p_store_slug: params.storeSlug,
    p_items: params.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_coupon_code: params.couponCode ?? null,
    p_postal_code: params.postalCode ?? null,
    p_city: params.city ?? null,
    p_state: params.state ?? null,
  });

  if (error) throw new ShippingError(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ShippingError("unexpected_empty_result");

  return {
    shippingEnabled: row.shipping_enabled,
    available: row.available,
    reason: row.reason,
    rule: row.rule,
    shippingCents: row.shipping_cents,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    totalCents: row.total_cents,
    freeShippingEnabled: row.free_shipping_enabled,
    freeShippingMinimumCents: row.free_shipping_minimum_cents,
    originCity: row.origin_city,
    originState: row.origin_state,
  };
}
