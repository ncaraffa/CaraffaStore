"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { advanceOrderStatus, cancelOrder, getOrderById } from "@/lib/orders/service";
import { cancelPixOrder, reconcileOrderPayment } from "@/lib/payments/admin-actions";
import type { OrderStatus } from "@/lib/supabase/types";

export async function advanceOrderStatusAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  const newStatus = String(formData.get("newStatus") ?? "") as OrderStatus;

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await advanceOrderStatus(supabase, orderId, newStatus);
  } catch {
    // Transição inválida/papel insuficiente/pagamento não aprovado: banco já recusou, nada a desfazer.
  }
  redirect(`/dashboard/orders/${orderId}?store=${storeSlug}`);
}

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const orderId = String(formData.get("orderId") ?? "");

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  const order = await getOrderById(supabase, orderId);
  try {
    if (order?.payment_mode === "pix") {
      await cancelPixOrder(orderId);
    } else {
      await cancelOrder(supabase, orderId);
    }
  } catch {
    // idem.
  }
  redirect(`/dashboard/orders/${orderId}?store=${storeSlug}`);
}

export async function reconcileOrderPaymentAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const orderId = String(formData.get("orderId") ?? "");

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await reconcileOrderPayment(orderId);
  } catch {
    // idem.
  }
  redirect(`/dashboard/orders/${orderId}?store=${storeSlug}`);
}
