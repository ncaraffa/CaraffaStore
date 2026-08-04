import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as catalog from "@/lib/catalog/service";
import { CartPageClient } from "./cart-page-client";

export const dynamic = "force-dynamic";

export default async function CartPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;

  const supabase = await createServerSupabaseClient();
  const store = await catalog.getPublicStore(supabase, storeSlug);
  if (!store) {
    notFound();
  }

  return <CartPageClient storeSlug={storeSlug} storeName={store.name} />;
}
