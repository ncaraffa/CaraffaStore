/**
 * Link `wa.me` a partir do WhatsApp salvo no onboarding, que pode vir em
 * formatos diferentes ("(11) 91234-5678", "+5511900000004"). Devolve null
 * quando o número não tem tamanho plausível — melhor exibir o texto puro
 * do que um link que abre uma conversa com o contato errado.
 */
export function whatsappHref(raw: string | null): string | null {
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  // 10 = fixo com DDD, 11 = celular com DDD (sem código do país ainda).
  const withCountry = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;

  // 12/13 = 55 + DDD + número. Fora disso não dá pra afirmar que é válido.
  if (withCountry.length !== 12 && withCountry.length !== 13) return null;

  return `https://wa.me/${withCountry}`;
}
