import { describe, expect, it, vi, beforeEach } from "vitest";

const serviceClientMock = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };

vi.mock("@/lib/payments/service-only/client", () => ({
  createPaymentsServiceClient: () => serviceClientMock,
}));

const getPlatformPaymentCredentialsMock = vi.fn();
vi.mock("@/lib/payments/service-only/platform-credentials", () => ({
  getPlatformPaymentCredentials: () => getPlatformPaymentCredentialsMock(),
}));

const verifyMercadoPagoWebhookSignatureMock = vi.fn();
vi.mock("@/lib/payments/gateway/webhook-signature", () => ({
  verifyMercadoPagoWebhookSignature: (params: unknown) => verifyMercadoPagoWebhookSignatureMock(params),
}));

const reconcileBillingChargeByProviderPaymentIdMock = vi.fn();
vi.mock("./reconcile", () => ({
  reconcileBillingChargeByProviderPaymentId: (providerPaymentId: string) =>
    reconcileBillingChargeByProviderPaymentIdMock(providerPaymentId),
}));

const CREDENTIALS = {
  accessToken: "token",
  webhookSecret: "secret",
  environment: "test" as const,
};

describe("handlePlatformBillingWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceClientMock.rpc.mockResolvedValue({ data: null, error: null });
    getPlatformPaymentCredentialsMock.mockReturnValue(CREDENTIALS);
  });

  it("rejeita requisição sem data.id (400)", async () => {
    const { handlePlatformBillingWebhook } = await import("./webhook-handler");
    const result = await handlePlatformBillingWebhook({ xSignature: "x", xRequestId: "r", action: "a", dataId: null });
    expect(result.status).toBe(400);
  });

  it("credenciais da plataforma não configuradas devolve 500, nunca 401 (não é culpa do remetente)", async () => {
    getPlatformPaymentCredentialsMock.mockImplementation(() => {
      throw new Error("platform_billing_not_configured");
    });
    const { handlePlatformBillingWebhook } = await import("./webhook-handler");
    const result = await handlePlatformBillingWebhook({ xSignature: "x", xRequestId: "r", action: "a", dataId: "1" });
    expect(result.status).toBe(500);
  });

  it("assinatura inválida é rejeitada com 401, nunca reconcilia", async () => {
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(false);
    const { handlePlatformBillingWebhook } = await import("./webhook-handler");
    const result = await handlePlatformBillingWebhook({ xSignature: "bad", xRequestId: "r", action: "a", dataId: "1" });
    expect(result.status).toBe(401);
    expect(reconcileBillingChargeByProviderPaymentIdMock).not.toHaveBeenCalled();
  });

  it("assinatura ausente é rejeitada com 401", async () => {
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(false);
    const { handlePlatformBillingWebhook } = await import("./webhook-handler");
    const result = await handlePlatformBillingWebhook({ xSignature: null, xRequestId: "r", action: "a", dataId: "1" });
    expect(result.status).toBe(401);
  });

  it("cobrança ainda não vinculada (sem store_id conhecido) devolve 503, nunca tenta gravar billing_webhook_events", async () => {
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
    reconcileBillingChargeByProviderPaymentIdMock.mockResolvedValue({ ok: false, charge: null, reason: "not_found" });

    const { handlePlatformBillingWebhook } = await import("./webhook-handler");
    const result = await handlePlatformBillingWebhook({ xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });

    expect(result.status).toBe(503);
    expect(serviceClientMock.rpc).not.toHaveBeenCalledWith("billing_webhook_event_record", expect.anything());
  });

  it("assinatura válida + reconciliação bem-sucedida devolve 200, registra o evento com o store_id da cobrança", async () => {
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
    reconcileBillingChargeByProviderPaymentIdMock.mockResolvedValue({
      ok: true,
      charge: { id: "charge-1", store_id: "store-1", status: "approved" },
    });

    const { handlePlatformBillingWebhook } = await import("./webhook-handler");
    const result = await handlePlatformBillingWebhook({ xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });

    expect(result.status).toBe(200);
    expect(reconcileBillingChargeByProviderPaymentIdMock).toHaveBeenCalledWith("42");
    expect(serviceClientMock.rpc).toHaveBeenCalledWith(
      "billing_webhook_event_record",
      expect.objectContaining({ p_store_id: "store-1", p_charge_id: "charge-1", p_provider_payment_id: "42" }),
    );
  });

  it("provedor inalcançável na reconciliação devolve 503 (erro transitório, retry esperado)", async () => {
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
    reconcileBillingChargeByProviderPaymentIdMock.mockResolvedValue({
      ok: false,
      charge: { id: "charge-1", store_id: "store-1", status: "pending" },
      reason: "provider_unreachable",
    });

    const { handlePlatformBillingWebhook } = await import("./webhook-handler");
    const result = await handlePlatformBillingWebhook({ xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });
    expect(result.status).toBe(503);
  });

  // QA-001 (achado no QA independente): outcome.ok distingue "processamento
  // terminou de verdade" (mesmo quando o resultado deliberado é
  // manual_review) de "nada foi persistido porque algo quebrou" — só o
  // segundo mundo pode responder um status diferente de 200/503
  // (503 reservado a provider_unreachable, que é falha do Mercado Pago,
  // não nossa).
  describe("QA-001 — nunca confirma 200 quando o processamento não terminou de verdade", () => {
    it("replay idempotente (cobrança já terminal, evento coerente) devolve 200", async () => {
      verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
      reconcileBillingChargeByProviderPaymentIdMock.mockResolvedValue({
        ok: true,
        charge: { id: "charge-1", store_id: "store-1", status: "approved" },
        reason: "already_terminal",
      });

      const { handlePlatformBillingWebhook } = await import("./webhook-handler");
      const result = await handlePlatformBillingWebhook({ xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });
      expect(result.status).toBe(200);
    });

    it("mismatch de amount/currency/external_reference persistido com sucesso como manual_review devolve 200 (foi processado deliberadamente)", async () => {
      verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
      reconcileBillingChargeByProviderPaymentIdMock.mockResolvedValue({
        ok: true,
        charge: { id: "charge-1", store_id: "store-1", status: "manual_review" },
      });

      const { handlePlatformBillingWebhook } = await import("./webhook-handler");
      const result = await handlePlatformBillingWebhook({ xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });
      expect(result.status).toBe(200);
    });

    it("falha inesperada do RPC/apply (nada foi persistido) NUNCA devolve 200 — usa 500, não confirma sucesso falso", async () => {
      verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
      reconcileBillingChargeByProviderPaymentIdMock.mockResolvedValue({
        ok: false,
        charge: { id: "charge-1", store_id: "store-1", status: "pending" },
        reason: "apply_failed",
      });

      const { handlePlatformBillingWebhook } = await import("./webhook-handler");
      const result = await handlePlatformBillingWebhook({ xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });
      expect(result.status).not.toBe(200);
      expect(result.status).toBe(500);
    });

    it("qualquer razão de falha futura não mapeada explicitamente também nunca devolve 200 (default seguro)", async () => {
      verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
      reconcileBillingChargeByProviderPaymentIdMock.mockResolvedValue({
        ok: false,
        charge: { id: "charge-1", store_id: "store-1", status: "pending" },
        reason: "platform_not_configured",
      });

      const { handlePlatformBillingWebhook } = await import("./webhook-handler");
      const result = await handlePlatformBillingWebhook({ xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });
      expect(result.status).not.toBe(200);
      expect(result.status).toBe(500);
    });

    it("resposta de falha nunca vaza detalhe interno (stack, secret, mensagem de erro do RPC) — só uma mensagem genérica", async () => {
      verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
      reconcileBillingChargeByProviderPaymentIdMock.mockResolvedValue({
        ok: false,
        charge: { id: "charge-1", store_id: "store-1", status: "pending" },
        reason: "apply_failed",
      });

      const { handlePlatformBillingWebhook } = await import("./webhook-handler");
      const result = await handlePlatformBillingWebhook({ xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });
      const bodyText = JSON.stringify(result.body);
      expect(bodyText).not.toMatch(/secret|token|stack|at\s+\w+\s*\(/i);
      expect(result.body).toEqual({ message: "processing_failed" });
    });
  });
});
