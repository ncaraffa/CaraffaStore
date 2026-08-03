import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { storeStatusRedirectPath } from "./store-redirect";

export interface DestinationResult {
  path: string;
  storeSlug?: string;
  membershipCount: number;
}

/**
 * Onde um usuário autenticado e verificado deve ser levado, com base em
 * quantas lojas ele pode acessar. `store_members` é sempre lido através
 * do cliente com sessão do usuário (RLS: `user_id = auth.uid()`) — nunca
 * um `userId` arbitrário passado por parâmetro de rota/body. Espelha a
 * matriz de redirecionamento aprovada (tasks/in-progress/task-002.md,
 * "Redirecionamentos e proteção de rotas"): sem loja → onboarding;
 * múltiplas lojas → seletor explícito, nunca a primeira silenciosamente;
 * uma loja → destino conforme o status dela.
 */
export async function resolveUserDestination(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<DestinationResult> {
  const { data: memberships, error: membershipError } = await supabase
    .from("store_members")
    .select("store_id")
    .eq("user_id", userId);

  if (membershipError || !memberships || memberships.length === 0) {
    return { path: "/onboarding", membershipCount: 0 };
  }

  if (memberships.length > 1) {
    return { path: "/select-store", membershipCount: memberships.length };
  }

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("status, slug")
    .eq("id", memberships[0]!.store_id)
    .maybeSingle();

  if (storeError || !store) {
    // Membership existe mas a loja não resolveu (não deveria acontecer,
    // FK garante integridade) — cai para onboarding em vez de quebrar.
    return { path: "/onboarding", membershipCount: 1 };
  }

  return {
    path: storeStatusRedirectPath(store.status, store.slug),
    storeSlug: store.slug,
    membershipCount: 1,
  };
}
