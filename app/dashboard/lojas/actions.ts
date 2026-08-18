"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { createAdditionalStore, CreateStoreError } from "@/lib/billing/entitlements";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";

export interface CreateStoreState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  createdSlug?: string;
}

const createStoreSchema = z.object({
  name: z.string().trim().min(2, "Informe um nome válido.").max(120, "Nome muito longo."),
  slug: z
    .string()
    .trim()
    .min(1, "Informe o endereço da loja.")
    .max(120, "Endereço muito longo.")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífen."),
  whatsapp: z.string().trim().optional(),
});

const MESSAGES: Record<string, string> = {
  max_stores_reached: "Você atingiu o limite de lojas do seu plano.",
  workspace_not_found: "Não foi possível identificar sua conta. Fale com o suporte.",
  subscription_not_found: "Não foi possível identificar sua assinatura. Fale com o suporte.",
  slug_taken: "Este endereço já está em uso. Escolha outro.",
  invalid_name: "Informe um nome válido.",
  invalid_slug: "Endereço inválido. Use letras minúsculas, números e hífen.",
  auth_required: "Sua sessão expirou. Faça login novamente.",
  unknown_error: "Não foi possível criar a loja. Tente novamente.",
};

const FIELD_LEVEL_CODES = new Set(["slug_taken", "invalid_slug", "invalid_name"]);

/**
 * Cria a 2ª/3ª loja do comerciante sem refazer o onboarding da conta.
 *
 * O limite NÃO é decidido aqui. Esta action valida formato e repassa;
 * quem conta lojas e recusa a excedente é workspace_create_store no
 * banco, com o workspace travado e derivado de auth.uid(). Mesmo que
 * alguém chame esta Server Action diretamente, ou poste o formulário
 * fora da tela, o resultado é o mesmo max_stores_reached.
 */
export async function createStoreAction(
  _prev: CreateStoreState,
  formData: FormData,
): Promise<CreateStoreState> {
  const parsed = createStoreSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    whatsapp: String(formData.get("whatsapp") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();

  // Confirma que há sessão e loja ativa antes de qualquer escrita — o
  // caminho normal do painel. A autorização real da criação continua no
  // banco.
  await requireStoreStatus(supabase, ["active"]);

  try {
    const store = await createAdditionalStore(supabase, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      whatsapp: parsed.data.whatsapp || null,
    });

    revalidatePath("/dashboard/lojas");
    revalidatePath("/select-store");
    return { status: "success", createdSlug: store.slug };
  } catch (error) {
    const code = error instanceof CreateStoreError ? error.code : "unknown_error";
    const message = MESSAGES[code] ?? "Não foi possível criar a loja. Tente novamente.";
    if (FIELD_LEVEL_CODES.has(code)) {
      return { status: "error", fieldErrors: { slug: message } };
    }
    return { status: "error", message };
  }
}
