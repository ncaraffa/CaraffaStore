import { describe, expect, it, vi } from "vitest";
import { consumeRecoveryGrant, isCurrentSessionRecovery } from "./recovery-session";

function fakeJwt(payload: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

interface FakeOptions {
  session: { access_token: string } | null;
  grantSessionId: string | null;
  grantError?: { message: string } | null;
}

function fakeSupabase(options: FakeOptions) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options.grantSessionId ? { session_id: options.grantSessionId } : null,
    error: options.grantError ?? null,
  });
  const deleteNot = vi.fn().mockResolvedValue({ data: null, error: null });

  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: options.session } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ maybeSingle }),
      delete: vi.fn().mockReturnValue({ not: deleteNot }),
    }),
    __maybeSingle: maybeSingle,
    __deleteNot: deleteNot,
     
  } as any;
}

describe("isCurrentSessionRecovery", () => {
  it("true quando o session_id do grant bate com o da sessão atual (sessão de recuperação válida: permitida)", async () => {
    const token = fakeJwt({ session_id: "11111111-1111-1111-1111-111111111111" });
    const supabase = fakeSupabase({
      session: { access_token: token },
      grantSessionId: "11111111-1111-1111-1111-111111111111",
    });
    expect(await isCurrentSessionRecovery(supabase)).toBe(true);
  });

  it("false quando não há sessão (anônimo)", async () => {
    const supabase = fakeSupabase({ session: null, grantSessionId: null });
    expect(await isCurrentSessionRecovery(supabase)).toBe(false);
  });

  it("false quando não há grant nenhum — login comum não tem recovery_grants (BUG-T2-002: login comum nunca deve passar)", async () => {
    const token = fakeJwt({ session_id: "22222222-2222-2222-2222-222222222222" });
    const supabase = fakeSupabase({ session: { access_token: token }, grantSessionId: null });
    expect(await isCurrentSessionRecovery(supabase)).toBe(false);
  });

  it("false quando o grant existe mas é de uma sessão DIFERENTE (grant antigo + novo login normal depois)", async () => {
    // Simula: usuário pediu recuperação (grant com session_id A), depois
    // fez login normal de novo (sessão nova, session_id B, diferente).
    // O grant antigo continua no banco mas não deve autorizar a sessão
    // atual — prova que trocar de sessão não "herda" o grant de outra.
    const token = fakeJwt({ session_id: "session-novo-login-normal" });
    const supabase = fakeSupabase({
      session: { access_token: token },
      grantSessionId: "session-antigo-da-recuperacao",
    });
    expect(await isCurrentSessionRecovery(supabase)).toBe(false);
  });

  it("false quando o token da sessão atual não tem session_id (malformado)", async () => {
    const token = fakeJwt({ sub: "user-1" });
    const supabase = fakeSupabase({ session: { access_token: token }, grantSessionId: "qualquer" });
    expect(await isCurrentSessionRecovery(supabase)).toBe(false);
  });

  it("false quando a consulta ao grant retorna erro", async () => {
    const token = fakeJwt({ session_id: "33333333-3333-3333-3333-333333333333" });
    const supabase = fakeSupabase({
      session: { access_token: token },
      grantSessionId: "33333333-3333-3333-3333-333333333333",
      grantError: { message: "boom" },
    });
    expect(await isCurrentSessionRecovery(supabase)).toBe(false);
  });

  it("não recebe nenhum parâmetro tipo `next`/`type` — a função não tem como ser influenciada por query string (BUG-T2-003)", () => {
    // Verificação estrutural: a assinatura só aceita o cliente Supabase.
    expect(isCurrentSessionRecovery.length).toBe(1);
  });
});

describe("consumeRecoveryGrant", () => {
  it("chama delete() em recovery_grants (RLS restringe à própria linha do usuário)", async () => {
    const supabase = fakeSupabase({ session: null, grantSessionId: null });
    await consumeRecoveryGrant(supabase);
    expect(supabase.from).toHaveBeenCalledWith("recovery_grants");
    expect(supabase.__deleteNot).toHaveBeenCalled();
  });
});
