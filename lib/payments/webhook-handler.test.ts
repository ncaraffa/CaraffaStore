import { describe, expect, it, vi, beforeEach } from "vitest";

const serviceClientMock = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };

vi.mock("./service-only/client", () => ({
  createPaymentsServiceClient: () => serviceClientMock,
}));

const getStorePaymentCredentialsByWebhookKeyMock = vi.fn();
vi.mock("./service-only/credentials-reader", () => ({
  getStorePaymentCredentialsByWebhookKey: (key: string) => getStorePaymentCredentialsByWebhookKeyMock(key),
}));

const verifyMercadoPagoWebhookSignatureMock = vi.fn();
vi.mock("./gateway/webhook-signature", () => ({
  verifyMercadoPagoWebhookSignature: (params: unknown) => verifyMercadoPagoWebhookSignatureMock(params),
}));

const reconcilePaymentAttemptByProviderPaymentIdMock = vi.fn();
vi.mock("./reconcile", () => ({
  reconcilePaymentAttemptByProviderPaymentId: (storeId: string, providerPaymentId: string) =>
    reconcilePaymentAttemptByProviderPaymentIdMock(storeId, providerPaymentId),
}));

const CREDENTIALS = {
  storeId: "store-1",
  accessToken: "token",
  webhookSecret: "secret",
  webhookKey: "key-1",
  environment: "test" as const,
  isEnabled: true,
};

describe("handleMercadoPagoWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceClientMock.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("rejeita requisição sem webhook_key ou sem data.id (400)", async () => {
    const { handleMercadoPagoWebhook } = await import("./webhook-handler");
    const result = await handleMercadoPagoWebhook({ webhookKey: null, xSignature: "x", xRequestId: "r", action: "a", dataId: "1" });
    expect(result.status).toBe(400);

    const result2 = await handleMercadoPagoWebhook({ webhookKey: "k", xSignature: "x", xRequestId: "r", action: "a", dataId: null });
    expect(result2.status).toBe(400);
  });

  it("rejeita webhook_key desconhecida (401), nunca chama verificação de assinatura", async () => {
    getStorePaymentCredentialsByWebhookKeyMock.mockResolvedValue(null);
    const { handleMercadoPagoWebhook } = await import("./webhook-handler");
    const result = await handleMercadoPagoWebhook({ webhookKey: "unknown", xSignature: "x", xRequestId: "r", action: "a", dataId: "1" });
    expect(result.status).toBe(401);
    expect(verifyMercadoPagoWebhookSignatureMock).not.toHaveBeenCalled();
  });

  it("assinatura inválida é rejeitada com 401, nunca reconcilia", async () => {
    getStorePaymentCredentialsByWebhookKeyMock.mockResolvedValue(CREDENTIALS);
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(false);
    const { handleMercadoPagoWebhook } = await import("./webhook-handler");
    const result = await handleMercadoPagoWebhook({ webhookKey: "key-1", xSignature: "bad", xRequestId: "r", action: "a", dataId: "1" });
    expect(result.status).toBe(401);
    expect(reconcilePaymentAttemptByProviderPaymentIdMock).not.toHaveBeenCalled();
  });

  it("assinatura ausente é rejeitada com 401", async () => {
    getStorePaymentCredentialsByWebhookKeyMock.mockResolvedValue(CREDENTIALS);
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(false);
    const { handleMercadoPagoWebhook } = await import("./webhook-handler");
    const result = await handleMercadoPagoWebhook({ webhookKey: "key-1", xSignature: null, xRequestId: "r", action: "a", dataId: "1" });
    expect(result.status).toBe(401);
  });

  it("assinatura válida + reconciliação bem-sucedida devolve 200, nunca confia no corpo (busca estado real via reconciliação)", async () => {
    getStorePaymentCredentialsByWebhookKeyMock.mockResolvedValue(CREDENTIALS);
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
    reconcilePaymentAttemptByProviderPaymentIdMock.mockResolvedValue({ ok: true, attempt: { id: "attempt-1", status: "approved" } });

    const { handleMercadoPagoWebhook } = await import("./webhook-handler");
    const result = await handleMercadoPagoWebhook({ webhookKey: "key-1", xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });

    expect(result.status).toBe(200);
    expect(reconcilePaymentAttemptByProviderPaymentIdMock).toHaveBeenCalledWith("store-1", "42");
  });

  it("pagamento ainda não vinculado no nosso lado devolve 503 (Mercado Pago tenta de novo depois)", async () => {
    getStorePaymentCredentialsByWebhookKeyMock.mockResolvedValue(CREDENTIALS);
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
    reconcilePaymentAttemptByProviderPaymentIdMock.mockResolvedValue({ ok: false, attempt: null, reason: "not_found" });

    const { handleMercadoPagoWebhook } = await import("./webhook-handler");
    const result = await handleMercadoPagoWebhook({ webhookKey: "key-1", xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });
    expect(result.status).toBe(503);
  });

  it("provedor inalcançável na reconciliação devolve 503 (erro transitório, retry esperado)", async () => {
    getStorePaymentCredentialsByWebhookKeyMock.mockResolvedValue(CREDENTIALS);
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
    reconcilePaymentAttemptByProviderPaymentIdMock.mockResolvedValue({
      ok: false,
      attempt: { id: "attempt-1", status: "pending" },
      reason: "provider_unreachable",
    });

    const { handleMercadoPagoWebhook } = await import("./webhook-handler");
    const result = await handleMercadoPagoWebhook({ webhookKey: "key-1", xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });
    expect(result.status).toBe(503);
  });

  it("registra o evento do webhook (payment_webhook_events) mesmo quando o resultado é sucesso", async () => {
    getStorePaymentCredentialsByWebhookKeyMock.mockResolvedValue(CREDENTIALS);
    verifyMercadoPagoWebhookSignatureMock.mockReturnValue(true);
    reconcilePaymentAttemptByProviderPaymentIdMock.mockResolvedValue({ ok: true, attempt: { id: "attempt-1", status: "approved" } });

    const { handleMercadoPagoWebhook } = await import("./webhook-handler");
    await handleMercadoPagoWebhook({ webhookKey: "key-1", xSignature: "ts=1,v1=abc", xRequestId: "r", action: "payment.updated", dataId: "42" });

    expect(serviceClientMock.rpc).toHaveBeenCalledWith(
      "pix_webhook_event_record",
      expect.objectContaining({ p_store_id: "store-1", p_provider_payment_id: "42" }),
    );
  });
});
