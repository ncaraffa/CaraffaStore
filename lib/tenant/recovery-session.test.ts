import { describe, expect, it, vi } from "vitest";
import { claimRecoveryGrantForPasswordChange, isCurrentSessionRecovery } from "./recovery-session";

function fakeSupabase(rpcResult: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { rpc, __rpc: rpc } as any;
}

describe("isCurrentSessionRecovery", () => {
  it("true quando is_current_session_recovery_grant() devolve true", async () => {
    const supabase = fakeSupabase({ data: true, error: null });
    expect(await isCurrentSessionRecovery(supabase)).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("is_current_session_recovery_grant");
  });

  it("false quando a função devolve false (sessão comum, sem grant ativo)", async () => {
    const supabase = fakeSupabase({ data: false, error: null });
    expect(await isCurrentSessionRecovery(supabase)).toBe(false);
  });

  it("false quando a RPC retorna erro — nunca autoriza em caso de falha", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "boom" } });
    expect(await isCurrentSessionRecovery(supabase)).toBe(false);
  });

  it("não recebe nenhum parâmetro tipo `next`/`type`/nonce/user_id — a assinatura só aceita o cliente Supabase (qa/reports/TASK-002-RETEST.md, requisito 14)", () => {
    expect(isCurrentSessionRecovery.length).toBe(1);
  });
});

describe("claimRecoveryGrantForPasswordChange", () => {
  it("true quando claim_recovery_grant_for_password_change() devolve true", async () => {
    const supabase = fakeSupabase({ data: true, error: null });
    expect(await claimRecoveryGrantForPasswordChange(supabase)).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("claim_recovery_grant_for_password_change");
  });

  it("false quando não há grant a reivindicar (já reivindicado por uma requisição concorrente, ou nunca existiu)", async () => {
    const supabase = fakeSupabase({ data: false, error: null });
    expect(await claimRecoveryGrantForPasswordChange(supabase)).toBe(false);
  });

  it("false quando a RPC retorna erro — nunca autoriza a troca de senha em caso de falha", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "boom" } });
    expect(await claimRecoveryGrantForPasswordChange(supabase)).toBe(false);
  });

  it("não recebe nenhum parâmetro tipo nonce/user_id/session_id — a assinatura só aceita o cliente Supabase (qa/reports/TASK-002-RETEST.md, requisito 14)", () => {
    expect(claimRecoveryGrantForPasswordChange.length).toBe(1);
  });
});
