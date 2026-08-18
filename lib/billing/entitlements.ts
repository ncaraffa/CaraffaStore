import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { PlanKey } from "@/lib/billing/plans";

type Client = SupabaseClient<Database>;

/**
 * Leitura do uso vs. limite do plano, para os indicadores do painel e
 * para as mensagens de limite.
 *
 * IMPORTANTE — isto NÃO é autorização. Serve para a interface poder
 * esconder um botão, mostrar "42 / 75" e explicar um upgrade. Quem
 * recusa de fato uma criação acima da quota é sempre o banco
 * (catalog_create_product, catalog_add_product_image,
 * workspace_create_store), derivando o limite da assinatura no servidor.
 * Se esta camada mentir — ou for burlada no navegador — nada é liberado.
 */

export interface QuotaUsage {
  planKey: PlanKey;
  products: { used: number; limit: number };
  imagesPerProduct: { limit: number };
  stores: { used: number; limit: number };
  team: { used: number; limit: number };
  couponsEnabled: boolean;
}

export async function getStoreQuotaUsage(supabase: Client, storeId: string): Promise<QuotaUsage | null> {
  const { data, error } = await supabase.rpc("store_quota_usage", { p_store_id: storeId });
  const row = data?.[0];
  if (error || !row) return null;

  return {
    planKey: row.plan_key as PlanKey,
    products: { used: row.products_used, limit: row.products_limit },
    imagesPerProduct: { limit: row.images_per_product_limit },
    stores: { used: row.stores_used, limit: row.stores_limit },
    team: { used: row.team_used, limit: row.team_limit },
    couponsEnabled: row.coupons_enabled,
  };
}

/**
 * Pré-checagem consultiva antes de subir o arquivo, para não deixar
 * objeto órfão no Storage quando a vaga já acabou. A decisão real
 * continua sendo do banco no momento do insert — se a vaga for tomada
 * entre esta consulta e o insert, o insert recusa e o chamador remove o
 * objeto que acabou de enviar.
 */
export async function canAddProductImage(
  supabase: Client,
  productId: string,
): Promise<{ allowed: boolean; used: number; limit: number } | null> {
  const { data, error } = await supabase.rpc("catalog_can_add_product_image", { p_product_id: productId });
  const row = data?.[0];
  if (error || !row) return null;
  return { allowed: row.allowed, used: row.used, limit: row.image_limit };
}

export class CreateStoreError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CreateStoreError";
  }
}

/**
 * Cria a 2ª/3ª loja do comerciante. O workspace NUNCA é parâmetro — o
 * banco o deriva de auth.uid(), então não existe pedido possível que
 * crie loja na conta de outro comerciante.
 */
export async function createAdditionalStore(
  supabase: Client,
  params: { name: string; slug: string; whatsapp?: string | null },
): Promise<{ id: string; slug: string }> {
  const { data, error } = await supabase.rpc("workspace_create_store", {
    p_name: params.name,
    p_slug: params.slug,
    p_whatsapp: params.whatsapp ?? null,
  });

  if (error || !data) {
    throw new CreateStoreError(extractCode(error?.message));
  }
  return { id: data.id, slug: data.slug };
}

/**
 * O Postgres devolve a mensagem crua da RPC; aqui ela vira um código
 * fechado. Qualquer coisa inesperada cai em `unknown_error` em vez de
 * vazar detalhe interno do banco para a interface.
 */
function extractCode(message: string | undefined): string {
  if (!message) return "unknown_error";
  const known = [
    "max_stores_reached",
    "workspace_not_found",
    "subscription_not_found",
    "slug_taken",
    "invalid_name",
    "invalid_slug",
    "auth_required",
  ];
  return known.find((code) => message.includes(code)) ?? "unknown_error";
}
