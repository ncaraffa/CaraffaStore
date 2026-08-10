"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { encryptSecret } from "@/lib/payments/crypto";
import { maskAccessToken } from "@/lib/payments/token-preview";
import {
  PaymentSettingsError,
  markPaymentSettingsVerified,
  savePaymentSettings,
  setPaymentSettingsEnabled,
} from "@/lib/payments/settings-service";
import { getStorePaymentCredentials } from "@/lib/payments/service-only/credentials-reader";
import { getPixPaymentGateway } from "@/lib/payments/gateway";

export interface PaymentSettingsFormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
}

const MESSAGES: Record<string, string> = {
  insufficient_privilege: "Você não tem permissão para configurar pagamentos desta loja.",
  invalid_environment: "Selecione um ambiente válido.",
  invalid_access_token: "Informe o Access Token.",
  invalid_webhook_secret: "Informe o Webhook Secret.",
  payment_settings_not_found: "Configure as credenciais primeiro.",
};

function messageFor(code: string): string {
  return MESSAGES[code] ?? "Não foi possível concluir. Tente novamente.";
}

export async function savePaymentSettingsAction(
  _prev: PaymentSettingsFormState,
  formData: FormData,
): Promise<PaymentSettingsFormState> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const environment = String(formData.get("environment") ?? "");
  const accessToken = String(formData.get("accessToken") ?? "").trim();
  const webhookSecret = String(formData.get("webhookSecret") ?? "").trim();

  if (environment !== "test" && environment !== "production") {
    return { status: "error", fieldErrors: { environment: "Selecione um ambiente válido." } };
  }
  if (accessToken.length < 10) {
    return { status: "error", fieldErrors: { accessToken: "Informe um Access Token válido." } };
  }
  if (webhookSecret.length < 10) {
    return { status: "error", fieldErrors: { webhookSecret: "Informe um Webhook Secret válido." } };
  }

  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await savePaymentSettings(supabase, {
      storeId: store.id,
      environment,
      encryptedAccessToken: encryptSecret(accessToken),
      encryptedWebhookSecret: encryptSecret(webhookSecret),
      accessTokenPreview: maskAccessToken(accessToken),
    });
  } catch (error) {
    const code = error instanceof PaymentSettingsError ? error.code : "unknown_error";
    return { status: "error", message: messageFor(code) };
  }

  redirect(`/dashboard/settings/payments?store=${store.slug}`);
}

export async function setPaymentEnabledAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");
  const isEnabled = String(formData.get("isEnabled") ?? "") === "true";

  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  try {
    await setPaymentSettingsEnabled(supabase, store.id, isEnabled);
  } catch {
    // RPC já recusa se não configurado/sem permissão — nada a desfazer.
  }
  redirect(`/dashboard/settings/payments?store=${store.slug}`);
}

export async function testPaymentConnectionAction(formData: FormData): Promise<void> {
  const storeSlug = String(formData.get("storeSlug") ?? "");

  const supabase = await createServerSupabaseClient();
  const { store, role } = await requireStoreStatus(supabase, "active", storeSlug);

  /**
   * getStorePaymentCredentials usa service_role e descriptografa a
   * credencial da loja — diferente de savePaymentSettingsAction/
   * setPaymentEnabledAction, que só chamam RPCs SECURITY DEFINER que já
   * reautorizam sozinhas (payment_settings_upsert/set_enabled). Esta
   * action pula essas RPCs e vai direto ao leitor service-role, então
   * precisa da MESMA checagem de can_manage_store_payments (owner/admin)
   * feita aqui, antes de qualquer leitura/chamada externa — nunca depois
   * (TASK008-RETEST-SEC-001).
   */
  if (role !== "owner" && role !== "admin") {
    redirect(`/dashboard?store=${store.slug}`);
  }

  const credentials = await getStorePaymentCredentials(store.id);
  if (!credentials) {
    redirect(`/dashboard/settings/payments?store=${store.slug}`);
  }

  const gateway = getPixPaymentGateway();
  const result = await gateway.validateCredentials({
    accessToken: credentials.accessToken,
    environment: credentials.environment,
  });

  try {
    await markPaymentSettingsVerified(supabase, { storeId: store.id, ok: result.ok, errorCode: result.errorCode });
  } catch {
    // idem.
  }
  redirect(`/dashboard/settings/payments?store=${store.slug}`);
}
