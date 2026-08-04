import { CatalogError } from "./service";

const MESSAGES: Record<string, string> = {
  insufficient_privilege: "Você não tem permissão para esta ação.",
  invalid_name: "Informe um nome válido.",
  invalid_slug: "Endereço inválido. Use letras minúsculas, números e hífen.",
  invalid_price: "Informe um preço válido.",
  invalid_stock: "Informe uma quantidade em estoque válida.",
  invalid_delta: "Informe uma quantidade diferente de zero.",
  invalid_status: "Status inválido.",
  invalid_direction: "Ação inválida.",
  invalid_storage_path: "Falha ao processar o arquivo enviado.",
  reason_required: "Informe o motivo do ajuste de estoque.",
  slug_taken: "Este endereço já está em uso nesta loja.",
  slug_or_sku_taken: "Endereço ou SKU já está em uso nesta loja.",
  category_not_found: "Categoria não encontrada.",
  category_store_mismatch: "Categoria não pertence a esta loja.",
  product_not_found: "Produto não encontrado.",
  image_not_found: "Imagem não encontrada.",
  image_store_mismatch: "Imagem não pertence a este produto.",
  max_images_reached: "Limite de 5 imagens por produto atingido.",
  stock_would_be_negative: "Estoque insuficiente para este ajuste.",
};

export const FIELD_LEVEL_CODES = new Set([
  "invalid_name",
  "invalid_slug",
  "invalid_price",
  "invalid_stock",
  "invalid_delta",
  "reason_required",
  "slug_taken",
  "slug_or_sku_taken",
]);

export function messageForCatalogError(error: unknown): string {
  if (error instanceof CatalogError) {
    return MESSAGES[error.code] ?? "Não foi possível concluir. Tente novamente.";
  }
  return "Não foi possível concluir. Tente novamente.";
}
