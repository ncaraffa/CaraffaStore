import { createHash } from "node:crypto";

/**
 * Hash não reversível de um identificador (e-mail, etc.) para uso em
 * chaves internas (rate limiting, correlação) sem guardar o valor em
 * texto puro. Normaliza (trim + minúsculas) antes de gerar o hash, para
 * que variações de capitalização/espaço produzam a mesma chave.
 */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}
