import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, StoreRole, StoreStatus } from "@/lib/supabase/types";
import type { Store } from "@/lib/data/repository";
import { SupabaseStoreRepository } from "@/lib/data/supabase-repository";
import { ForbiddenTenantError, resolveAuthorizedStore } from "@/lib/tenant/context";
import { resolveMembershipSituation } from "@/lib/tenant/membership";
import { storeStatusRedirectPath } from "@/lib/tenant/store-redirect";
import { isCurrentSessionRecovery } from "@/lib/tenant/recovery-session";

type Client = SupabaseClient<Database>;

export interface AccessSession {
  userId: string;
}

/**
 * ÚNICA porta de entrada para "quem é esse usuário e em que condição ele
 * está", usada por TODA página/Server Action protegida — dashboard,
 * pending-payment, suspended, onboarding, select-store, reset-password.
 * Antes essas checagens estavam espalhadas e incompletas por página
 * (qa/reports/TASK-002.md, BUG-T2-001/002); agora vivem num único lugar,
 * e nenhuma página deve reimplementar esta sequência.
 *
 * Defesa em profundidade: o proxy.ts (middleware) já faz uma checagem
 * rápida equivalente para otimizar o redirecionamento antes mesmo de
 * renderizar a página, mas NUNCA é a única barreira — esta função roda
 * de novo, sempre, dentro da própria página/Server Action, mesmo que o
 * middleware tenha algum bug ou seja contornado.
 */
export async function requireVerifiedSession(supabase: Client): Promise<AccessSession> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }
  if (!user.email_confirmed_at) {
    redirect("/verify");
  }
  if (await isCurrentSessionRecovery(supabase)) {
    redirect("/reset-password");
  }

  return { userId: user.id };
}

export interface StoreAccess {
  store: Store;
  role: StoreRole;
}

/**
 * Para páginas que exigem uma loja com status EXATO (`/dashboard` →
 * `active`, `/pending-payment` → `pending_payment`, `/suspended` →
 * `suspended`). Sem `?store=` na URL, resolve pela situação real de
 * memberships do usuário — nunca libera acesso "genérico" só porque o
 * parâmetro está ausente (era exatamente esse o BUG-T2-001: páginas sem
 * `store` pulavam a validação de estado inteiramente).
 *
 * Alterar a URL/slug/parâmetro nunca muda o resultado: o status vem
 * sempre de uma consulta fresca ao banco (RLS + `auth.uid()` ×
 * `store_members`), nunca de nada que o cliente afirme.
 */
export async function requireStoreStatus(
  supabase: Client,
  requiredStatus: StoreStatus,
  requestedSlug?: string,
): Promise<StoreAccess> {
  const session = await requireVerifiedSession(supabase);
  const access = await resolveAuthorizedAccess(supabase, session.userId, requestedSlug);

  if (access.store.status !== requiredStatus) {
    redirect(storeStatusRedirectPath(access.store.status, access.store.slug));
  }

  return access;
}

/**
 * Para `/onboarding`: aceita só usuário sem loja alguma OU loja no
 * próprio status `onboarding` — qualquer outro status manda o usuário
 * para o destino correto em vez de reexibir o assistente.
 */
export async function requireOnboardingAccess(supabase: Client): Promise<AccessSession> {
  const session = await requireVerifiedSession(supabase);
  const situation = await resolveMembershipSituation(supabase, session.userId);

  if (situation.kind === "none") {
    return session;
  }
  if (situation.kind === "multiple") {
    redirect("/select-store");
  }
  if (situation.store.status !== "onboarding") {
    redirect(storeStatusRedirectPath(situation.store.status, situation.store.slug));
  }

  return session;
}

async function resolveAuthorizedAccess(
  supabase: Client,
  userId: string,
  requestedSlug: string | undefined,
): Promise<StoreAccess> {
  if (requestedSlug) {
    const repository = new SupabaseStoreRepository(supabase);
    try {
      const context = await resolveAuthorizedStore({
        repository,
        userId,
        requestedStoreSlug: requestedSlug,
      });
      const store = await repository.getStoreBySlug(requestedSlug);
      if (!store) {
        redirect("/select-store");
      }
      return { store, role: context.role };
    } catch (error) {
      if (error instanceof ForbiddenTenantError) {
        redirect("/select-store");
      }
      throw error;
    }
  }

  const situation = await resolveMembershipSituation(supabase, userId);
  if (situation.kind === "none") {
    redirect("/onboarding");
  }
  if (situation.kind === "multiple") {
    redirect("/select-store");
  }
  return { store: situation.store, role: situation.role };
}
