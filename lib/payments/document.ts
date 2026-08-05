/**
 * Validação de CPF/CNPJ (dígitos verificadores reais, algoritmo padrão
 * da Receita Federal) — usada no checkout para exigir um documento
 * plausível antes de enviar ao Mercado Pago (que também valida do seu
 * lado; isto é uma primeira barreira no servidor, nunca confiada como
 * única fonte de verdade sobre validade fiscal real).
 */

export type DocType = "CPF" | "CNPJ";

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function isAllSameDigit(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

function calculateCpfCheckDigit(base: string, weightStart: number): number {
  let sum = 0;
  for (let i = 0; i < base.length; i += 1) {
    sum += Number(base[i]) * (weightStart - i);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(digits: string): boolean {
  if (digits.length !== 11 || isAllSameDigit(digits)) return false;
  const d1 = calculateCpfCheckDigit(digits.slice(0, 9), 10);
  const d2 = calculateCpfCheckDigit(digits.slice(0, 9) + d1, 11);
  return digits === digits.slice(0, 9) + String(d1) + String(d2);
}

function calculateCnpjCheckDigit(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < base.length; i += 1) {
    sum += Number(base[i]) * (weights[i] ?? 0);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(digits: string): boolean {
  if (digits.length !== 14 || isAllSameDigit(digits)) return false;
  const d1 = calculateCnpjCheckDigit(digits.slice(0, 12));
  const d2 = calculateCnpjCheckDigit(digits.slice(0, 12) + d1);
  return digits === digits.slice(0, 12) + String(d1) + String(d2);
}

export interface ParsedDocument {
  type: DocType;
  digits: string;
}

/** Deriva o tipo pelo tamanho (11 = CPF, 14 = CNPJ) e valida o dígito verificador. Retorna null se inválido. */
export function parseDocument(raw: string): ParsedDocument | null {
  const digits = onlyDigits(raw);
  if (digits.length === 11 && isValidCpf(digits)) {
    return { type: "CPF", digits };
  }
  if (digits.length === 14 && isValidCnpj(digits)) {
    return { type: "CNPJ", digits };
  }
  return null;
}
