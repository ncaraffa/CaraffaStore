import { describe, expect, it } from "vitest";
import { getAuthMethods, getSessionId } from "./jwt";

function fakeJwt(payload: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature-not-verified-here`;
}

describe("getAuthMethods", () => {
  it("extrai os métodos do claim amr", () => {
    const token = fakeJwt({ amr: [{ method: "password", timestamp: 1 }, { method: "otp", timestamp: 2 }] });
    expect(getAuthMethods(token)).toEqual(["password", "otp"]);
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

describe("getSessionId", () => {
  it("extrai o claim session_id", () => {
    const token = fakeJwt({ session_id: "11111111-1111-1111-1111-111111111111" });
    expect(getSessionId(token)).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("devolve null quando session_id está ausente", () => {
    expect(getSessionId(fakeJwt({ sub: "user-1" }))).toBeNull();
  });

  it("nunca lança para um token malformado — devolve null", () => {
    expect(getSessionId("token-invalido")).toBeNull();
    expect(getSessionId("")).toBeNull();
  });

  it("ignora session_id que não é string", () => {
    expect(getSessionId(fakeJwt({ session_id: 12345 }))).toBeNull();
  });
});
