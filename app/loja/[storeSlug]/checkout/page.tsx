import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as catalog from "@/lib/catalog/service";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;

  const supabase = await createServerSupabaseClient();
  const store = await catalog.getPublicStore(supabase, storeSlug);
  if (!store) {
    notFound();
  }

  return <CheckoutForm storeSlug={storeSlug} storeName={store.name} />;
}
