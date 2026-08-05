import "server-only";
import { decryptWithKey, encryptWithKey, getEncryptionKeyFromEnv } from "./crypto-core";

/**
 * Criptografia autenticada (AES-256-GCM) das credenciais de pagamento
 * (store_payment_settings.encrypted_access_token/encrypted_webhook_secret,
 * supabase/migrations/0007_payments.sql). `import "server-only"` faz o
 * build inteiro falhar caso este módulo seja alcançado por um Client
 * Component — mesmo padrão de lib/supabase/service-only/*.
 *
 * O Postgres NUNCA vê o valor em texto puro nem a chave: só guarda e
 * devolve o texto cifrado gerado aqui. A chave vive só em
 * PAYMENT_ENCRYPTION_KEY (variável de ambiente do processo Next.js,
 * nunca NEXT_PUBLIC_, nunca commitada) — sem chave, toda operação falha
 * (nunca um fallback silencioso para "sem criptografia").
 *
 * O algoritmo em si vive em lib/payments/crypto-core.ts (sem a barreira
 * server-only) só para ser testável em `npm test` — ver o comentário lá.
 */

export function encryptSecret(plaintext: string): string {
  return encryptWithKey(plaintext, getEncryptionKeyFromEnv(process.env.PAYMENT_ENCRYPTION_KEY));
}

export function decryptSecret(encoded: string): string {
  return decryptWithKey(encoded, getEncryptionKeyFromEnv(process.env.PAYMENT_ENCRYPTION_KEY));
}
