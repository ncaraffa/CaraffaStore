import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * TASK008-RETEST-SEC-001 (auditoria estendida): cancelOrderAction (ramo
 * Pix) e reconcileOrderPaymentAction chamam cancelPixOrder/
 * reconcileOrderPayment (lib/payments/admin-actions.ts), que passam por
 * getStorePaymentCredentials (service_role) e pelo gateway do provedor —
 * mesma classe de falha do Server Action de payments/actions.ts. Estes
 * testes provam a ORDEM real de execução do módulo de produção: só a
 * saída de requireStoreStatus é mockada (quem é o usuário), a checagem
 * de role em si é código real.
 */
vi.mock("server-only", () => ({}));

const requireStoreStatusMock = vi.fn();
vi.mock("@/lib/tenant/access-control", () => ({
  requireStoreStatus: (...args: unknown[]) => requireStoreStatusMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({})),
}));

const getOrderByIdMock = vi.fn();
const advanceOrderStatusMock = vi.fn();
const cancelOrderMock = vi.fn();
vi.mock("@/lib/orders/service", () => ({
  getOrderById: (...args: unknown[]) => getOrderByIdMock(...args),
  advanceOrderStatus: (...args: unknown[]) => advanceOrderStatusMock(...args),
  cancelOrder: (...args: unknown[]) => cancelOrderMock(...args),
}));

const cancelPixOrderMock = vi.fn();
const reconcileOrderPaymentMock = vi.fn();
vi.mock("@/lib/payments/admin-actions", () => ({
  cancelPixOrder: (...args: unknown[]) => cancelPixOrderMock(...args),
  reconcileOrderPayment: (...args: unknown[]) => reconcileOrderPaymentMock(...args),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

const { cancelOrderAction, reconcileOrderPaymentAction } = await import("./actions");

function formDataFor(storeSlug: string, orderId: string): FormData {
  const fd = new FormData();
  fd.set("storeSlug", storeSlug);
  fd.set("orderId", orderId);
  return fd;
}

describe("reconcileOrderPaymentAction — autorização", () => {
  beforeEach(() => vi.clearAllMocks());

  it("staff nunca aciona reconcileOrderPayment (que lê credencial e chama o provedor)", async () => {
    requireStoreStatusMock.mockResolvedValue({ store: { id: "s1", slug: "store-a" }, role: "staff" });

    await expect(reconcileOrderPaymentAction(formDataFor("store-a", "order-1"))).rejects.toThrow(
      "REDIRECT:/dashboard/orders/order-1?store=store-a",
    );

    expect(reconcileOrderPaymentMock).not.toHaveBeenCalled();
  });

  it("owner/admin conseguem reconciliar", async () => {
    requireStoreStatusMock.mockResolvedValue({ store: { id: "s1", slug: "store-a" }, role: "owner" });
    reconcileOrderPaymentMock.mockResolvedValue(true);

    await expect(reconcileOrderPaymentAction(formDataFor("store-a", "order-1"))).rejects.toThrow("REDIRECT");

    expect(reconcileOrderPaymentMock).toHaveBeenCalledWith("order-1");
  });
});

describe("cancelOrderAction — autorização no ramo Pix", () => {
  beforeEach(() => vi.clearAllMocks());

  it("staff não aciona cancelPixOrder para pedido Pix (mesma leitura de credencial protegida)", async () => {
    requireStoreStatusMock.mockResolvedValue({ store: { id: "s1", slug: "store-a" }, role: "staff" });
    getOrderByIdMock.mockResolvedValue({ id: "order-pix", payment_mode: "pix" });

    await expect(cancelOrderAction(formDataFor("store-a", "order-pix"))).rejects.toThrow("REDIRECT");

    expect(cancelPixOrderMock).not.toHaveBeenCalled();
  });

  it("owner/admin conseguem cancelar pedido Pix", async () => {
    requireStoreStatusMock.mockResolvedValue({ store: { id: "s1", slug: "store-a" }, role: "admin" });
    getOrderByIdMock.mockResolvedValue({ id: "order-pix", payment_mode: "pix" });
    cancelPixOrderMock.mockResolvedValue("cancelled");

    await expect(cancelOrderAction(formDataFor("store-a", "order-pix"))).rejects.toThrow("REDIRECT");

    expect(cancelPixOrderMock).toHaveBeenCalledWith("order-pix");
  });

  it("staff continua podendo cancelar pedido manual (não-Pix) — sem regressão de escopo existente", async () => {
    requireStoreStatusMock.mockResolvedValue({ store: { id: "s1", slug: "store-a" }, role: "staff" });
    getOrderByIdMock.mockResolvedValue({ id: "order-manual", payment_mode: "manual" });
    cancelOrderMock.mockResolvedValue({ id: "order-manual", status: "cancelled" });

    await expect(cancelOrderAction(formDataFor("store-a", "order-manual"))).rejects.toThrow("REDIRECT");

    expect(cancelOrderMock).toHaveBeenCalled();
    expect(cancelPixOrderMock).not.toHaveBeenCalled();
  });
});
