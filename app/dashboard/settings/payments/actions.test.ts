import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * TASK008-RETEST-SEC-001: testPaymentConnectionAction lia credencial
 * (service_role, descriptografada) e chamava o gateway do Mercado Pago
 * ANTES de checar se o usuário era owner/admin. Estes testes provam a
 * ORDEM real de execução da action de produção — não mockam a checagem
 * de role em si (`role !== "owner" && role !== "admin"`, código real de
 * app/dashboard/settings/payments/actions.ts), só o resultado de
 * `requireStoreStatus` (quem é o usuário) e as bordas externas
 * (credencial/gateway) para provar que elas NUNCA são tocadas quando o
 * resultado é staff.
 *
 * `server-only` é neutralizado porque vários imports do próprio módulo
 * de produção (lib/payments/crypto.ts, lib/payments/token-preview.ts)
 * o carregam mesmo sem essas funções serem chamadas neste arquivo — o
 * pacote lança incondicionalmente ao ser importado fora de um bundle
 * Server Component, o que não se aplica ao vitest.
 */
vi.mock("server-only", () => ({}));

const requireStoreStatusMock = vi.fn();
vi.mock("@/lib/tenant/access-control", () => ({
  requireStoreStatus: (...args: unknown[]) => requireStoreStatusMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({})),
}));

const getStorePaymentCredentialsMock = vi.fn();
vi.mock("@/lib/payments/service-only/credentials-reader", () => ({
  getStorePaymentCredentials: (...args: unknown[]) => getStorePaymentCredentialsMock(...args),
}));

const validateCredentialsMock = vi.fn();
const getPixPaymentGatewayMock = vi.fn(() => ({ validateCredentials: validateCredentialsMock }));
vi.mock("@/lib/payments/gateway", () => ({
  getPixPaymentGateway: () => getPixPaymentGatewayMock(),
}));

const markPaymentSettingsVerifiedMock = vi.fn();
vi.mock("@/lib/payments/settings-service", () => ({
  PaymentSettingsError: class PaymentSettingsError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  markPaymentSettingsVerified: (...args: unknown[]) => markPaymentSettingsVerifiedMock(...args),
  savePaymentSettings: vi.fn(),
  setPaymentSettingsEnabled: vi.fn(),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

const { testPaymentConnectionAction } = await import("./actions");

function formDataFor(storeSlug: string): FormData {
  const fd = new FormData();
  fd.set("storeSlug", storeSlug);
  return fd;
}

describe("testPaymentConnectionAction — autorização (TASK008-RETEST-SEC-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
  });

  it("staff nunca lê a credencial nem chama o gateway do provedor", async () => {
    requireStoreStatusMock.mockResolvedValue({
      store: { id: "store-1", slug: "store-a", name: "Mercado Aurora", status: "active" },
      role: "staff",
    });

    await expect(testPaymentConnectionAction(formDataFor("store-a"))).rejects.toThrow("REDIRECT:/dashboard?store=store-a");

    expect(getStorePaymentCredentialsMock).not.toHaveBeenCalled();
    expect(getPixPaymentGatewayMock).not.toHaveBeenCalled();
    expect(validateCredentialsMock).not.toHaveBeenCalled();
    expect(markPaymentSettingsVerifiedMock).not.toHaveBeenCalled();
  });

  it("owner consegue prosseguir: credencial é lida e o gateway é chamado", async () => {
    requireStoreStatusMock.mockResolvedValue({
      store: { id: "store-1", slug: "store-a", name: "Mercado Aurora", status: "active" },
      role: "owner",
    });
    getStorePaymentCredentialsMock.mockResolvedValue({
      storeId: "store-1",
      accessToken: "TEST-fake-token",
      webhookSecret: "fake-secret",
      webhookKey: "fake-key",
      environment: "test",
      isEnabled: true,
    });
    validateCredentialsMock.mockResolvedValue({ ok: true });

    await expect(testPaymentConnectionAction(formDataFor("store-a"))).rejects.toThrow("REDIRECT:/dashboard/settings/payments?store=store-a");

    expect(getStorePaymentCredentialsMock).toHaveBeenCalledWith("store-1");
    expect(getPixPaymentGatewayMock).toHaveBeenCalledTimes(1);
    expect(validateCredentialsMock).toHaveBeenCalledWith({ accessToken: "TEST-fake-token", environment: "test" });
    expect(markPaymentSettingsVerifiedMock).toHaveBeenCalledWith(
      expect.anything(),
      { storeId: "store-1", ok: true, errorCode: undefined },
    );
  });

  it("admin também é autorizado", async () => {
    requireStoreStatusMock.mockResolvedValue({
      store: { id: "store-2", slug: "store-b", name: "Empório Horizonte", status: "active" },
      role: "admin",
    });
    getStorePaymentCredentialsMock.mockResolvedValue({
      storeId: "store-2",
      accessToken: "TEST-fake-token-b",
      webhookSecret: "fake-secret-b",
      webhookKey: "fake-key-b",
      environment: "test",
      isEnabled: false,
    });
    validateCredentialsMock.mockResolvedValue({ ok: false, errorCode: "invalid_credentials" });

    await expect(testPaymentConnectionAction(formDataFor("store-b"))).rejects.toThrow("REDIRECT:/dashboard/settings/payments?store=store-b");

    expect(getStorePaymentCredentialsMock).toHaveBeenCalledWith("store-2");
    expect(getPixPaymentGatewayMock).toHaveBeenCalledTimes(1);
  });

  it("a credencial nunca é buscada antes da checagem de role (ordem de execução real)", async () => {
    const callOrder: string[] = [];
    requireStoreStatusMock.mockImplementation(async () => {
      callOrder.push("requireStoreStatus");
      return { store: { id: "store-1", slug: "store-a", name: "Mercado Aurora", status: "active" }, role: "staff" };
    });
    getStorePaymentCredentialsMock.mockImplementation(async () => {
      callOrder.push("getStorePaymentCredentials");
      return null;
    });

    await expect(testPaymentConnectionAction(formDataFor("store-a"))).rejects.toThrow("REDIRECT");

    expect(callOrder).toEqual(["requireStoreStatus"]);
  });
});
