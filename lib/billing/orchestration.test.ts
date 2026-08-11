import { describe, expect, it, vi, beforeEach } from "vitest";
import { MercadoPagoGatewayError } from "@/lib/payments/gateway/mercado-pago";

vi.mock("server-only", () => ({}));

const serviceClientMock = { rpc: vi.fn() };
vi.mock("@/lib/payments/service-only/client", () => ({
  createPaymentsServiceClient: () => serviceClientMock,
}));

const getPlatformPaymentCredentialsMock = vi.fn();
vi.mock("@/lib/payments/service-only/platform-credentials", () => ({
  getPlatformPaymentCredentials: () => getPlatformPaymentCredentialsMock(),
}));

const createPaymentMock = vi.fn();
vi.mock("@/lib/payments/gateway", () => ({
  getPixPaymentGateway: () => ({ createPayment: createPaymentMock }),
}));

vi.mock("@/lib/auth/site-url", () => ({
  absoluteUrl: (path: string) => `https://caraffastore.test${path}`,
}));

const CREDENTIALS = { accessToken: "token", webhookSecret: "secret", environment: "test" as const };

const CREATING_CHARGE = {
  id: "charge-1",
  store_id: "store-1",
  plan_code: 50,
  amount_cents: 5000,
  external_reference: "charge-1",
  provider_idempotency_key: "persisted-key-from-db",
  status: "creating",
};

describe("createPlatformBillingCharge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlatformPaymentCredentialsMock.mockReturnValue(CREDENTIALS);
  });

  it("nunca envia plan_code/amount_cents ao RPC de criação — servidor deriva sozinho", async () => {
    serviceClientMock.rpc.mockResolvedValueOnce({ data: { ...CREATING_CHARGE, status: "pending" }, error: null });

    const { createPlatformBillingCharge } = await import("./orchestration");
    await createPlatformBillingCharge({
      storeId: "store-1",
      payerEmail: "a@b.com",
      payerDocType: "CPF",
      payerDocNumber: "12345678901",
    });

    expect(serviceClientMock.rpc).toHaveBeenCalledWith(
      "billing_charge_upsert_creating",
      expect.objectContaining({ p_store_id: "store-1", p_payer_email: "a@b.com", p_payer_doc_type: "CPF", p_payer_doc_last4: "8901" }),
    );
    const args = serviceClientMock.rpc.mock.calls[0]?.[1];
    expect(args).not.toHaveProperty("p_plan_code");
    expect(args).not.toHaveProperty("p_amount_cents");
  });

  it("cobrança reaproveitada (status já pending) nunca chama o gateway de novo", async () => {
    serviceClientMock.rpc.mockResolvedValueOnce({ data: { ...CREATING_CHARGE, status: "pending" }, error: null });

    const { createPlatformBillingCharge } = await import("./orchestration");
    const result = await createPlatformBillingCharge({
      storeId: "store-1",
      payerEmail: "a@b.com",
      payerDocType: "CPF",
      payerDocNumber: "12345678901",
    });

    expect(createPaymentMock).not.toHaveBeenCalled();
    expect(result.status).toBe("pending");
  });

  it("cobrança nova (status creating) chama o gateway e marca created", async () => {
    serviceClientMock.rpc
      .mockResolvedValueOnce({ data: CREATING_CHARGE, error: null }) // upsert_creating
      .mockResolvedValueOnce({ data: { ...CREATING_CHARGE, status: "pending", qr_code: "00020126x" }, error: null }); // mark_created
    createPaymentMock.mockResolvedValue({
      providerPaymentId: "fake-1",
      status: "pending",
      statusDetail: null,
      qrCode: "00020126x",
      qrCodeBase64: "base64",
      ticketUrl: "https://ticket",
      expiresAt: "2026-01-01T00:00:00Z",
    });

    const { createPlatformBillingCharge } = await import("./orchestration");
    const result = await createPlatformBillingCharge({
      storeId: "store-1",
      payerEmail: "a@b.com",
      payerDocType: "CPF",
      payerDocNumber: "12345678901",
    });

    expect(createPaymentMock).toHaveBeenCalledTimes(1);
    expect(serviceClientMock.rpc).toHaveBeenCalledWith("billing_charge_mark_created", expect.objectContaining({ p_charge_id: "charge-1" }));
    expect(result.status).toBe("pending");
    expect(result.qrCode).toBe("00020126x");
  });

  it("mapeia store_not_billable do RPC para BillingCheckoutError com o mesmo código", async () => {
    serviceClientMock.rpc.mockResolvedValue({ data: null, error: { message: "store_not_billable" } });

    const { createPlatformBillingCharge, BillingCheckoutError } = await import("./orchestration");
    try {
      await createPlatformBillingCharge({ storeId: "store-1", payerEmail: "a@b.com", payerDocType: "CPF", payerDocNumber: "12345678901" });
      expect.unreachable("deveria ter lançado BillingCheckoutError");
    } catch (error) {
      expect(error).toBeInstanceOf(BillingCheckoutError);
      expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("store_not_billable");
    }
  });

  it("erro transitório do gateway mantém status creating (não marca falha definitiva)", async () => {
    serviceClientMock.rpc.mockResolvedValueOnce({ data: CREATING_CHARGE, error: null });
    createPaymentMock.mockRejectedValue(new MercadoPagoGatewayError("timeout", true));

    const { createPlatformBillingCharge, BillingCheckoutError } = await import("./orchestration");
    await expect(
      createPlatformBillingCharge({ storeId: "store-1", payerEmail: "a@b.com", payerDocType: "CPF", payerDocNumber: "12345678901" }),
    ).rejects.toThrow(BillingCheckoutError);

    expect(serviceClientMock.rpc).not.toHaveBeenCalledWith("billing_charge_mark_creation_failed", expect.anything());
  });

  it("erro definitivo do gateway marca a cobrança como falha", async () => {
    serviceClientMock.rpc
      .mockResolvedValueOnce({ data: CREATING_CHARGE, error: null })
      .mockResolvedValueOnce({ data: { ...CREATING_CHARGE, status: "error" }, error: null });
    createPaymentMock.mockRejectedValue(new MercadoPagoGatewayError("invalid_credentials", false));

    const { createPlatformBillingCharge, BillingCheckoutError } = await import("./orchestration");
    await expect(
      createPlatformBillingCharge({ storeId: "store-1", payerEmail: "a@b.com", payerDocType: "CPF", payerDocNumber: "12345678901" }),
    ).rejects.toThrow(BillingCheckoutError);

    expect(serviceClientMock.rpc).toHaveBeenCalledWith(
      "billing_charge_mark_creation_failed",
      expect.objectContaining({ p_charge_id: "charge-1", p_error_code: "invalid_credentials" }),
    );
  });

  // QA-FINAL-001 (achado no QA independente): a chave enviada ao Mercado
  // Pago tem que ser a PERSISTIDA na linha devolvida pelo RPC, nunca a
  // gerada localmente nesta execução — senão duas execuções para a
  // mesma cobrança local (retry após timeout, duas abas, corrida real)
  // enviam X-Idempotency-Key diferentes ao provider para a MESMA
  // operação, quebrando a garantia de idempotência ponta a ponta.
  describe("QA-FINAL-001 — idempotency key do provider é sempre a persistida, nunca a gerada localmente", () => {
    it("RPC devolve charge creating com provider_idempotency_key diferente da chave candidata — gateway recebe a PERSISTIDA", async () => {
      const chargeWithDifferentKey = { ...CREATING_CHARGE, provider_idempotency_key: "persisted-key" };
      serviceClientMock.rpc
        .mockResolvedValueOnce({ data: chargeWithDifferentKey, error: null }) // upsert_creating
        .mockResolvedValueOnce({ data: { ...chargeWithDifferentKey, status: "pending" }, error: null }); // mark_created
      createPaymentMock.mockResolvedValue({
        providerPaymentId: "fake-1",
        status: "pending",
        statusDetail: null,
        qrCode: "qr",
        qrCodeBase64: "b64",
        ticketUrl: "https://ticket",
        expiresAt: "2026-01-01T00:00:00Z",
      });

      const { createPlatformBillingCharge } = await import("./orchestration");
      await createPlatformBillingCharge({ storeId: "store-1", payerEmail: "a@b.com", payerDocType: "CPF", payerDocNumber: "12345678901" });

      expect(createPaymentMock).toHaveBeenCalledTimes(1);
      const callArgs = createPaymentMock.mock.calls[0]?.[0];
      expect(callArgs.idempotencyKey).toBe("persisted-key");
      // A chave candidata gerada nesta execução (aleatória, com prefixo
      // plat-<storeId>-) NUNCA pode ser o que chegou ao gateway.
      expect(callArgs.idempotencyKey).not.toMatch(/^plat-store1-/);
    });

    it("retry após timeout: segunda execução da orchestration reaproveita a MESMA charge/key da primeira tentativa transitória", async () => {
      const persistedCharge = { ...CREATING_CHARGE, provider_idempotency_key: "key-from-first-attempt" };

      // Primeira execução: upsert_creating cria a linha, provider sofre
      // timeout — mark_creation_failed NUNCA é chamado para erro
      // transitório (mantém `creating`, já coberto por outro teste).
      serviceClientMock.rpc.mockResolvedValueOnce({ data: persistedCharge, error: null });
      createPaymentMock.mockRejectedValueOnce(new MercadoPagoGatewayError("timeout", true));

      const { createPlatformBillingCharge, BillingCheckoutError } = await import("./orchestration");
      await expect(
        createPlatformBillingCharge({ storeId: "store-1", payerEmail: "a@b.com", payerDocType: "CPF", payerDocNumber: "12345678901" }),
      ).rejects.toThrow(BillingCheckoutError);

      // Segunda execução (retry real do usuário/UI): RPC devolve a MESMA
      // linha, ainda `creating`, com a mesma provider_idempotency_key
      // persistida da primeira tentativa.
      serviceClientMock.rpc.mockResolvedValueOnce({ data: persistedCharge, error: null }); // upsert_creating (reaproveita)
      serviceClientMock.rpc.mockResolvedValueOnce({ data: { ...persistedCharge, status: "pending" }, error: null }); // mark_created
      createPaymentMock.mockResolvedValueOnce({
        providerPaymentId: "fake-2",
        status: "pending",
        statusDetail: null,
        qrCode: "qr",
        qrCodeBase64: "b64",
        ticketUrl: "https://ticket",
        expiresAt: "2026-01-01T00:00:00Z",
      });

      const result = await createPlatformBillingCharge({ storeId: "store-1", payerEmail: "a@b.com", payerDocType: "CPF", payerDocNumber: "12345678901" });

      expect(createPaymentMock).toHaveBeenCalledTimes(2);
      const secondCallArgs = createPaymentMock.mock.calls[1]?.[0];
      expect(secondCallArgs.idempotencyKey).toBe("key-from-first-attempt");
      expect(result.status).toBe("pending");
    });

    it("concorrência na camada de aplicação: duas chamadas simultâneas de createPlatformBillingCharge para a mesma loja usam a MESMA idempotency key no provider", async () => {
      // Simula o que o índice único parcial do banco garante: as duas
      // chamadas ao RPC devolvem a MESMA linha (a segunda "vence" e
      // persiste sua chave; a primeira, ao consultar de volta, recebe a
      // chave da vencedora) — aqui fixamos as duas respostas do RPC para
      // devolverem exatamente a mesma linha/chave, como o banco garante
      // sob concorrência real (já provado contra Postgres real no QA
      // dinâmico anterior; este teste prova que a CAMADA DE APLICAÇÃO
      // respeita esse contrato e nunca usa a chave que gerou localmente
      // em vez da devolvida).
      const winningCharge = { ...CREATING_CHARGE, provider_idempotency_key: "concurrency-winner-key" };
      serviceClientMock.rpc.mockResolvedValue({ data: winningCharge, error: null });
      createPaymentMock.mockImplementation(async () => ({
        providerPaymentId: `fake-${Math.floor(Math.random() * 1e9)}`,
        status: "pending",
        statusDetail: null,
        qrCode: "qr",
        qrCodeBase64: "b64",
        ticketUrl: "https://ticket",
        expiresAt: "2026-01-01T00:00:00Z",
      }));

      const { createPlatformBillingCharge } = await import("./orchestration");
      const [resultA, resultB] = await Promise.all([
        createPlatformBillingCharge({ storeId: "store-1", payerEmail: "a@b.com", payerDocType: "CPF", payerDocNumber: "12345678901" }),
        createPlatformBillingCharge({ storeId: "store-1", payerEmail: "b@b.com", payerDocType: "CPF", payerDocNumber: "10987654321" }),
      ]);

      expect(resultA.id).toBe(winningCharge.id);
      expect(resultB.id).toBe(winningCharge.id);
      expect(createPaymentMock).toHaveBeenCalledTimes(2);
      const keysUsed = createPaymentMock.mock.calls.map((call) => call[0].idempotencyKey);
      expect(new Set(keysUsed).size).toBe(1);
      expect(keysUsed[0]).toBe("concurrency-winner-key");
    });
  });
});
