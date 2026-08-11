const MESSAGES: Record<string, string> = {
  store_not_found: "Loja não encontrada.",
  store_not_billable: "Esta loja não está em uma situação que permite gerar cobrança.",
  plan_not_selected: "Nenhum plano foi selecionado ainda. Volte ao onboarding para escolher um plano.",
  invalid_plan_code: "Plano inválido. Fale com o suporte.",
  invalid_payer_document: "Informe um CPF ou CNPJ válido.",
  invalid_payer_email: "Informe um e-mail válido.",
  platform_billing_not_configured: "O pagamento de assinaturas está temporariamente indisponível. Tente novamente mais tarde.",
  payment_provider_unavailable: "O sistema de pagamento está indisponível no momento. Tente novamente em instantes.",
  billing_charge_creation_failed: "Não foi possível gerar a cobrança Pix. Tente novamente.",
  billing_charge_failed: "Não foi possível gerar a cobrança Pix. Tente novamente.",
};

export const FIELD_LEVEL_CODES: Record<string, string> = {
  invalid_payer_document: "payerDocument",
  invalid_payer_email: "payerEmail",
};

function hasErrorCode(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "string";
}

export function messageForBillingError(error: unknown): string {
  if (hasErrorCode(error)) {
    return MESSAGES[error.code] ?? "Não foi possível concluir. Tente novamente.";
  }
  return "Não foi possível concluir. Tente novamente.";
}
