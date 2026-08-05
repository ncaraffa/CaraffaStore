export type PixPaymentEnvironment = "test" | "production";
export type PixDocType = "CPF" | "CNPJ";
export type InternalPaymentStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";

export interface MercadoPagoCredentials {
  accessToken: string;
  environment: PixPaymentEnvironment;
}

export interface CreatePixPaymentParams {
  credentials: MercadoPagoCredentials;
  idempotencyKey: string;
  amountCents: number;
  externalReference: string;
  payerEmail: string;
  payerDocType: PixDocType;
  payerDocNumber: string;
  description: string;
  notificationUrl: string;
}

export interface ProviderPaymentState {
  providerPaymentId: string;
  status: string;
  statusDetail: string | null;
  amountCents: number;
  currency: string;
  paymentMethodId: string | null;
  externalReference: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  createdAt: string | null;
  expiresAt: string | null;
}

export interface ValidateCredentialsResult {
  ok: boolean;
  errorCode?: string;
}

/**
 * Fronteira única de integração com o provedor de Pix — implementações
 * concretas: MercadoPagoPixGateway (real) e FakePixGateway (testes/dev
 * local). Nenhum código de orquestração deve chamar `fetch` diretamente
 * para o Mercado Pago fora de MercadoPagoPixGateway.
 */
export interface PixPaymentGateway {
  validateCredentials(credentials: MercadoPagoCredentials): Promise<ValidateCredentialsResult>;
  createPayment(params: CreatePixPaymentParams): Promise<ProviderPaymentState>;
  getPayment(params: { paymentId: string; credentials: MercadoPagoCredentials }): Promise<ProviderPaymentState>;
  cancelPayment?(params: { paymentId: string; credentials: MercadoPagoCredentials }): Promise<boolean>;
}
