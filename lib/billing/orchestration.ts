import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, BillingChargeStatus, PixDocType, PlanCode } from "@/lib/supabase/types";
import { createPaymentsServiceClient } from "@/lib/payments/service-only/client";
import { getPlatformPaymentCredentials } from "@/lib/payments/service-only/platform-credentials";
import { getPixPaymentGateway } from "@/lib/payments/gateway";
import { MercadoPagoGatewayError } from "@/lib/payments/gateway/mercado-pago";
import { absoluteUrl } from "@/lib/auth/site-url";

type Client = SupabaseClient<Database>;
type BillingChargeRow = Database["public"]["Tables"]["billing_charges"]["Row"];

/**
 * Orquestra a cobrança de assinatura da PRÓPRIA CaraffaStore ao
 * comerciante — nunca confundir com lib/payments/checkout-orchestration.ts
 * (a loja do comerciante cobrando o cliente final). Credenciais sempre de
 * lib/payments/service-only/platform-credentials.ts (variável de
 * ambiente do processo, nunca store_payment_settings).
 */
export class BillingCheckoutError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "BillingCheckoutError";
    this.code = code;
  }
}

export interface BillingChargeParams {
  storeId: string;
  payerEmail: string;
  payerDocType: PixDocType;
  payerDocNumber: string;
  /**
   * TASK-011 — plano escolhido para ESTA cobrança (renovação com
   * upgrade/downgrade). Ausente = mantém o plano vigente da loja. Nunca
   * carrega preço: `billing_charge_upsert_creating` deriva o valor de
   * `platform_plan_price_cents` no banco a partir deste código, e um
   * código fora de (30, 50, 80) vira `invalid_plan_code`. A troca só
   * passa a valer em `store_plans` quando o pagamento é aprovado.
   */
  planCode?: PlanCode | null;
}

export interface BillingChargeResult {
  id: string;
  status: BillingChargeStatus;
  /** Sempre 30/50/80 — a coluna tem check constraint fechada (0008_saas_billing.sql), então o tipo estreito é fiel ao banco e evita cast em quem consome (getPlatformPlan). */
  planCode: PlanCode;
  amountCents: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
  periodStart: string;
  periodEnd: string;
}

/** X-Idempotency-Key só importa quando o banco decide inserir uma linha nova (billing_charge_upsert_creating reaproveita por store_id, não por esta chave) — aleatória por tentativa é suficiente. Máx. 64 caracteres. */
function buildProviderIdempotencyKey(storeId: string): string {
  return `plat-${storeId.replace(/-/g, "")}-${randomBytes(6).toString("hex")}`.slice(0, 64);
}

export function mapBillingChargeRowToResult(charge: BillingChargeRow): BillingChargeResult {
  return {
    id: charge.id,
    status: charge.status,
    planCode: charge.plan_code,
    amountCents: charge.amount_cents,
    qrCode: charge.qr_code,
    qrCodeBase64: charge.qr_code_base64,
    ticketUrl: charge.ticket_url,
    expiresAt: charge.expires_at,
    periodStart: charge.period_start,
    periodEnd: charge.period_end,
  };
}

function mapRpcErrorToBillingCode(message: string | undefined): string {
  const text = message ?? "";
  if (text.includes("store_not_billable")) return "store_not_billable";
  if (text.includes("plan_not_selected")) return "plan_not_selected";
  if (text.includes("invalid_plan_code")) return "invalid_plan_code";
  if (text.includes("invalid_payer_document")) return "invalid_payer_document";
  if (text.includes("invalid_payer_email")) return "invalid_payer_email";
  if (text.includes("store_not_found")) return "store_not_found";
  return "billing_charge_failed";
}

/**
 * Cria (ou reaproveita) a cobrança de assinatura em aberto da loja.
 * Sempre chama `billing_charge_upsert_creating` primeiro: se já existir
 * uma cobrança `creating`/`pending` não expirada, o banco a devolve sem
 * inserir outra (índice único parcial por store_id) — só chama o
 * Mercado Pago quando a linha volta como `creating` de verdade (recém-
 * inserida nesta chamada), nunca em refresh/duplo clique/duas abas.
 */
export async function createPlatformBillingCharge(params: BillingChargeParams): Promise<BillingChargeResult> {
  const serviceClient = createPaymentsServiceClient();
  // Só uma CANDIDATA a chave — o banco só a persiste se de fato inserir
  // uma linha nova. Se `billing_charge_upsert_creating` devolver uma
  // cobrança já existente (reaproveitada), `charge.provider_idempotency_key`
  // abaixo é a única fonte de verdade a partir daqui: usar esta variável
  // local depois deste ponto duplicaria a X-Idempotency-Key enviada ao
  // Mercado Pago entre duas execuções concorrentes/retry da mesma
  // cobrança local (QA-FINAL-001).
  const candidateIdempotencyKey = buildProviderIdempotencyKey(params.storeId);

  const { data: charge, error: upsertError } = await serviceClient.rpc("billing_charge_upsert_creating", {
    p_store_id: params.storeId,
    p_provider_idempotency_key: candidateIdempotencyKey,
    p_payer_email: params.payerEmail,
    p_payer_doc_type: params.payerDocType,
    p_payer_doc_last4: params.payerDocNumber.slice(-4),
    p_plan_code: params.planCode ?? null,
  });

  if (upsertError || !charge) {
    throw new BillingCheckoutError(mapRpcErrorToBillingCode(upsertError?.message));
  }

  // Única fonte de verdade da chave a partir daqui — pode ser a
  // candidata acima (linha nova) ou a chave persistida de uma cobrança
  // `creating` reaproveitada (retry após timeout/erro transitório).
  const providerIdempotencyKey = charge.provider_idempotency_key;

  if (charge.status !== "creating") {
    // Reaproveitada (já enviada ao provedor antes, ou ainda pendente) —
    // nunca chama o Mercado Pago de novo pra ela.
    return mapBillingChargeRowToResult(charge);
  }

  let credentials;
  try {
    credentials = getPlatformPaymentCredentials();
  } catch {
    await serviceClient.rpc("billing_charge_mark_creation_failed", {
      p_charge_id: charge.id,
      p_error_code: "platform_billing_not_configured",
    });
    throw new BillingCheckoutError("platform_billing_not_configured");
  }

  const gateway = getPixPaymentGateway();
  const notificationUrl = absoluteUrl("/api/webhooks/platform-billing");

  try {
    const providerPayment = await gateway.createPayment({
      credentials: { accessToken: credentials.accessToken, environment: credentials.environment },
      idempotencyKey: providerIdempotencyKey,
      amountCents: charge.amount_cents,
      externalReference: charge.external_reference,
      payerEmail: params.payerEmail,
      payerDocType: params.payerDocType,
      payerDocNumber: params.payerDocNumber,
      description: `Assinatura CaraffaStore — plano ${charge.plan_code}`,
      notificationUrl,
    });

    const { data: created, error: markCreatedError } = await serviceClient.rpc("billing_charge_mark_created", {
      p_charge_id: charge.id,
      p_provider_payment_id: providerPayment.providerPaymentId,
      p_provider_status: providerPayment.status,
      p_provider_status_detail: providerPayment.statusDetail,
      p_qr_code: providerPayment.qrCode,
      p_qr_code_base64: providerPayment.qrCodeBase64,
      p_ticket_url: providerPayment.ticketUrl,
      p_expires_at: providerPayment.expiresAt,
    });

    if (markCreatedError || !created) {
      throw new BillingCheckoutError("billing_charge_failed");
    }

    return mapBillingChargeRowToResult(created);
  } catch (error) {
    if (error instanceof MercadoPagoGatewayError && error.transient) {
      // Erro transitório (timeout/5xx): mantém `creating` para retry com
      // a MESMA idempotency key — nunca marca falha definitiva por isso.
      throw new BillingCheckoutError("payment_provider_unavailable");
    }

    if (error instanceof BillingCheckoutError) {
      throw error;
    }

    const errorCode = error instanceof MercadoPagoGatewayError ? error.code : "billing_charge_creation_failed";
    await serviceClient.rpc("billing_charge_mark_creation_failed", {
      p_charge_id: charge.id,
      p_error_code: errorCode,
    });
    throw new BillingCheckoutError("billing_charge_creation_failed");
  }
}

/**
 * Leitura sanitizada da cobrança atual da loja — via a sessão do próprio
 * usuário (RLS + `is_store_member`, `billing_get_current_charge` é
 * concedida só a `authenticated`, nunca a `service_role`). Usada pela
 * tela pending-payment para exibir o QR sem repetir side effects a cada
 * carregamento de página.
 */
export async function getCurrentPlatformBillingCharge(supabase: Client, storeId: string): Promise<BillingChargeResult | null> {
  const { data, error } = await supabase.rpc("billing_get_current_charge", { p_store_id: storeId });
  const row = data?.[0];
  if (error || !row) return null;

  return {
    id: row.id,
    status: row.status,
    planCode: row.plan_code,
    amountCents: row.amount_cents,
    qrCode: row.qr_code,
    qrCodeBase64: row.qr_code_base64,
    ticketUrl: row.ticket_url,
    expiresAt: row.expires_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  };
}
