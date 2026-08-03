import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, StoreRole, StoreStatus } from "@/lib/supabase/types";
import { storeStatusRedirectPath } from "./store-redirect";

export interface MembershipStore {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus;
}

export type MembershipSituation =
  | { kind: "none" }
  | { kind: "multiple"; count: number }
  | { kind: "one"; store: MembershipStore; role: StoreRole };

/**
 * Única fonte de verdade sobre "quantas lojas este usuário pode acessar
 * e em que estado" — usada por app/page.tsx (resolveUserDestination) E
 * por lib/tenant/access-control.ts (guards de página). Antes cada página
 * repetia essa lógica de forma incompleta (qa/reports/TASK-002.md,
 * BUG-T2-001); agora existe um único lugar.
 *
 * `store_members` é sempre lido através do cliente com sessão do usuário
 * (RLS: `user_id = auth.uid()`) — nunca um `userId` arbitrário vindo de
 * parâmetro de rota/body sem que a própria sessão já garanta que é o
 * usuário autenticado.
 */
export async function resolveMembershipSituation(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<MembershipSituation> {
  const { data: memberships, error: membershipError } = await supabase
    .from("store_members")
    .select("store_id, role")
    .eq("user_id", userId);

  if (membershipError || !memberships || memberships.length === 0) {
    return { kind: "none" };
  }

  if (memberships.length > 1) {
    return { kind: "multiple", count: memberships.length };
  }

  const membership = memberships[0]!;
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, slug, name, status")
    .eq("id", membership.store_id)
    .maybeSingle();

  if (storeError || !store) {
    // Membership existe mas a loja não resolveu (não deveria acontecer,
    // FK garante integridade) — trata como "sem loja" em vez de quebrar.
    return { kind: "none" };
  }

  return { kind: "one", store, role: membership.role };
}

export interface DestinationResult {
  path: string;
  storeSlug?: string;
  membershipCount: number;
}

/**
 * Matriz de redirecionamento aprovada (docs/handoff.md,
 * "Matriz de estados e redirecionamentos"): sem loja → onboarding;
 * múltiplas lojas → seletor explícito, nunca a primeira silenciosamente;
 * uma loja → destino conforme o status dela. Usado só pelo resolvedor
 * central (`app/page.tsx`) — páginas de estado específico usam
 * `lib/tenant/access-control.ts`, que exige o status exato, não apenas
 * "para onde mandar".
 */
export async function resolveUserDestination(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<DestinationResult> {
  const situation = await resolveMembershipSituation(supabase, userId);

  if (situation.kind === "none") {
    return { path: "/onboarding", membershipCount: 0 };
  }
  if (situation.kind === "multiple") {
    return { path: "/select-store", membershipCount: situation.count };
  }

  return {
    path: storeStatusRedirectPath(situation.store.status, situation.store.slug),
    storeSlug: situation.store.slug,
    membershipCount: 1,
  };
}
