"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/admin/access-control";

/**
 * suspend/reactivate: a validação real (quem pode, o que "reactivate"
 * restaura) mora inteiramente em `platform_admin_set_store_status`
 * (SECURITY DEFINER) — este action só repassa a intenção e revalida a
 * página. Nunca aceita status arbitrário do cliente, só a ação (o RPC
 * decide o status de destino).
 */
export async function setStoreStatusAction(formData: FormData): Promise<void> {
  const storeId = String(formData.get("storeId") ?? "");
  const action = String(formData.get("action") ?? "");

  if (!storeId || (action !== "suspend" && action !== "reactivate")) {
    return;
  }

  const supabase = await createServerSupabaseClient();
  await requirePlatformAdmin(supabase);

  await supabase.rpc("platform_admin_set_store_status", {
    p_store_id: storeId,
    p_action: action,
  });

  revalidatePath("/admin");
}
