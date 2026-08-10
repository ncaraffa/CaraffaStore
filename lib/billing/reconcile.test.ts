import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const serviceClientMock = {
  from: vi.fn(),
  rpc: vi.fn(),
};
vi.mock("@/lib/payments/service-only/client", () => ({
  createPaymentsServiceClient: () => serviceClientMock,
}));

const getPlatformPaymentCredentialsMock = vi.fn();
vi.mock("@/lib/payments/service-only/platform-credentials", () => ({
  getPlatformPaymentCredentials: () => getPlatformPaymentCredentialsMock(),
}));

const getPaymentMock = vi.fn();
vi.mock("@/lib/payments/gateway", () => ({
  getPixPaymentGateway: () => ({ getPayment: getPaymentMock }),
}));

const CREDENTIALS = { accessToken: "token", webhookSecret: "secret", environment: "test" as const };

const PENDING_CHARGE = {
  id: "charge-1",
  store_id: "store-1",
  status: "pending",
  provider_payment_id: "fake-1",
  external_reference: "charge-1",
  amount_cents: 5000,
  currency: "BRL",
};

function mockFromMaybeSingle(row: unknown) {
  serviceClientMock.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: row }),
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: row }) }),
      }),
    }),
  });
}

describe("reconcileBillingChargeById — QA-FINAL-003: nunca completa external_reference ausente com o valor esperado local", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlatformPaymentCredentialsMock.mockReturnValue(CREDENTIALS);
    serviceClientMock.rpc.mockResolvedValue({ data: { ...PENDING_CHARGE, status: "manual_review" }, error: null });
  });

  it("provider não devolve external_reference (null) — repassa null pra RPC, NUNCA o charge.external_reference local", async () => {
    mockFromMaybeSingle(PENDING_CHARGE);
    getPaymentMock.mockResolvedValue({
      providerPaymentId: "fake-1",
      status: "approved",
      statusDetail: "accredited",
      amountCents: 5000,
      currency: "BRL",
      paymentMethodId: "pix",
      externalReference: null, // provider não devolveu
      qrCode: null,
      qrCodeBase64: null,
      ticketUrl: null,
      createdAt: null,
      expiresAt: null,
    });

    const { reconcileBillingChargeById } = await import("./reconcile");
    await reconcileBillingChargeById("charge-1");

    expect(serviceClientMock.rpc).toHaveBeenCalledWith(
      "billing_charge_apply_provider_state",
      expect.objectContaining({ p_external_reference: null }),
    );
    const callArgs = serviceClientMock.rpc.mock.calls.find((c) => c[0] === "billing_charge_apply_provider_state")?.[1];
    expect(callArgs.p_external_reference).not.toBe(PENDING_CHARGE.external_reference);
  });

  it("provider devolve external_reference correta — repassa exatamente o que veio, sem substituição", async () => {
    mockFromMaybeSingle(PENDING_CHARGE);
    getPaymentMock.mockResolvedValue({
      providerPaymentId: "fake-1",
      status: "approved",
      statusDetail: "accredited",
      amountCents: 5000,
      currency: "BRL",
      paymentMethodId: "pix",
      externalReference: "charge-1",
      qrCode: null,
      qrCodeBase64: null,
      ticketUrl: null,
      createdAt: null,
      expiresAt: null,
    });

    const { reconcileBillingChargeById } = await import("./reconcile");
    await reconcileBillingChargeById("charge-1");

    expect(serviceClientMock.rpc).toHaveBeenCalledWith(
      "billing_charge_apply_provider_state",
      expect.objectContaining({ p_external_reference: "charge-1" }),
    );
  });
});

describe("QA-FINAL-004 — webhook nunca curto-circuita em estado terminal, página sim", () => {
  const APPROVED_CHARGE = { ...PENDING_CHARGE, status: "approved" };

  beforeEach(() => {
    vi.clearAllMocks();
    getPlatformPaymentCredentialsMock.mockReturnValue(CREDENTIALS);
    serviceClientMock.rpc.mockResolvedValue({ data: APPROVED_CHARGE, error: null });
    getPaymentMock.mockResolvedValue({
      providerPaymentId: "fake-1",
      status: "approved",
      statusDetail: "accredited",
      amountCents: 5000,
      currency: "BRL",
      paymentMethodId: "pix",
      externalReference: "charge-1",
      qrCode: null,
      qrCodeBase64: null,
      ticketUrl: null,
      createdAt: null,
      expiresAt: null,
    });
  });

  it("reconcileBillingChargeById (página) NÃO consulta o provider quando a cobrança já está terminal", async () => {
    mockFromMaybeSingle(APPROVED_CHARGE);

    const { reconcileBillingChargeById } = await import("./reconcile");
    const outcome = await reconcileBillingChargeById("charge-1");

    expect(getPaymentMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true, charge: APPROVED_CHARGE, reason: "already_terminal" });
  });

  it("reconcileBillingChargeByProviderPaymentId (webhook) SEMPRE consulta o provider, mesmo com a cobrança já terminal — permite a lógica de conflito terminal da RPC rodar de verdade", async () => {
    mockFromMaybeSingle(APPROVED_CHARGE);

    const { reconcileBillingChargeByProviderPaymentId } = await import("./reconcile");
    await reconcileBillingChargeByProviderPaymentId("fake-1");

    expect(getPaymentMock).toHaveBeenCalledTimes(1);
    expect(serviceClientMock.rpc).toHaveBeenCalledWith(
      "billing_charge_apply_provider_state",
      expect.objectContaining({ p_charge_id: "charge-1" }),
    );
  });
});
