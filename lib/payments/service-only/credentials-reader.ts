import "server-only";
import { createPaymentsServiceClient } from "./client";
import { decryptSecret } from "@/lib/payments/crypto";
import type { PixPaymentEnvironment } from "@/lib/supabase/types";

export interface StorePaymentCredentials {
  storeId: string;
  accessToken: string;
  webhookSecret: string;
  webhookKey: string;
  environment: PixPaymentEnvironment;
  isEnabled: boolean;
}

/**
 * Único lugar que descriptografa credenciais de pagamento para uso real
 * (testar conexão, criar cobrança, validar webhook, reconciliar) — sempre
 * via o cliente service_role dedicado (nunca a sessão RLS do usuário,
 * que não enxerga esta tabela). O valor descriptografado vive só na
 * memória desta requisição, nunca é logado nem devolvido ao chamador além
 * do necessário.
 */
export async function getStorePaymentCredentials(storeId: string): Promise<StorePaymentCredentials | null> {
  const client = createPaymentsServiceClient();
  const { data, error } = await client
    .from("store_payment_settings")
    .select("store_id, environment, encrypted_access_token, encrypted_webhook_secret, webhook_key, is_enabled")
    .eq("store_id", storeId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    storeId: data.store_id,
    accessToken: decryptSecret(data.encrypted_access_token),
    webhookSecret: decryptSecret(data.encrypted_webhook_secret),
    webhookKey: data.webhook_key,
    environment: data.environment,
    isEnabled: data.is_enabled,
  };
}

export async function getStorePaymentCredentialsByWebhookKey(webhookKey: string): Promise<StorePaymentCredentials | null> {
  const client = createPaymentsServiceClient();
  const { data, error } = await client
    .from("store_payment_settings")
    .select("store_id, environment, encrypted_access_token, encrypted_webhook_secret, webhook_key, is_enabled")
    .eq("webhook_key", webhookKey)
    .maybeSingle();

  if (error || !data) return null;

  return {
    storeId: data.store_id,
    accessToken: decryptSecret(data.encrypted_access_token),
    webhookSecret: decryptSecret(data.encrypted_webhook_secret),
    webhookKey: data.webhook_key,
    environment: data.environment,
    isEnabled: data.is_enabled,
  };
}
