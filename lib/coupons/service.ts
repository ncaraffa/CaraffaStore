import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { CouponDiscountType, CouponView } from "./format";

type Client = SupabaseClient<Database>;

/**
 * Acesso aos cupons. Toda regra de negócio — entitlement do plano,
 * normalização do código, validade, limite de utilizações, cálculo do
 * desconto — vive no banco. Este arquivo só traduz forma.
 */

export class CouponError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CouponError";
  }
}

export async function listCoupons(supabase: Client, storeId: string): Promise<CouponView[]> {
  const { data, error } = await supabase.rpc("coupon_list", { p_store_id: storeId });
  if (error) throw new CouponError(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    minimumOrderCents: row.minimum_order_cents,
    maximumDiscountCents: row.maximum_discount_cents,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    active: row.active,
    createdAt: row.created_at,
  }));
}

export interface CouponInput {
  couponId?: string | null;
  code: string;
  discountType: CouponDiscountType;
  /** basis points para percentual, centavos para valor fixo. */
  discountValue: number;
  minimumOrderCents?: number | null;
  maximumDiscountCents?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  maxUses?: number | null;
  active?: boolean;
}

export async function saveCoupon(supabase: Client, storeId: string, input: CouponInput): Promise<void> {
  const { error } = await supabase.rpc("coupon_upsert", {
    p_store_id: storeId,
    p_coupon_id: input.couponId ?? null,
    p_code: input.code,
    p_discount_type: input.discountType,
    p_discount_value: input.discountValue,
    p_minimum_order_cents: input.minimumOrderCents ?? null,
    p_maximum_discount_cents: input.maximumDiscountCents ?? null,
    p_starts_at: input.startsAt ?? null,
    p_expires_at: input.expiresAt ?? null,
    p_max_uses: input.maxUses ?? null,
    p_active: input.active ?? true,
  });

  if (error) throw new CouponError(error.message);
}

export interface CouponPreview {
  valid: boolean;
  reason: string | null;
  code: string | null;
  discountCents: number;
  minimumOrderCents: number | null;
}

/**
 * Prévia para o carrinho público.
 *
 * IMPORTANTE: isto NÃO reserva utilização e NÃO garante disponibilidade
 * futura. Dois compradores podem receber prévia válida para a última
 * vaga; quem finalizar primeiro leva, e o segundo é recusado no
 * checkout. É o comportamento correto — reservar no clique de "aplicar"
 * permitiria travar o cupom de uma loja só abrindo carrinhos.
 */
export async function previewCoupon(
  supabase: Client,
  params: { storeSlug: string; code: string; subtotalCents: number },
): Promise<CouponPreview> {
  const { data, error } = await supabase.rpc("coupon_preview", {
    p_store_slug: params.storeSlug,
    p_code: params.code,
    p_subtotal_cents: params.subtotalCents,
  });

  if (error) throw new CouponError(error.message);

  const row = data?.[0];
  if (!row) return { valid: false, reason: "coupon_not_found", code: null, discountCents: 0, minimumOrderCents: null };

  return {
    valid: row.valid,
    reason: row.reason,
    code: row.code,
    discountCents: row.discount_cents,
    minimumOrderCents: row.minimum_order_cents,
  };
}
