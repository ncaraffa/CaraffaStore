import type { ShippingRule } from "@/lib/supabase/types";

/**
 * Tradução entre o que as pessoas digitam/leem e o que o banco guarda.
 *
 * O banco é inteiro: dinheiro em CENTAVOS e CEP em 8 dígitos, sem
 * pontuação. Nem o lojista nem o comprador veem isso — eles escrevem
 * "10,00" e "79330-000". Toda a conversão vive aqui, num lugar só, para
 * que nenhuma tela invente a sua própria.
 *
 * A conversão de dinheiro é reaproveitada de lib/coupons/format.ts em
 * vez de reescrita: "R$ 20,00" tem que virar 2000 do mesmo jeito no
 * cupom e no frete, e duas implementações acabariam divergindo em algum
 * caso de borda (ponto de milhar, vírgula, prefixo).
 */
export { currencyToCents, centsToCurrencyInput } from "@/lib/coupons/format";

/**
 * Só os dígitos — espelha public.shipping_normalize_postal_code no
 * banco, inclusive em NÃO truncar.
 *
 * Truncar aqui faria um "793300001234" colado por engano virar um CEP
 * válido e DIFERENTE do que a pessoa colou, enquanto o banco recusaria o
 * mesmo valor. Frente e backend precisam concordar sobre o que é um CEP:
 * excesso de dígitos é entrada inválida, não entrada a ser consertada em
 * silêncio.
 */
export function normalizePostalCode(input: string): string {
  return input.replace(/\D/g, "");
}

export function isCompletePostalCode(input: string): boolean {
  return /^[0-9]{8}$/.test(normalizePostalCode(input));
}

/** 8 dígitos -> "79330-000". Entrada incompleta volta como está (o campo ainda está sendo digitado). */
export function formatPostalCode(input: string): string {
  const digits = normalizePostalCode(input);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/**
 * Normalização de cidade para comparação — espelha
 * public.shipping_normalize_city. Existe no cliente só para a tela poder
 * ANTECIPAR qual faixa provavelmente se aplica em textos de ajuda; a
 * decisão financeira é sempre a do banco.
 */
export function normalizeCity(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function normalizeState(input: string): string {
  return input.trim().toUpperCase().slice(0, 2);
}

export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export function isBrazilianState(input: string): boolean {
  return (BRAZILIAN_STATES as readonly string[]).includes(normalizeState(input));
}

/** "Corumbá - MS", ou null quando falta alguma das duas partes. */
export function formatCityState(city: string | null, state: string | null): string | null {
  if (!city || !state) return null;
  return `${city} - ${state}`;
}

/**
 * Como cada faixa é explicada ao lojista. `free` não aparece aqui como
 * "grátis" solto porque no painel a linha é o motivo, não o valor.
 */
export const SHIPPING_RULE_LABEL: Record<ShippingRule, string> = {
  free: "Frete grátis",
  same_city: "Mesma cidade",
  same_state: "Mesmo estado",
  other_state: "Outro estado",
};
