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

function stateLabel(settings: PaymentSettingsView): { label: string; tone: BadgeTone; ready: boolean } {
  if (!settings.isConfigured) return { label: "Não configurado", tone: "neutral", ready: false };
  if (settings.lastErrorCode) return { label: "Erro na conexão", tone: "danger", ready: false };
  if (!settings.isEnabled) return { label: "Pix desativado", tone: "warning", ready: false };
  return { label: "Pronto para receber", tone: "success", ready: true };
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
      </div>

      {/* Status em destaque: a primeira coisa que o lojista precisa saber
          ao abrir esta tela é "está pronto para receber ou não". */}
      <div className={styles.statusHero} data-ready={status.ready || undefined}>
        <span className={styles.statusIcon}>{status.ready ? <IconCheck /> : <IconPix />}</span>
        <div className={styles.statusBody}>
          <span className={styles.statusLabel}>{status.label}</span>
          <span className={styles.statusCaption}>
            {!settings.isConfigured && "Cadastre suas credenciais do Mercado Pago para começar a receber."}
            {settings.isConfigured && settings.lastErrorCode && "A última verificação encontrou um problema — teste a conexão novamente."}
            {settings.isConfigured && !settings.lastErrorCode && !settings.isEnabled && "As credenciais estão salvas, mas o Pix ainda não está ativado nesta loja."}
            {status.ready && "Seus clientes já podem pagar por Pix nos pedidos desta loja."}
          </span>
        </div>
        {settings.isConfigured && (
          <form action={setPaymentEnabledAction} className={styles.statusToggle}>
            <input type="hidden" name="storeSlug" value={storeSlug} />
            <input type="hidden" name="isEnabled" value={(!settings.isEnabled).toString()} />
            <Button type="submit" variant={settings.isEnabled ? "outline" : "primary"} size="sm">
              {settings.isEnabled ? "Desativar Pix" : "Ativar Pix"}
            </Button>
          </form>
        )}
      </div>

      {/* Primeiros passos: só aparece antes de configurar — é exatamente
          o "o que fazer primeiro" que faltava. */}
      {!settings.isConfigured && (
        <Card className={styles.stepsCard}>
          <CardHeader title="Como configurar" />
          <ol className={styles.steps}>
            <li>
              <span>1</span>
              Acesse sua conta do Mercado Pago e gere um Access Token (produção ou teste).
            </li>
            <li>
              <span>2</span>
              Cole o Access Token e defina um Webhook Secret abaixo — os dois ficam criptografados.
            </li>
            <li>
              <span>3</span>
              Cadastre a URL de webhook desta loja no painel do Mercado Pago para receber confirmações automáticas.
            </li>
          </ol>
        </Card>
      )}

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
            <Input readOnly value={webhookUrl} onFocus={(event) => event.currentTarget.select()} className={styles.webhookInput} />
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

          <Button type="submit" size="lg" loading={pending} icon={<IconShield />}>
            {pending ? "Salvando..." : "Salvar credenciais"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
