import { z } from "zod";

/**
 * Mesmo formato exigido pela constraint de banco
 * (categories_slug_format/products_slug_format,
 * supabase/migrations/0005_catalog.sql) — minúsculas, dígitos e
 * hífens simples, nunca no início/fim nem repetidos. Validar aqui
 * primeiro só evita uma viagem ao banco para um erro óbvio; a
 * constraint continua sendo a fonte de verdade.
 */
const catalogSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Informe um endereço.")
  .max(120, "Endereço muito longo.")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use apenas letras minúsculas, números e hífen simples.");

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Informe um nome.").max(120, "Nome muito longo."),
  slug: catalogSlugSchema,
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  displayOrder: z.coerce.number().int().min(0).max(10000).default(0),
});

export const categoryActiveSchema = z.object({
  isActive: z.coerce.boolean(),
});

/** Preço digitado em reais (ex.: "19,90" ou "19.90") convertido para centavos. */
export const priceToCentsSchema = z
  .string()
  .trim()
  .min(1, "Informe um preço.")
  .transform((value, ctx) => {
    const normalized = value.replace(/\./g, "").replace(",", ".");
    const asNumber = Number(normalized);
    if (!Number.isFinite(asNumber) || asNumber < 0) {
      ctx.addIssue({ code: "custom", message: "Preço inválido." });
      return z.NEVER;
    }
    return Math.round(asNumber * 100);
  });

export const productSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome.").max(200, "Nome muito longo."),
  slug: catalogSlugSchema,
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  priceCents: priceToCentsSchema,
  sku: z
    .string()
    .trim()
    .max(64, "SKU muito longo.")
    .optional()
    .or(z.literal("")),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  stock: z.coerce.number().int().min(0, "Estoque não pode ser negativo.").max(1_000_000),
});

export const productEditSchema = productSchema.omit({ stock: true });

export const stockAdjustSchema = z.object({
  delta: z.coerce
    .number()
    .int()
    .refine((value) => value !== 0, "Informe uma quantidade diferente de zero."),
  reason: z.string().trim().min(2, "Informe um motivo.").max(200, "Motivo muito longo."),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
});

export const MAX_PRODUCT_IMAGES = 5;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
