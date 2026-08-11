import { describe, expect, it, vi } from "vitest";
import { resolveMembershipSituation, resolveUserDestination } from "./membership";

interface FakeStoreMembersRow {
  store_id: string;
  role: "owner" | "admin" | "staff";
}

interface FakeStoreRow {
  id: string;
  slug: string;
  name: string;
  status: "onboarding" | "pending_payment" | "active" | "suspended";
}

function fakeSupabase(
  memberships: FakeStoreMembersRow[],
  stores: Record<string, FakeStoreRow>,
  options: { isPlatformAdmin?: boolean } = {},
) {
  return {
    from: vi.fn((table: string) => {
      if (table === "store_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: memberships, error: null }),
          }),
        };
      }
      if (table === "stores") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn((_col: string, id: string) => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: stores[id] ?? null, error: null }),
            })),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);

    }),
    rpc: vi.fn((fn: string) => {
      if (fn === "is_platform_admin") {
        return Promise.resolve({ data: options.isPlatformAdmin ?? false, error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    }),

  } as any;
}

describe("resolveMembershipSituation", () => {
  it("kind=none quando o usuário não tem nenhum membership (usuário sem loja)", async () => {
    const supabase = fakeSupabase([], {});
    expect(await resolveMembershipSituation(supabase, "user-1")).toEqual({ kind: "none" });
  });

  it("kind=multiple quando há mais de um membership (múltiplas memberships sem seleção -> seletor)", async () => {
    const supabase = fakeSupabase(
      [
        { store_id: "store-a", role: "staff" },
        { store_id: "store-b", role: "owner" },
      ],
      {},
    );
    expect(await resolveMembershipSituation(supabase, "user-1")).toEqual({ kind: "multiple", count: 2 });
  });

  it("kind=one com a loja e o papel corretos quando há exatamente um membership", async () => {
    const supabase = fakeSupabase(
      [{ store_id: "store-a", role: "owner" }],
      { "store-a": { id: "store-a", slug: "loja-a", name: "Loja A", status: "pending_payment" } },
    );
    const result = await resolveMembershipSituation(supabase, "user-1");
    expect(result).toEqual({
      kind: "one",
      store: { id: "store-a", slug: "loja-a", name: "Loja A", status: "pending_payment" },
      role: "owner",
    });
  });

  it("kind=none quando o membership existe mas a loja não resolve (nunca quebra, cai para onboarding)", async () => {
    const supabase = fakeSupabase([{ store_id: "store-fantasma", role: "owner" }], {});
    expect(await resolveMembershipSituation(supabase, "user-1")).toEqual({ kind: "none" });
  });
});

describe("resolveUserDestination", () => {
  it("sem loja -> /onboarding", async () => {
    const supabase = fakeSupabase([], {});
    const result = await resolveUserDestination(supabase, "user-1");
    expect(result.path).toBe("/onboarding");
    expect(result.membershipCount).toBe(0);
  });

  it("múltiplas lojas -> /select-store, nunca escolhe a primeira silenciosamente", async () => {
    const supabase = fakeSupabase(
      [
        { store_id: "store-a", role: "staff" },
        { store_id: "store-b", role: "owner" },
      ],
      {},
    );
    const result = await resolveUserDestination(supabase, "user-1");
    expect(result.path).toBe("/select-store");
    expect(result.membershipCount).toBe(2);
  });

  it("uma loja active -> /dashboard com o slug", async () => {
    const supabase = fakeSupabase(
      [{ store_id: "store-a", role: "owner" }],
      { "store-a": { id: "store-a", slug: "loja-ativa", name: "Loja Ativa", status: "active" } },
    );
    const result = await resolveUserDestination(supabase, "user-1");
    expect(result.path).toBe("/dashboard?store=loja-ativa");
  });

  it("uma loja suspended -> /suspended com o slug", async () => {
    const supabase = fakeSupabase(
      [{ store_id: "store-a", role: "owner" }],
      { "store-a": { id: "store-a", slug: "loja-susp", name: "Loja Suspensa", status: "suspended" } },
    );
    const result = await resolveUserDestination(supabase, "user-1");
    expect(result.path).toBe("/suspended?store=loja-susp");
  });

  it("admin da plataforma -> /admin, mesmo sem nenhuma loja", async () => {
    const supabase = fakeSupabase([], {}, { isPlatformAdmin: true });
    const result = await resolveUserDestination(supabase, "user-1");
    expect(result.path).toBe("/admin");
  });

  it("admin da plataforma -> /admin tem PRIORIDADE sobre ter uma loja própria active (conta é exclusiva pro painel do dono)", async () => {
    const supabase = fakeSupabase(
      [{ store_id: "store-a", role: "owner" }],
      { "store-a": { id: "store-a", slug: "loja-ativa", name: "Loja Ativa", status: "active" } },
      { isPlatformAdmin: true },
    );
    const result = await resolveUserDestination(supabase, "user-1");
    expect(result.path).toBe("/admin");
  });
});
