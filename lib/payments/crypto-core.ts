import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Implementação pura (sem `server-only`) da criptografia autenticada
 * AES-256-GCM usada pelas credenciais de pagamento. Separada de
 * lib/payments/crypto.ts (que reexporta este módulo por trás da barreira
 * `server-only`) só para permitir teste real de comportamento — o pacote
 * `server-only` lança em qualquer ambiente fora do runtime "react-server"
 * do Next.js, inclusive no Vitest (node puro), então testar aqui e reexpor
 * lá é o único jeito de cobrir o algoritmo de verdade em `npm test`.
 * lib/payments/crypto.test.ts cobre a barreira `server-only` em si por
 * análise estática, mesmo padrão de lib/supabase/service-only/*.test.ts.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/**
 * Tamanho da authentication tag do GCM, em bytes (128 bits — o máximo e o
 * único valor que usamos).
 *
 * Fixar isto explicitamente nos dois lados é uma exigência de segurança,
 * não estética. Sem a opção `authTagLength`, `createDecipheriv` aceita
 * QUALQUER tamanho de tag válido para GCM (4, 8, 12, 13, 14, 15 ou 16
 * bytes) — quem controlasse o valor gravado poderia trocar a tag de 16
 * bytes por uma de 4 e reduzir a força da verificação de 2^128 para 2^32,
 * o que torna forjar um ciphertext viável. Passando o tamanho esperado, o
 * Node recusa de saída qualquer tag que não tenha exatamente 16 bytes.
 *
 * Compatível com o que já está gravado: 16 bytes sempre foi o padrão do
 * Node no `getAuthTag()`, então todo valor existente no banco já tem uma
 * tag desse tamanho e continua sendo lido sem migração.
 */
const AUTH_TAG_BYTES = 16;

export function getEncryptionKeyFromEnv(raw: string | undefined): Buffer {
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      "PAYMENT_ENCRYPTION_KEY ausente. Defina uma chave de 32 bytes (base64) nesta variável de ambiente antes de configurar ou ler credenciais de pagamento — nunca em NEXT_PUBLIC_, nunca commitada.",
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("PAYMENT_ENCRYPTION_KEY inválida: não é base64 válido.");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `PAYMENT_ENCRYPTION_KEY inválida: esperado ${KEY_BYTES} bytes (base64 de uma chave AES-256), recebido ${key.length}.`,
    );
  }

  return key;
}

/** Formato: `<iv base64>:<authTag base64>:<ciphertext base64>`. IV aleatório a cada chamada. */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptWithKey(encoded: string, key: Buffer): string {
  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Valor criptografado malformado.");
  }
  const [ivB64, tagB64, ciphertextB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  // Conferidos antes de chegar ao `node:crypto`: um IV de tamanho
  // diferente muda o modo como o GCM deriva o contador, e uma tag mais
  // curta enfraqueceria a verificação (ver AUTH_TAG_BYTES). Recusar aqui
  // dá erro claro em vez de depender do comportamento interno do Node.
  if (iv.length !== IV_BYTES) {
    throw new Error("Valor criptografado malformado: IV com tamanho inesperado.");
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("Valor criptografado malformado: authentication tag com tamanho inesperado.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
