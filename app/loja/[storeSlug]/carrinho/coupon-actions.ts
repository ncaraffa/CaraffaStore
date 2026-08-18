"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { previewCoupon } from "@/lib/coupons/service";
import { buyerCouponMessage, minimumShortfallMessage } from "@/lib/coupons/messages";

export interface CouponPreviewState {
  status: "idle" | "applied" | "error";
  code?: string;
  discountCents?: number;
  message?: string;
}

/**
 * Prévia do cupom no carrinho.
 *
 * NÃO reserva utilização e NÃO garante disponibilidade futura — dois
 * compradores podem ver prévia válida para a última vaga. Reservar aqui
 * permitiria travar o cupom de uma loja só abrindo carrinhos. Quem
 * reserva é create_order, na mesma transação do pedido.
 *
 * O subtotal recebido do formulário serve APENAS para escolher a
 * mensagem (mínimo atingido ou não). O desconto real do pedido é
 * recalculado no banco a partir dos preços vigentes — um subtotal
 * forjado aqui não vira desconto lá.
 */
export async function previewCouponAction(
  _prev: CouponPreviewState,
  formData: FormData,
): Promise<CouponPreviewState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const subtotalCents = Number(formData.get("subtotalCents") ?? 0);

  if (!code) {
    return { status: "error", message: "Digite um código de cupom." };
  }
  if (!Number.isFinite(subtotalCents) || subtotalCents < 0) {
    return { status: "error", message: "Não foi possível aplicar este cupom." };
  }

  const supabase = await createServerSupabaseClient();

  try {
    const preview = await previewCoupon(supabase, { storeSlug, code, subtotalCents });

    if (!preview.valid) {
      // Quando falta valor para o mínimo, dizer QUANTO falta é mais útil
      // que só "não atingiu" — o comprador consegue decidir.
      if (preview.reason === "coupon_minimum_not_met" && preview.minimumOrderCents !== null) {
        return { status: "error", message: minimumShortfallMessage(subtotalCents, preview.minimumOrderCents) };
      }
      return { status: "error", message: buyerCouponMessage(preview.reason) };
    }

    return {
      status: "applied",
      code: preview.code ?? code,
      discountCents: preview.discountCents,
    };
  } catch {
    return { status: "error", message: "Não foi possível aplicar este cupom agora." };
  }
}
