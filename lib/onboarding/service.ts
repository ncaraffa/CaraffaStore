import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PlanCode } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;
type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];
type StoreRow = Database["public"]["Tables"]["stores"]["Row"];

/**
 * Espelha o `code` de erro levantado pelas funções SQL (`raise exception
 * 'codigo' using errcode = ...`) — ver
 * supabase/migrations/0002_auth_onboarding.sql. O código do erro nunca
 * é inventado no TypeScript; vem sempre de `error.message` do RPC.
 */
export class OnboardingError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "OnboardingError";
    this.code = code;
  }
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) {
    throw new OnboardingError(result.error.message);
  }
  if (result.data === null) {
    throw new OnboardingError("unexpected_empty_result");
  }
  return result.data;
}

/**
 * Cria (se necessário) e devolve o progresso do onboarding do usuário
 * atual. A própria função SQL exige e-mail verificado e nenhuma loja
 * própria existente — ver onboarding_ensure_progress() na migração.
 */
export async function ensureOnboardingProgress(supabase: Client): Promise<OnboardingRow> {
  return unwrap(await supabase.rpc("onboarding_ensure_progress"));
}

export async function saveProfile(
  supabase: Client,
  merchantName: string,
  whatsapp: string,
): Promise<OnboardingRow> {
  return unwrap(
    await supabase.rpc("onboarding_save_profile", {
      p_merchant_name: merchantName,
      p_whatsapp: whatsapp,
    }),
  );
}

export async function saveStoreName(supabase: Client, storeName: string): Promise<OnboardingRow> {
  return unwrap(await supabase.rpc("onboarding_save_store_name", { p_store_name: storeName }));
}

export async function saveSlug(supabase: Client, slug: string): Promise<OnboardingRow> {
  return unwrap(await supabase.rpc("onboarding_save_slug", { p_slug: slug }));
}

export async function savePlan(supabase: Client, planCode: PlanCode): Promise<OnboardingRow> {
  return unwrap(await supabase.rpc("onboarding_save_plan", { p_plan_code: planCode }));
}

export async function completeOnboarding(supabase: Client): Promise<StoreRow> {
  return unwrap(await supabase.rpc("onboarding_complete"));
}

export async function isSlugAvailable(supabase: Client, slug: string): Promise<boolean> {
  return unwrap(await supabase.rpc("is_slug_available", { p_slug: slug }));
}
