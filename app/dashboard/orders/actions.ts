"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { advanceOrderStatus, cancelOrder } from "@/lib/orders/service";
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
    // Transição inválida/papel insuficiente: banco já recusou, nada a desfazer.
  }
  redirect(`/dashboard/orders/${orderId}?store=${storeSlug}`);
}

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const orderId = String(formData.get("orderId") ?? "");

  const supabase = await createServerSupabaseClient();
  await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await cancelOrder(supabase, orderId);
  } catch {
    // idem.
  }
  redirect(`/dashboard/orders/${orderId}?store=${storeSlug}`);
}
