import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((location: string) => {
  throw new Error(`REDIRECT:${location}`);
});

vi.mock("next/navigation", () => ({
  redirect: (location: string) => redirectMock(location),
}));

const isCurrentSessionRecoveryMock = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/tenant/recovery-session", () => ({
  isCurrentSessionRecovery: (...args: unknown[]) => isCurrentSessionRecoveryMock(...args),
}));

const resolveMembershipSituationMock = vi.fn();
vi.mock("@/lib/tenant/membership", () => ({
  resolveMembershipSituation: (...args: unknown[]) => resolveMembershipSituationMock(...args),
}));

class FakeForbiddenTenantError extends Error {}
const resolveAuthorizedStoreMock = vi.fn();
vi.mock("@/lib/tenant/context", () => ({
  ForbiddenTenantError: FakeForbiddenTenantError,
  resolveAuthorizedStore: (...args: unknown[]) => resolveAuthorizedStoreMock(...args),
}));

const getStoreBySlugMock = vi.fn();
vi.mock("@/lib/data/supabase-repository", () => ({
  SupabaseStoreRepository: class {
    getStoreBySlug(slug: string) {
      return getStoreBySlugMock(slug);
    }
  },
}));

const { requireOnboardingAccess, requireStoreStatus, requireVerifiedSession } = await import(
  "./access-control"
);

function fakeSupabase(user: { id: string; email_confirmed_at: string | null } | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
     
  } as any;
}

const VERIFIED_USER = { id: "user-1", email_confirmed_at: "2026-08-03T00:00:00.000Z" };

beforeEach(() => {
  redirectMock.mockClear();
  isCurrentSessionRecoveryMock.mockReset().mockResolvedValue(false);
  resolveMembershipSituationMock.mockReset();
  resolveAuthorizedStoreMock.mockReset();
  getStoreBySlugMock.mockReset();
});

describe("requireVerifiedSession", () => {
  it("redireciona anônimo para /login", async () => {
    const supabase = fakeSupabase(null);
    await expect(requireVerifiedSession(supabase)).rejects.toThrow("REDIRECT:/login");
  });

  it("redireciona não verificado para /verify", async () => {
    const supabase = fakeSupabase({ id: "user-1", email_confirmed_at: null });
    await expect(requireVerifiedSession(supabase)).rejects.toThrow("REDIRECT:/verify");
  });

  it("redireciona sessão de recuperação para /reset-password", async () => {
    isCurrentSessionRecoveryMock.mockResolvedValue(true);
    const supabase = fakeSupabase(VERIFIED_USER);
    await expect(requireVerifiedSession(supabase)).rejects.toThrow("REDIRECT:/reset-password");
  });

  it("devolve o userId para sessão verificada e normal", async () => {
    const supabase = fakeSupabase(VERIFIED_USER);
    await expect(requireVerifiedSession(supabase)).resolves.toEqual({ userId: "user-1" });
  });
});

describe("requireStoreStatus — guards de estado (BUG-T2-001, qa/reports/TASK-002.md)", () => {
  const supabase = () => fakeSupabase(VERIFIED_USER);

  it("pending_payment -> /dashboard: bloqueado (redireciona para /pending-payment, o destino real)", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-x", name: "Loja X", status: "pending_payment" },
      role: "owner",
    });
    await expect(requireStoreStatus(supabase(), "active")).rejects.toThrow(
      "REDIRECT:/pending-payment?store=loja-x",
    );
  });

  it("pending_payment -> /suspended: bloqueado", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-x", name: "Loja X", status: "pending_payment" },
      role: "owner",
    });
    await expect(requireStoreStatus(supabase(), "suspended")).rejects.toThrow(
      "REDIRECT:/pending-payment?store=loja-x",
    );
  });

  it("active -> /pending-payment: bloqueado", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-x", name: "Loja X", status: "active" },
      role: "owner",
    });
    await expect(requireStoreStatus(supabase(), "pending_payment")).rejects.toThrow(
      "REDIRECT:/dashboard?store=loja-x",
    );
  });

  it("active -> /suspended: bloqueado", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-x", name: "Loja X", status: "active" },
      role: "owner",
    });
    await expect(requireStoreStatus(supabase(), "suspended")).rejects.toThrow(
      "REDIRECT:/dashboard?store=loja-x",
    );
  });

  it("suspended -> /dashboard: bloqueado", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-x", name: "Loja X", status: "suspended" },
      role: "owner",
    });
    await expect(requireStoreStatus(supabase(), "active")).rejects.toThrow(
      "REDIRECT:/suspended?store=loja-x",
    );
  });

  it("usuário sem loja -> /dashboard: bloqueado (nunca acessa; ausência de ?store= NÃO pula a validação)", async () => {
    resolveMembershipSituationMock.mockResolvedValue({ kind: "none" });
    await expect(requireStoreStatus(supabase(), "active")).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("múltiplas memberships sem ?store= -> seletor, nunca acesso direto", async () => {
    resolveMembershipSituationMock.mockResolvedValue({ kind: "multiple", count: 2 });
    await expect(requireStoreStatus(supabase(), "active")).rejects.toThrow("REDIRECT:/select-store");
  });

  it("status correto, sem ?store=: acesso permitido, devolve a loja resolvida", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-ativa", name: "Loja Ativa", status: "active" },
      role: "owner",
    });
    const result = await requireStoreStatus(supabase(), "active");
    expect(result.store.slug).toBe("loja-ativa");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("slug forjado/sem membership -> bloqueado, redireciona para /select-store (ForbiddenTenantError)", async () => {
    resolveAuthorizedStoreMock.mockRejectedValue(new FakeForbiddenTenantError("sem acesso"));
    await expect(requireStoreStatus(supabase(), "active", "loja-alheia")).rejects.toThrow(
      "REDIRECT:/select-store",
    );
  });

  it("?store= válido e da própria loja, status correto: acesso permitido", async () => {
    resolveAuthorizedStoreMock.mockResolvedValue({ storeId: "s1", storeSlug: "loja-x", role: "owner" });
    getStoreBySlugMock.mockResolvedValue({ id: "s1", slug: "loja-x", name: "Loja X", status: "active" });
    const result = await requireStoreStatus(supabase(), "active", "loja-x");
    expect(result.store.slug).toBe("loja-x");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("requiredStatus como array (TASK-010): status presente na lista é permitido, sem redirecionar", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-x", name: "Loja X", status: "suspended" },
      role: "owner",
    });
    const result = await requireStoreStatus(supabase(), ["pending_payment", "suspended"]);
    expect(result.store.status).toBe("suspended");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("requiredStatus como array: status fora da lista continua bloqueado, redireciona pro destino real", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-x", name: "Loja X", status: "active" },
      role: "owner",
    });
    await expect(requireStoreStatus(supabase(), ["pending_payment", "suspended"])).rejects.toThrow(
      "REDIRECT:/dashboard?store=loja-x",
    );
  });

  it("?store= válido mas status errado: bloqueado mesmo com membership real (alterar a URL não muda o estado autorizado)", async () => {
    resolveAuthorizedStoreMock.mockResolvedValue({ storeId: "s1", storeSlug: "loja-x", role: "owner" });
    getStoreBySlugMock.mockResolvedValue({
      id: "s1",
      slug: "loja-x",
      name: "Loja X",
      status: "pending_payment",
    });
    await expect(requireStoreStatus(supabase(), "active", "loja-x")).rejects.toThrow(
      "REDIRECT:/pending-payment?store=loja-x",
    );
  });
});

describe("requireOnboardingAccess", () => {
  const supabase = () => fakeSupabase(VERIFIED_USER);

  it("usuário sem loja: acesso permitido (segue para o assistente)", async () => {
    resolveMembershipSituationMock.mockResolvedValue({ kind: "none" });
    await expect(requireOnboardingAccess(supabase())).resolves.toEqual({ userId: "user-1" });
  });

  it("múltiplas memberships -> /select-store", async () => {
    resolveMembershipSituationMock.mockResolvedValue({ kind: "multiple", count: 2 });
    await expect(requireOnboardingAccess(supabase())).rejects.toThrow("REDIRECT:/select-store");
  });

  it("loja em onboarding: acesso permitido", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-x", name: "Loja X", status: "onboarding" },
      role: "owner",
    });
    await expect(requireOnboardingAccess(supabase())).resolves.toEqual({ userId: "user-1" });
  });

  it("onboarding -> /dashboard: bloqueado (loja já pending_payment não reexibe o assistente)", async () => {
    resolveMembershipSituationMock.mockResolvedValue({
      kind: "one",
      store: { id: "s1", slug: "loja-x", name: "Loja X", status: "pending_payment" },
      role: "owner",
    });
    await expect(requireOnboardingAccess(supabase())).rejects.toThrow(
      "REDIRECT:/pending-payment?store=loja-x",
    );
  });
});
