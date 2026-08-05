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
  const cipher = createCipheriv(ALGORITHM, key, iv);
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

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
