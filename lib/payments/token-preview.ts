import "server-only";

/**
 * Mascara um Access Token para exibição no painel (ex.: "APP_USR-••••1234")
 * — calculado UMA vez ao salvar e guardado em texto puro
 * (store_payment_settings.access_token_preview); o valor completo nunca
 * volta ao navegador depois de salvo. Não é sensível por si só: revela só
 * o prefixo público de formato (ex. "APP_USR") e os últimos 4 caracteres,
 * insuficiente para reconstruir o token.
 */
export function maskAccessToken(rawToken: string): string {
  const trimmed = rawToken.trim();
  const dashIndex = trimmed.indexOf("-");
  const prefix = dashIndex > 0 && dashIndex <= 12 ? trimmed.slice(0, dashIndex) : trimmed.slice(0, 4);
  const last4 = trimmed.slice(-4);
  return `${prefix}-••••${last4}`;
}
