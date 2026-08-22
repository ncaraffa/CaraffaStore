import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as catalog from "@/lib/catalog/service";
import { quoteShipping } from "@/lib/shipping/service";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;

  const supabase = await createServerSupabaseClient();
  const store = await catalog.getPublicStore(supabase, storeSlug);
  if (!store) {
    notFound();
  }

  /**
   * TASK-013 — a página não conhece o carrinho (ele vive no
   * localStorage), mas precisa saber, já na primeira pintura, se esta
   * loja pede endereço estruturado ou o endereço livre de sempre.
   * shipping_quote com carrinho vazio responde exatamente isso, sem
   * expor a configuração de frete da loja ao comprador e sem inventar
   * uma segunda RPC só para essa pergunta.
   *
   * Uma falha aqui não pode derrubar o checkout: sem resposta, cai no
   * caminho legado, que continua sendo validado pelo banco no envio.
   */
  let shippingEnabled = false;
  try {
    const quote = await quoteShipping(supabase, { storeSlug, items: [] });
    shippingEnabled = quote.shippingEnabled;
  } catch {
    shippingEnabled = false;
  }

  return <CheckoutForm storeSlug={storeSlug} storeName={store.name} shippingEnabled={shippingEnabled} />;
}
