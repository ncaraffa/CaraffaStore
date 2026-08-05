import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Espelha o `code` de erro levantado pelas funções SQL payment_settings_*
 * (`raise exception 'codigo' using errcode = ...`) — nunca inventado no
 * TypeScript, sempre vindo de `error.message` do RPC. Mesmo padrão de
 * lib/catalog/service.ts:CatalogError / lib/orders/service.ts:OrderError.
 */
export class PaymentSettingsError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "PaymentSettingsError";
    this.code = code;
  }
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) {
    throw new PaymentSettingsError(result.error.message);
  }
  if (result.data === null || result.data === undefined) {
    throw new PaymentSettingsError("unexpected_empty_result");
  }
  return result.data;
}

export interface PaymentSettingsView {
  isConfigured: boolean;
  environment: "test" | "production" | null;
  isEnabled: boolean;
  credentialsVerifiedAt: string | null;
  lastErrorCode: string | null;
  accessTokenPreview: string | null;
  webhookKey: string | null;
}

function toView(row: {
  is_configured: boolean;
  environment: string | null;
  is_enabled: boolean;
  credentials_verified_at: string | null;
  last_error_code: string | null;
  access_token_preview: string | null;
  webhook_key: string | null;
}): PaymentSettingsView {
  return {
    isConfigured: row.is_configured,
    environment: (row.environment as "test" | "production" | null) ?? null,
    isEnabled: row.is_enabled,
    credentialsVerifiedAt: row.credentials_verified_at,
    lastErrorCode: row.last_error_code,
    accessTokenPreview: row.access_token_preview,
    webhookKey: row.webhook_key,
  };
}

export async function getPaymentSettings(supabase: Client, storeId: string): Promise<PaymentSettingsView> {
  const { data, error } = await supabase.rpc("payment_settings_get", { p_store_id: storeId });
  if (error) throw new PaymentSettingsError(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new PaymentSettingsError("unexpected_empty_result");
  return toView(row);
}

export async function savePaymentSettings(
  supabase: Client,
  params: {
    storeId: string;
    environment: "test" | "production";
    encryptedAccessToken: string;
    encryptedWebhookSecret: string;
    accessTokenPreview: string;
  },
): Promise<void> {
  unwrap(
    await supabase.rpc("payment_settings_upsert", {
      p_store_id: params.storeId,
      p_environment: params.environment,
      p_encrypted_access_token: params.encryptedAccessToken,
      p_encrypted_webhook_secret: params.encryptedWebhookSecret,
      p_access_token_preview: params.accessTokenPreview,
    }),
  );
}

export async function setPaymentSettingsEnabled(supabase: Client, storeId: string, isEnabled: boolean): Promise<void> {
  unwrap(await supabase.rpc("payment_settings_set_enabled", { p_store_id: storeId, p_is_enabled: isEnabled }));
}

export async function markPaymentSettingsVerified(
  supabase: Client,
  params: { storeId: string; ok: boolean; errorCode?: string },
): Promise<void> {
  unwrap(
    await supabase.rpc("payment_settings_mark_verified", {
      p_store_id: params.storeId,
      p_ok: params.ok,
      p_error_code: params.errorCode ?? null,
    }),
  );
}
