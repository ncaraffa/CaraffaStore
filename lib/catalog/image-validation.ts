import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_SIZE_BYTES } from "@/lib/catalog/schemas";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface ImageValidationError {
  code: "empty" | "too_large" | "invalid_type";
  message: string;
}

/**
 * Validação server-side do arquivo recebido — nunca confia só no
 * `accept` do `<input type="file">` (fácil de contornar). MIME type é
 * checado contra o valor reportado pelo navegador (defesa de primeira
 * camada); a constraint `allowed_mime_types` do bucket Storage
 * (supabase/migrations/0005_catalog.sql) é a segunda camada, aplicada
 * pelo próprio serviço de Storage no upload.
 */
export function validateProductImageFile(file: File): ImageValidationError | null {
  if (!file || file.size === 0) {
    return { code: "empty", message: "Selecione um arquivo de imagem." };
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { code: "too_large", message: "Imagem maior que 5 MB." };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_MIME_TYPES)[number])) {
    return { code: "invalid_type", message: "Use apenas JPEG, PNG ou WebP." };
  }
  return null;
}

export function extensionForMimeType(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? "bin";
}

/** Caminho convencionado exigido por catalog_add_product_image e pelas policies de storage.objects. */
export function buildProductImagePath(storeId: string, productId: string, mimeType: string): string {
  const ext = extensionForMimeType(mimeType);
  const filename = `${crypto.randomUUID()}.${ext}`;
  return `${storeId}/${productId}/${filename}`;
}
