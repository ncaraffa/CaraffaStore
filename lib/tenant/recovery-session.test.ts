import { describe, expect, it, vi } from "vitest";
import { claimRecoveryGrantForPasswordChange, isCurrentSessionRecovery } from "./recovery-session";

const FAKE_NONCE = "test-nonce-value-not-a-real-secret";

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
  const CAPABILITY = "a".repeat(64);
  const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

  it("claimed=true + attemptId/completionCapability quando o jsonb retornado tem claimed=true e os dois campos preenchidos", async () => {
    const supabase = fakeSupabase({
      data: { claimed: true, attempt_id: ATTEMPT_ID, completion_capability: CAPABILITY },
      error: null,
    });
    const result = await claimRecoveryGrantForPasswordChange(supabase, FAKE_NONCE);
    expect(result).toEqual({ claimed: true, attemptId: ATTEMPT_ID, completionCapability: CAPABILITY });
    expect(supabase.rpc).toHaveBeenCalledWith("claim_recovery_grant_for_password_change", {
      p_nonce: FAKE_NONCE,
    });
  });

  it("claimed=false quando não há tentativa a reivindicar (já reivindicada por uma requisição concorrente, ou nunca existiu)", async () => {
    const supabase = fakeSupabase({ data: { claimed: false, attempt_id: null, completion_capability: null }, error: null });
    expect(await claimRecoveryGrantForPasswordChange(supabase, FAKE_NONCE)).toEqual({
      claimed: false,
      attemptId: null,
      completionCapability: null,
    });
  });

  it("claimed=false quando a RPC retorna erro — nunca autoriza a troca de senha em caso de falha", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "boom" } });
    expect(await claimRecoveryGrantForPasswordChange(supabase, FAKE_NONCE)).toEqual({
      claimed: false,
      attemptId: null,
      completionCapability: null,
    });
  });

  it("claimed=false quando o jsonb afirma claimed=true mas está sem attempt_id/completion_capability (defensivo — nunca deveria acontecer no banco real)", async () => {
    const supabase = fakeSupabase({ data: { claimed: true, attempt_id: null, completion_capability: null }, error: null });
    expect(await claimRecoveryGrantForPasswordChange(supabase, FAKE_NONCE)).toEqual({
      claimed: false,
      attemptId: null,
      completionCapability: null,
    });
  });

  it("claimed=false quando o nonce está ausente/vazio — nunca chama a RPC sem nonce (qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-001)", async () => {
    const supabase = fakeSupabase({ data: { claimed: true, attempt_id: ATTEMPT_ID, completion_capability: CAPABILITY }, error: null });
    expect(await claimRecoveryGrantForPasswordChange(supabase, undefined)).toEqual({
      claimed: false,
      attemptId: null,
      completionCapability: null,
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("exige exatamente dois parâmetros: o cliente Supabase e o nonce — nada de user_id/session_id vindo de outro lugar (qa/reports/TASK-002-RETEST.md, requisito 14)", () => {
    expect(claimRecoveryGrantForPasswordChange.length).toBe(2);
  });
});
