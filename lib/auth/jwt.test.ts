import { describe, expect, it } from "vitest";
import { getAuthMethods, isRecoverySession } from "./jwt";

function fakeJwt(payload: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature-not-verified-here`;
}

describe("getAuthMethods", () => {
  it("extrai os métodos do claim amr", () => {
    const token = fakeJwt({ amr: [{ method: "password", timestamp: 1 }, { method: "recovery", timestamp: 2 }] });
    expect(getAuthMethods(token)).toEqual(["password", "recovery"]);
  });

  it("devolve array vazio quando amr está ausente", () => {
    expect(getAuthMethods(fakeJwt({ sub: "user-1" }))).toEqual([]);
  });

  it("nunca lança para um token malformado — devolve array vazio", () => {
    expect(getAuthMethods("nao-e-um-jwt")).toEqual([]);
    expect(getAuthMethods("")).toEqual([]);
    expect(getAuthMethods("a.b")).toEqual([]);
    expect(getAuthMethods("a.{invalido-json.c")).toEqual([]);
  });

  it("ignora entradas de amr sem method válido", () => {
    const token = fakeJwt({ amr: [{ timestamp: 1 }, { method: 42 }, { method: "otp" }] });
    expect(getAuthMethods(token)).toEqual(["otp"]);
  });
});

describe("isRecoverySession", () => {
  it("true quando o método mais recente/presente é recovery", () => {
    const token = fakeJwt({ amr: [{ method: "recovery" }] });
    expect(isRecoverySession(token)).toBe(true);
  });

  it("false para uma sessão de login normal", () => {
    const token = fakeJwt({ amr: [{ method: "password" }] });
    expect(isRecoverySession(token)).toBe(false);
  });

  it("false para token malformado (falha aberta para 'não é recovery', não para 'é recovery')", () => {
    expect(isRecoverySession("token-invalido")).toBe(false);
  });
});
