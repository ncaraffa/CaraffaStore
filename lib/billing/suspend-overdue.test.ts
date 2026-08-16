import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const serviceClientMock = { rpc: vi.fn() };
vi.mock("@/lib/payments/service-only/client", () => ({
  createPaymentsServiceClient: () => serviceClientMock,
}));

const { runBillingSuspendOverdueStores } = await import("./suspend-overdue");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runBillingSuspendOverdueStores", () => {
  it("chama a RPC billing_suspend_overdue_stores sem argumentos e resume o resultado", async () => {
    serviceClientMock.rpc.mockResolvedValue({
      data: [{ id: "store-1" }, { id: "store-2" }],
      error: null,
    });

    const summary = await runBillingSuspendOverdueStores();

    expect(serviceClientMock.rpc).toHaveBeenCalledWith("billing_suspend_overdue_stores");
    expect(summary).toEqual({ suspended: 2, storeIds: ["store-1", "store-2"] });
  });

  it("nenhuma loja vencida: resumo zerado, nunca null/undefined", async () => {
    serviceClientMock.rpc.mockResolvedValue({ data: [], error: null });

    const summary = await runBillingSuspendOverdueStores();

    expect(summary).toEqual({ suspended: 0, storeIds: [] });
  });

  it("data null (RPC sem erro mas sem linhas) — trata como lista vazia, nunca lança", async () => {
    serviceClientMock.rpc.mockResolvedValue({ data: null, error: null });

    await expect(runBillingSuspendOverdueStores()).resolves.toEqual({ suspended: 0, storeIds: [] });
  });

  it("erro da RPC propaga — o cron responde 500 e o Vercel Cron loga a falha, nunca finge sucesso", async () => {
    serviceClientMock.rpc.mockResolvedValue({ data: null, error: new Error("boom") });

    await expect(runBillingSuspendOverdueStores()).rejects.toThrow("boom");
  });
});
