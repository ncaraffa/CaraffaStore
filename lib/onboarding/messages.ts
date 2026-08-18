import { OnboardingError } from "./service";

const MESSAGES: Record<string, string> = {
  auth_required: "Sua sessão expirou. Faça login novamente.",
  email_not_verified: "Confirme seu e-mail antes de continuar.",
  already_has_store: "Você já tem uma loja.",
  max_stores_reached: "Limite de lojas do seu plano atingido.",
  workspace_not_found: "Não foi possível identificar sua conta. Fale com o suporte.",
  subscription_not_found: "Não foi possível identificar sua assinatura. Fale com o suporte.",
  onboarding_not_started: "Não foi possível carregar seu progresso. Recomece o onboarding.",
  onboarding_already_completed: "Seu onboarding já foi concluído.",
  invalid_merchant_name: "Informe um nome válido.",
  invalid_whatsapp: "Informe um WhatsApp válido.",
  profile_required: "Preencha seus dados antes de continuar.",
  invalid_store_name: "Informe um nome de loja válido.",
  store_name_required: "Defina o nome da loja antes de continuar.",
  invalid_slug: "Endereço inválido. Use letras, números e hífen.",
  reserved_slug: "Este endereço é reservado. Escolha outro.",
  slug_taken: "Este endereço já está em uso. Escolha outro.",
  invalid_plan: "Selecione um plano válido.",
  slug_required: "Defina o endereço da loja antes de continuar.",
  onboarding_incomplete: "Complete todas as etapas antes de finalizar.",
};

/** Códigos que fazem sentido como erro de um campo específico do formulário. */
export const FIELD_LEVEL_CODES = new Set([
  "invalid_merchant_name",
  "invalid_whatsapp",
  "invalid_store_name",
  "invalid_slug",
  "reserved_slug",
  "slug_taken",
  "invalid_plan",
]);

export function onboardingErrorMessage(code: string): string {
  return MESSAGES[code] ?? "Não foi possível concluir. Tente novamente.";
}

export function messageForOnboardingError(error: unknown): string {
  if (error instanceof OnboardingError) {
    return onboardingErrorMessage(error.code);
  }
  return "Não foi possível concluir. Tente novamente.";
}
