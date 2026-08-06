"use client";

import { useActionState, useState } from "react";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { PaymentSettingsView } from "@/lib/payments/settings-service";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { IconCopy, IconCheck, IconPix, IconShield } from "@/components/ui/icons";
import { savePaymentSettingsAction, setPaymentEnabledAction, testPaymentConnectionAction } from "./actions";
import type { PaymentSettingsFormState } from "./actions";
import styles from "./payment-settings-form.module.css";

function stateLabel(settings: PaymentSettingsView): { label: string; tone: BadgeTone } {
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
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Pagamentos</h1>
          <p className={styles.subtitle}>Configure o Pix da sua loja via Mercado Pago.</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {settings.isConfigured && (
        <Card>
          <CardHeader
            title="Integração Mercado Pago"
            description="Estado atual da conexão desta loja com o provedor de pagamentos."
          />

          <dl className={styles.infoGrid}>
            <div>
              <dt>Ambiente</dt>
              <dd>
                <Badge tone={settings.environment === "production" ? "info" : "neutral"}>
                  {settings.environment === "production" ? "Produção" : "Teste"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Pix</dt>
              <dd>
                <Badge tone={settings.isEnabled ? "success" : "neutral"}>
                  {settings.isEnabled ? "Ativado" : "Desativado"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Access Token</dt>
              <dd className={styles.mono}>{settings.accessTokenPreview}</dd>
            </div>
            <div>
              <dt>Conexão verificada</dt>
              <dd>
                {settings.credentialsVerifiedAt ? (
                  <span className={styles.verified}>
                    <IconCheck />
                    {new Date(settings.credentialsVerifiedAt).toLocaleString("pt-BR")}
                  </span>
                ) : (
                  <span className={styles.textMuted}>Ainda não testada</span>
                )}
              </dd>
            </div>
          </dl>

          {settings.lastErrorCode && (
            <div className={styles.errorAlert}>
              <Alert tone="danger" title="Último erro registrado">
                {settings.lastErrorCode}
              </Alert>
            </div>
          )}

          <div className={styles.actionsRow}>
            <form action={testPaymentConnectionAction}>
              <input type="hidden" name="storeSlug" value={storeSlug} />
              <Button type="submit" variant="outline">
                Testar conexão
              </Button>
            </form>
            <form action={setPaymentEnabledAction}>
              <input type="hidden" name="storeSlug" value={storeSlug} />
              <input type="hidden" name="isEnabled" value={(!settings.isEnabled).toString()} />
              <Button type="submit" variant={settings.isEnabled ? "outline" : "primary"} icon={<IconPix />}>
                {settings.isEnabled ? "Desativar Pix" : "Ativar Pix"}
              </Button>
            </form>
          </div>
        </Card>
      )}

      {webhookUrl && (
        <Card>
          <CardHeader
            title="URL do Webhook"
            description="Cadastre esta URL no painel do Mercado Pago para receber notificações de pagamento."
          />
          <div className={styles.webhookRow}>
            <Input readOnly value={webhookUrl} onFocus={(event) => event.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              icon={<IconCopy />}
              onClick={async () => {
                await navigator.clipboard.writeText(webhookUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copiado!" : "Copiar URL"}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title={settings.isConfigured ? "Substituir credenciais" : "Configurar Mercado Pago"}
          description="As credenciais são criptografadas antes de serem salvas — nunca exibidas por completo depois."
        />

        <Alert tone="info" title="Segurança">
          Access Token e Webhook Secret nunca são exibidos completos depois de salvos. Preencha os dois campos abaixo
          somente para cadastrar ou substituir as credenciais.
        </Alert>

        <form action={formAction} noValidate className={styles.form}>
          <input type="hidden" name="storeSlug" value={storeSlug} />

          {state.status === "error" && state.message && (
            <Alert tone="danger">{state.message}</Alert>
          )}

          <Field label="Ambiente" htmlFor="environment" required>
            <Select id="environment" name="environment" defaultValue={settings.environment ?? "test"} required>
              <option value="test">Teste</option>
              <option value="production">Produção</option>
            </Select>
          </Field>
          {state.fieldErrors?.environment && <p className={styles.fieldError}>{state.fieldErrors.environment}</p>}

          <Field label="Access Token" htmlFor="accessToken" required error={state.fieldErrors?.accessToken}>
            <Input id="accessToken" name="accessToken" type="password" autoComplete="off" required minLength={10} />
          </Field>

          <Field label="Webhook Secret" htmlFor="webhookSecret" required error={state.fieldErrors?.webhookSecret}>
            <Input id="webhookSecret" name="webhookSecret" type="password" autoComplete="off" required minLength={10} />
          </Field>

          <Button type="submit" loading={pending} icon={<IconShield />}>
            {pending ? "Salvando..." : "Salvar credenciais"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
