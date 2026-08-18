"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { saveCoupon, CouponError } from "@/lib/coupons/service";
import { merchantCouponMessage } from "@/lib/coupons/messages";
import { currencyToCents, percentToBasisPoints, normalizeCodeForDisplay } from "@/lib/coupons/format";

export interface CouponFormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Converte a data que o comerciante escolhe (input date, sem fuso) para
 * um instante inequívoco.
 *
 * O projeto guarda timestamptz; um `2026-12-25` cru seria interpretado
 * como meia-noite UTC, o que no Brasil (UTC-3) significa 21h do dia 24 —
 * o cupom expiraria três horas antes do que o lojista quis. Por isso a
 * data final vira o FIM do dia escolhido no horário de Brasília, e a
 * inicial vira o começo.
 */
const BRASILIA_OFFSET = "-03:00";

function startOfDayBrasilia(value: string | null): string | null {
  if (!value) return null;
  return `${value}T00:00:00${BRASILIA_OFFSET}`;
}

function endOfDayBrasilia(value: string | null): string | null {
  if (!value) return null;
  return `${value}T23:59:59${BRASILIA_OFFSET}`;
}

export async function saveCouponAction(
  _prev: CouponFormState,
  formData: FormData,
): Promise<CouponFormState> {
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, ["active"]);

  const code = normalizeCodeForDisplay(String(formData.get("code") ?? ""));
  const discountType = String(formData.get("discountType") ?? "") as "percentage" | "fixed_amount";
  const rawValue = String(formData.get("discountValue") ?? "");

  const fieldErrors: Record<string, string> = {};

  if (!code) fieldErrors.code = "O código é obrigatório.";
  else if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    fieldErrors.code = "Use de 3 a 32 caracteres: letras, números, hífen ou underscore.";
  }

  if (discountType !== "percentage" && discountType !== "fixed_amount") {
    fieldErrors.discountType = "Selecione o tipo de desconto.";
  }

  const discountValue =
    discountType === "percentage" ? percentToBasisPoints(rawValue) : currencyToCents(rawValue);
  if (discountValue === null || discountValue <= 0) {
    fieldErrors.discountValue =
      discountType === "percentage"
        ? "Informe um percentual entre 0,01 e 100."
        : "Informe um valor maior que zero.";
  }

  const minimumRaw = String(formData.get("minimumOrder") ?? "").trim();
  const minimumOrderCents = minimumRaw ? currencyToCents(minimumRaw) : null;
  if (minimumRaw && minimumOrderCents === null) fieldErrors.minimumOrder = "Informe um valor válido.";

  const maximumRaw = String(formData.get("maximumDiscount") ?? "").trim();
  const maximumDiscountCents =
    discountType === "percentage" && maximumRaw ? currencyToCents(maximumRaw) : null;
  if (discountType === "percentage" && maximumRaw && maximumDiscountCents === null) {
    fieldErrors.maximumDiscount = "Informe um valor válido.";
  }

  const startsAtRaw = String(formData.get("startsAt") ?? "").trim() || null;
  const expiresAtRaw = String(formData.get("expiresAt") ?? "").trim() || null;
  if (startsAtRaw && expiresAtRaw && startsAtRaw > expiresAtRaw) {
    fieldErrors.expiresAt = "A data final deve ser posterior à data inicial.";
  }

  const maxUsesRaw = String(formData.get("maxUses") ?? "").trim();
  let maxUses: number | null = null;
  if (maxUsesRaw) {
    const parsed = Number(maxUsesRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      fieldErrors.maxUses = "O limite de utilizações deve ser maior que zero.";
    } else {
      maxUses = parsed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors };
  }

  try {
    // O entitlement do plano, a unicidade do código e todas as regras de
    // validade são verificados no banco — esta validação é só para o
    // comerciante ver o erro antes de ir e voltar.
    await saveCoupon(supabase, store.id, {
      couponId: String(formData.get("couponId") ?? "") || null,
      code,
      discountType,
      discountValue: discountValue!,
      minimumOrderCents,
      maximumDiscountCents,
      startsAt: startOfDayBrasilia(startsAtRaw),
      expiresAt: endOfDayBrasilia(expiresAtRaw),
      maxUses,
      active: formData.get("active") !== null,
    });
  } catch (error) {
    const code = error instanceof CouponError ? error.code : null;
    return { status: "error", message: merchantCouponMessage(code) };
  }

  revalidatePath("/dashboard/marketing/cupons");
  return { status: "success", message: "Cupom salvo." };
}

/** Ativar/desativar direto da listagem. */
export async function toggleCouponAction(
  _prev: CouponFormState,
  formData: FormData,
): Promise<CouponFormState> {
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, ["active"]);

  try {
    await saveCoupon(supabase, store.id, {
      couponId: String(formData.get("couponId") ?? ""),
      code: String(formData.get("code") ?? ""),
      discountType: String(formData.get("discountType") ?? "") as "percentage" | "fixed_amount",
      discountValue: Number(formData.get("discountValue") ?? 0),
      minimumOrderCents: formData.get("minimumOrderCents")
        ? Number(formData.get("minimumOrderCents"))
        : null,
      maximumDiscountCents: formData.get("maximumDiscountCents")
        ? Number(formData.get("maximumDiscountCents"))
        : null,
      startsAt: String(formData.get("startsAt") ?? "") || null,
      expiresAt: String(formData.get("expiresAt") ?? "") || null,
      maxUses: formData.get("maxUses") ? Number(formData.get("maxUses")) : null,
      active: String(formData.get("nextActive") ?? "") === "true",
    });
  } catch (error) {
    const code = error instanceof CouponError ? error.code : null;
    return { status: "error", message: merchantCouponMessage(code) };
  }

  revalidatePath("/dashboard/marketing/cupons");
  return { status: "success" };
}
