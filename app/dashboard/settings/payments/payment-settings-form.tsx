"use client";

import { useActionState, useState } from "react";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { PaymentSettingsView } from "@/lib/payments/settings-service";
import { savePaymentSettingsAction, setPaymentEnabledAction, testPaymentConnectionAction } from "./actions";
import type { PaymentSettingsFormState } from "./actions";

function stateLabel(settings: PaymentSettingsView): { label: string; tone: "neutral" | "success" | "warning" | "danger" } {
  if (!settings.isConfigured) return { label: "Não configurado", tone: "neutral" };
  if (settings.lastErrorCode) return { label: "Erro", tone: "danger" };
  if (settings.credentialsVerifiedAt) return { label: "Validado", tone: "success" };
  return { label: "Configurado", tone: "warning" };
}

export function PaymentSettingsForm({
  storeSlug,
  settings,
  webhookUrl,
}: {
  storeSlug: string;
  settings: PaymentSettingsView;
  webhookUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    savePaymentSettingsAction,
    IDLE_ACTION_STATE as PaymentSettingsFormState,
  );
  const [copied, setCopied] = useState(false);
  const status = stateLabel(settings);

  return (
    <section>
      <p>
        Estado: <span className="badge" data-tone={status.tone}>{status.label}</span>
      </p>

      {settings.isConfigured && (
        <section className="order-detail-info">
          <p>
            <strong>Access Token:</strong> {settings.accessTokenPreview}
          </p>
          <p>
            <strong>Ambiente:</strong> {settings.environment === "production" ? "Produção" : "Teste"}
          </p>
          <p>
            <strong>Pix:</strong> {settings.isEnabled ? "Ativado" : "Desativado"}
          </p>
          {settings.credentialsVerifiedAt && (
            <p>
              <strong>Validado em:</strong> {new Date(settings.credentialsVerifiedAt).toLocaleString("pt-BR")}
            </p>
          )}
          {settings.lastErrorCode && (
            <p>
              <strong>Último erro:</strong> {settings.lastErrorCode}
            </p>
          )}
        </section>
      )}

      {webhookUrl && (
        <div className="form-field">
          <label htmlFor="webhookUrl">URL do Webhook (cole no painel do Mercado Pago)</label>
          <input id="webhookUrl" readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(webhookUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copiado!" : "Copiar URL"}
          </button>
        </div>
      )}

      {settings.isConfigured && (
        <div className="table-actions">
          <form action={testPaymentConnectionAction}>
            <input type="hidden" name="storeSlug" value={storeSlug} />
            <button type="submit">Testar conexão</button>
          </form>
          <form action={setPaymentEnabledAction}>
            <input type="hidden" name="storeSlug" value={storeSlug} />
            <input type="hidden" name="isEnabled" value={(!settings.isEnabled).toString()} />
            <button type="submit">{settings.isEnabled ? "Desativar Pix" : "Ativar Pix"}</button>
          </form>
        </div>
      )}

      <h2>{settings.isConfigured ? "Substituir credenciais" : "Configurar Mercado Pago"}</h2>
      <form action={formAction} noValidate>
        <input type="hidden" name="storeSlug" value={storeSlug} />

        {state.status === "error" && state.message && (
          <p className="form-status" data-tone="error" role="alert">
            {state.message}
          </p>
        )}

        <div className="form-field">
          <label htmlFor="environment">Ambiente</label>
          <select id="environment" name="environment" defaultValue={settings.environment ?? "test"} required>
            <option value="test">Teste</option>
            <option value="production">Produção</option>
          </select>
          {state.fieldErrors?.environment && <small role="alert">{state.fieldErrors.environment}</small>}
        </div>

        <div className="form-field">
          <label htmlFor="accessToken">Access Token</label>
          <input id="accessToken" name="accessToken" type="password" autoComplete="off" required minLength={10} />
          {state.fieldErrors?.accessToken && <small role="alert">{state.fieldErrors.accessToken}</small>}
        </div>

        <div className="form-field">
          <label htmlFor="webhookSecret">Webhook Secret</label>
          <input id="webhookSecret" name="webhookSecret" type="password" autoComplete="off" required minLength={10} />
          {state.fieldErrors?.webhookSecret && <small role="alert">{state.fieldErrors.webhookSecret}</small>}
        </div>

        <button type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Salvar credenciais"}
        </button>
      </form>
    </section>
  );
}
