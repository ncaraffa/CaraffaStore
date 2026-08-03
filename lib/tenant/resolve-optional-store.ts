import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { SupabaseStoreRepository } from "@/lib/data/supabase-repository";
import { ForbiddenTenantError, resolveAuthorizedStore } from "@/lib/tenant/context";

/**
 * Usado pelas páginas de estado (pending-payment/suspended/dashboard)
 * que aceitam um `?store=slug` opcional só para exibir o nome. O slug
 * NUNCA é usado como prova de autorização por si só — resolveAuthorizedStore
 * revalida `auth.uid()` × `store_members` (com RLS por trás) antes de
 * qualquer dado ser lido; um slug forjado/sem vínculo é redirecionado
 * para o seletor, nunca vaza se a loja existe ou não (mesma mensagem
 * genérica de ForbiddenTenantError).
 */
export async function resolveOptionalStoreName(
  supabase: SupabaseClient<Database>,
  userId: string,
  storeSlug: string | undefined,
): Promise<string | null> {
  if (!storeSlug) return null;

  const repository = new SupabaseStoreRepository(supabase);
  try {
    await resolveAuthorizedStore({ repository, userId, requestedStoreSlug: storeSlug });
  } catch (error) {
    if (error instanceof ForbiddenTenantError) {
      redirect("/select-store");
    }
    throw error;
  }

  const store = await repository.getStoreBySlug(storeSlug);
  return store?.name ?? null;
}
