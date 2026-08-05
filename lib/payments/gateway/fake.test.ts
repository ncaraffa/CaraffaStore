import { describe, expect, it } from "vitest";
import { FakePixGateway } from "./fake";

const CREDENTIALS = { accessToken: "TEST-fake-token-1234", environment: "test" as const };

describe("FakePixGateway", () => {
  it("createPayment retorna QR Code determinístico e status pending", async () => {
    const gateway = new FakePixGateway();
    const result = await gateway.createPayment({
      credentials: CREDENTIALS,
      idempotencyKey: "idem-1",
      amountCents: 1500,
      externalReference: "ext-1",
      payerEmail: "cliente@example.test",
      payerDocType: "CPF",
      payerDocNumber: "11111111111",
      description: "Pedido teste",
      notificationUrl: "https://example.test/webhook",
    });

    expect(result.status).toBe("pending");
    expect(result.amountCents).toBe(1500);
    expect(result.qrCode).toBeTruthy();
    expect(result.qrCodeBase64).toBeTruthy();
    expect(result.providerPaymentId).toBeTruthy();
  });

  it("getPayment reflete setStatus (simulação determinística de aprovação)", async () => {
    const gateway = new FakePixGateway();
    const created = await gateway.createPayment({
      credentials: CREDENTIALS,
      idempotencyKey: "idem-2",
      amountCents: 2000,
      externalReference: "ext-2",
      payerEmail: "cliente@example.test",
      payerDocType: "CPF",
      payerDocNumber: "22222222222",
      description: "Pedido teste",
      notificationUrl: "https://example.test/webhook",
    });

    gateway.setStatus(created.providerPaymentId, "approved");
    const fetched = await gateway.getPayment({ paymentId: created.providerPaymentId, credentials: CREDENTIALS });
    expect(fetched.status).toBe("approved");
  });

  it("validateCredentials rejeita token de teste inválido, aceita qualquer outro", async () => {
    const gateway = new FakePixGateway();
    await expect(gateway.validateCredentials({ accessToken: "invalid-token", environment: "test" })).resolves.toEqual({
      ok: false,
      errorCode: "invalid_credentials",
    });
    await expect(gateway.validateCredentials(CREDENTIALS)).resolves.toEqual({ ok: true });
  });

  it("cancelPayment só funciona enquanto pending", async () => {
    const gateway = new FakePixGateway();
    const created = await gateway.createPayment({
      credentials: CREDENTIALS,
      idempotencyKey: "idem-3",
      amountCents: 1000,
      externalReference: "ext-3",
      payerEmail: "cliente@example.test",
      payerDocType: "CPF",
      payerDocNumber: "33333333333",
      description: "Pedido teste",
      notificationUrl: "https://example.test/webhook",
    });

    const cancelled = await gateway.cancelPayment({ paymentId: created.providerPaymentId, credentials: CREDENTIALS });
    expect(cancelled).toBe(true);

    const cancelledAgain = await gateway.cancelPayment({ paymentId: created.providerPaymentId, credentials: CREDENTIALS });
    expect(cancelledAgain).toBe(false);
  });

  it("getPayment de um id inexistente lança erro", async () => {
    const gateway = new FakePixGateway();
    await expect(gateway.getPayment({ paymentId: "nao-existe", credentials: CREDENTIALS })).rejects.toThrow();
  });
});
