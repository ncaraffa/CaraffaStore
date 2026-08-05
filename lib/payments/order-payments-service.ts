import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;
type OrderPaymentRow = Database["public"]["Tables"]["order_payments"]["Row"];

export interface PaymentEventView {
  action: string;
  processingStatus: string;
  receivedAt: string;
  processedAt: string | null;
  errorCode: string | null;
}

export async function getOrderPayment(supabase: Client, orderId: string): Promise<OrderPaymentRow | null> {
  const { data, error } = await supabase.from("order_payments").select("*").eq("order_id", orderId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listOrderPaymentsForStore(supabase: Client, storeId: string): Promise<OrderPaymentRow[]> {
  const { data, error } = await supabase.from("order_payments").select("*").eq("store_id", storeId);
  if (error) throw error;
  return data ?? [];
}

export async function listPaymentEvents(supabase: Client, orderId: string): Promise<PaymentEventView[]> {
  const { data, error } = await supabase.rpc("payment_events_list_sanitized", { p_order_id: orderId });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    action: row.action,
    processingStatus: row.processing_status,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    errorCode: row.error_code,
  }));
}
