import type { Database } from "@/lib/supabase/types";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

export type OnboardingViewStep = "profile" | "store_name" | "slug" | "plan" | "review";

const STEP_ORDER: OnboardingViewStep[] = ["profile", "store_name", "slug", "plan", "review"];

/**
 * Primeiro passo com dados obrigatórios ainda ausentes — usado tanto
 * para "retomar no primeiro passo incompleto" quanto como o teto que
 * `resolveOnboardingView` nunca deixa `?step=` ultrapassar.
 */
export function furthestIncompleteStep(progress: OnboardingRow): OnboardingViewStep {
  if (!progress.merchant_name || !progress.whatsapp) return "profile";
  if (!progress.store_name) return "store_name";
  if (!progress.slug) return "slug";
  if (!progress.plan_code) return "plan";
  return "review";
}

/**
 * `requestedStep` (query `?step=`) só é honrado para VOLTAR a um passo
 * já alcançado (ex.: editar o slug depois de já ter escolhido o plano).
 * Nunca permite avançar além do primeiro passo incompleto — isso
 * continua bloqueado de qualquer forma pelas próprias funções SQL
 * (cada onboarding_save_* exige que os campos do passo anterior já
 * estejam preenchidos), esta função só evita mostrar um formulário que
 * o servidor rejeitaria de qualquer forma.
 */
export function resolveOnboardingView(
  progress: OnboardingRow,
  requestedStep?: string | null,
): OnboardingViewStep {
  const furthest = furthestIncompleteStep(progress);
  if (!requestedStep) return furthest;

  const reqIdx = STEP_ORDER.indexOf(requestedStep as OnboardingViewStep);
  const curIdx = STEP_ORDER.indexOf(furthest);
  if (reqIdx === -1) return furthest;

  return reqIdx <= curIdx ? (requestedStep as OnboardingViewStep) : furthest;
}
