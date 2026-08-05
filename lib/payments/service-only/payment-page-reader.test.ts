import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

const STORE_ROW = { id: "store-1" };
const ORDER_ROW = { id: "order-1", public_code: "ABCD1234", receipt_token_hash: "", payment_mode: "pix" };
const ATTEMPT_ROW = {
  id: "attempt-1",
  status: "pending",
  amount_cents: 1500,
  qr_code: "qr",
  qr_code_base64: "qr64",
  ticket_url: "https://ticket",
  expires_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

const RECEIPT_TOKEN = "a-valid-receipt-token";
ORDER_ROW.receipt_token_hash = createHash("sha256").update(RECEIPT_TOKEN).digest("hex");

function makeTable(row: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve({ data: row, error: null })),
  };
  return query;
}

function makeServiceClient(overrides: { store?: unknown; order?: unknown; attempt?: unknown } = {}) {
  const tables: Record<string, unknown> = {
    stores: makeTable(overrides.store === undefined ? STORE_ROW : overrides.store),
    orders: makeTable(overrides.order === undefined ? ORDER_ROW : overrides.order),
    order_payments: makeTable(overrides.attempt === undefined ? ATTEMPT_ROW : overrides.attempt),
  };
  return { from: (name: string) => tables[name] };
}

let serviceClientFactory = () => makeServiceClient();
vi.mock("./client", () => ({
  createPaymentsServiceClient: () => serviceClientFactory(),
}));

const reconcileMock = vi.fn();
vi.mock("@/lib/payments/reconcile", () => ({
  reconcilePaymentAttemptById: (id: string) => reconcileMock(id),
}));

describe("getPublicPaymentView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceClientFactory = () => makeServiceClient();
    reconcileMock.mockResolvedValue({ ok: true, attempt: ATTEMPT_ROW });
  });

  it("retorna null quando o cookie de recibo está ausente — publicCode sozinho nunca é suficiente", async () => {
    const { getPublicPaymentView } = await import("./payment-page-reader");
    const result = await getPublicPaymentView({ storeSlug: "store-a", publicCode: "ABCD1234", receiptToken: undefined });
    expect(result).toBeNull();
  });

  it("retorna null quando o token de recibo não bate com o hash salvo", async () => {
    const { getPublicPaymentView } = await import("./payment-page-reader");
    const result = await getPublicPaymentView({ storeSlug: "store-a", publicCode: "ABCD1234", receiptToken: "token-errado" });
    expect(result).toBeNull();
  });

  it("retorna os dados públicos quando o token bate com o hash salvo", async () => {
    const { getPublicPaymentView } = await import("./payment-page-reader");
    const result = await getPublicPaymentView({ storeSlug: "store-a", publicCode: "ABCD1234", receiptToken: RECEIPT_TOKEN });
    expect(result).not.toBeNull();
    expect(result?.publicCode).toBe("ABCD1234");
    expect(result?.qrCode).toBe("qr");
  });

  it("nunca expõe dados quando o pedido não existe (loja/publicCode não encontrados)", async () => {
    serviceClientFactory = () => makeServiceClient({ order: null });
    const { getPublicPaymentView } = await import("./payment-page-reader");
    const result = await getPublicPaymentView({ storeSlug: "store-a", publicCode: "ABCD1234", receiptToken: RECEIPT_TOKEN });
    expect(result).toBeNull();
  });

  it("nunca expõe dados de um pedido payment_mode=manual (sem receipt_token_hash)", async () => {
    serviceClientFactory = () => makeServiceClient({ order: { ...ORDER_ROW, payment_mode: "manual" } });
    const { getPublicPaymentView } = await import("./payment-page-reader");
    const result = await getPublicPaymentView({ storeSlug: "store-a", publicCode: "ABCD1234", receiptToken: RECEIPT_TOKEN });
    expect(result).toBeNull();
  });

  it("reconcilia automaticamente quando o pagamento ainda está pending/creating", async () => {
    const { getPublicPaymentView } = await import("./payment-page-reader");
    await getPublicPaymentView({ storeSlug: "store-a", publicCode: "ABCD1234", receiptToken: RECEIPT_TOKEN });
    expect(reconcileMock).toHaveBeenCalledWith("attempt-1");
  });

  it("não reconcilia quando o pagamento já está em estado terminal (approved)", async () => {
    serviceClientFactory = () => makeServiceClient({ attempt: { ...ATTEMPT_ROW, status: "approved" } });
    const { getPublicPaymentView } = await import("./payment-page-reader");
    await getPublicPaymentView({ storeSlug: "store-a", publicCode: "ABCD1234", receiptToken: RECEIPT_TOKEN });
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});
