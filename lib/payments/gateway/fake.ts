import type {
  CreatePixPaymentParams,
  MercadoPagoCredentials,
  PixPaymentGateway,
  ProviderPaymentState,
  ValidateCredentialsResult,
} from "./types";

/**
 * Gateway determinístico para testes automatizados e desenvolvimento
 * local — nunca faz nenhuma chamada de rede. Seleção controlada por
 * lib/payments/gateway/index.ts (nunca em produção, ver ali). Guarda o
 * estado de cada pagamento criado em memória do processo; `setStatus`
 * expõe um jeito de simular a resposta do provedor mudando de fato
 * (usado pelos testes de webhook/reconciliação — nunca aceita um status
 * "de fora" que não veio desta simulação controlada).
 */
export class FakePixGateway implements PixPaymentGateway {
  private payments = new Map<string, ProviderPaymentState>();
  private counter = 0;

  async validateCredentials(credentials: MercadoPagoCredentials): Promise<ValidateCredentialsResult> {
    if (credentials.accessToken === "invalid-token") {
      return { ok: false, errorCode: "invalid_credentials" };
    }
    if (!credentials.accessToken || credentials.accessToken.trim().length === 0) {
      return { ok: false, errorCode: "invalid_credentials" };
    }
    return { ok: true };
  }

  async createPayment(params: CreatePixPaymentParams): Promise<ProviderPaymentState> {
    this.counter += 1;
    const providerPaymentId = `fake-${this.counter}-${params.idempotencyKey.slice(0, 12)}`;
    const state: ProviderPaymentState = {
      providerPaymentId,
      status: "pending",
      statusDetail: "pending_waiting_transfer",
      amountCents: params.amountCents,
      currency: "BRL",
      paymentMethodId: "pix",
      externalReference: params.externalReference,
      qrCode: `00020126fake-copia-e-cola-${providerPaymentId}`,
      qrCodeBase64: Buffer.from(`fake-qr-${providerPaymentId}`).toString("base64"),
      ticketUrl: `https://fake.mercadopago.local/ticket/${providerPaymentId}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    this.payments.set(providerPaymentId, state);
    return { ...state };
  }

  async getPayment(params: { paymentId: string; credentials: MercadoPagoCredentials }): Promise<ProviderPaymentState> {
    const state = this.payments.get(params.paymentId);
    if (!state) {
      throw new Error("fake_payment_not_found");
    }
    return { ...state };
  }

  async cancelPayment(params: { paymentId: string; credentials: MercadoPagoCredentials }): Promise<boolean> {
    const state = this.payments.get(params.paymentId);
    if (!state || state.status !== "pending") {
      return false;
    }
    state.status = "cancelled";
    state.statusDetail = "by_collector";
    return true;
  }

  /** Só para testes: simula o Mercado Pago mudando de fato o estado do pagamento. */
  setStatus(providerPaymentId: string, status: string, statusDetail: string | null = null): void {
    const state = this.payments.get(providerPaymentId);
    if (!state) {
      throw new Error("fake_payment_not_found");
    }
    state.status = status;
    state.statusDetail = statusDetail;
  }

  /** Só para testes: inspeciona o estado atual sem passar pelo fluxo real de getPayment. */
  peek(providerPaymentId: string): ProviderPaymentState | undefined {
    const state = this.payments.get(providerPaymentId);
    return state ? { ...state } : undefined;
  }
}
