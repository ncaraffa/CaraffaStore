import "server-only";
import type {
  CreatePixPaymentParams,
  MercadoPagoCredentials,
  PixPaymentGateway,
  ProviderPaymentState,
  ValidateCredentialsResult,
} from "./types";

/**
 * Implementação real — POST https://api.mercadopago.com/v1/payments
 * (checkout transparente, payment_method_id "pix"). server-only: nunca
 * pode ser alcançado por um Client Component (faria o Access Token da
 * loja passar perto do bundle do navegador). Só chamada por módulos
 * server-only (lib/payments/checkout-orchestration.ts, o webhook e a
 * reconciliação) — nunca a partir de uma Server Action que recebe input
 * ainda não validado.
 */

const API_BASE = "https://api.mercadopago.com";

interface MercadoPagoPaymentResponse {
  id: number | string;
  status: string;
  status_detail: string | null;
  transaction_amount: number;
  currency_id: string;
  payment_method_id: string | null;
  external_reference: string | null;
  date_created: string | null;
  date_of_expiration: string | null;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string | null;
      qr_code_base64?: string | null;
      ticket_url?: string | null;
    };
  };
}

function toProviderPaymentState(data: MercadoPagoPaymentResponse): ProviderPaymentState {
  const transactionData = data.point_of_interaction?.transaction_data;
  return {
    providerPaymentId: String(data.id),
    status: data.status,
    statusDetail: data.status_detail ?? null,
    amountCents: Math.round(data.transaction_amount * 100),
    currency: data.currency_id,
    paymentMethodId: data.payment_method_id ?? null,
    externalReference: data.external_reference ?? null,
    qrCode: transactionData?.qr_code ?? null,
    qrCodeBase64: transactionData?.qr_code_base64 ?? null,
    ticketUrl: transactionData?.ticket_url ?? null,
    createdAt: data.date_created ?? null,
    expiresAt: data.date_of_expiration ?? null,
  };
}

/** Nunca inclui o Access Token na mensagem de erro nem em nenhum log. */
export class MercadoPagoGatewayError extends Error {
  code: string;
  transient: boolean;
  constructor(code: string, transient: boolean) {
    super(code);
    this.name = "MercadoPagoGatewayError";
    this.code = code;
    this.transient = transient;
  }
}

async function mercadoPagoFetch(
  path: string,
  credentials: MercadoPagoCredentials,
  init: { method: string; body?: unknown; idempotencyKey?: string },
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.accessToken}`,
    "Content-Type": "application/json",
  };
  if (init.idempotencyKey) {
    headers["X-Idempotency-Key"] = init.idempotencyKey;
  }

  return fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

export class MercadoPagoPixGateway implements PixPaymentGateway {
  async validateCredentials(credentials: MercadoPagoCredentials): Promise<ValidateCredentialsResult> {
    try {
      const response = await mercadoPagoFetch("/v1/payment_methods", credentials, { method: "GET" });
      if (response.ok) {
        return { ok: true };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, errorCode: "invalid_credentials" };
      }
      return { ok: false, errorCode: `provider_error_${response.status}` };
    } catch {
      return { ok: false, errorCode: "provider_unreachable" };
    }
  }

  async createPayment(params: CreatePixPaymentParams): Promise<ProviderPaymentState> {
    let response: Response;
    try {
      response = await mercadoPagoFetch("/v1/payments", params.credentials, {
        method: "POST",
        idempotencyKey: params.idempotencyKey,
        body: {
          transaction_amount: params.amountCents / 100,
          description: params.description,
          payment_method_id: "pix",
          payer: {
            email: params.payerEmail,
            identification: {
              type: params.payerDocType,
              number: params.payerDocNumber,
            },
          },
          external_reference: params.externalReference,
          notification_url: params.notificationUrl,
        },
      });
    } catch {
      throw new MercadoPagoGatewayError("provider_unreachable", true);
    }

    if (response.status >= 500 || response.status === 429) {
      throw new MercadoPagoGatewayError(`provider_error_${response.status}`, true);
    }
    if (!response.ok) {
      throw new MercadoPagoGatewayError(`provider_rejected_${response.status}`, false);
    }

    const data = (await response.json()) as MercadoPagoPaymentResponse;
    return toProviderPaymentState(data);
  }

  async getPayment(params: { paymentId: string; credentials: MercadoPagoCredentials }): Promise<ProviderPaymentState> {
    let response: Response;
    try {
      response = await mercadoPagoFetch(`/v1/payments/${encodeURIComponent(params.paymentId)}`, params.credentials, {
        method: "GET",
      });
    } catch {
      throw new MercadoPagoGatewayError("provider_unreachable", true);
    }

    if (response.status >= 500 || response.status === 429) {
      throw new MercadoPagoGatewayError(`provider_error_${response.status}`, true);
    }
    if (!response.ok) {
      throw new MercadoPagoGatewayError(`provider_error_${response.status}`, false);
    }

    const data = (await response.json()) as MercadoPagoPaymentResponse;
    return toProviderPaymentState(data);
  }

  async cancelPayment(params: { paymentId: string; credentials: MercadoPagoCredentials }): Promise<boolean> {
    try {
      const response = await mercadoPagoFetch(`/v1/payments/${encodeURIComponent(params.paymentId)}`, params.credentials, {
        method: "PUT",
        body: { status: "cancelled" },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
