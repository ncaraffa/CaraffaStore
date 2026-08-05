import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("mantém só dígitos, removendo espaços/parênteses/traço", () => {
    expect(normalizePhone("(11) 99999-8888")).toBe("11999998888");
  });

  it("preserva um + inicial", () => {
    expect(normalizePhone("+55 11 99999-8888")).toBe("+5511999998888");
  });

  it("rejeita menos de 8 dígitos", () => {
    expect(normalizePhone("1234567")).toBeNull();
  });

  it("rejeita mais de 15 dígitos", () => {
    expect(normalizePhone("1234567890123456")).toBeNull();
  });

  it("rejeita string vazia/só espaços", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });

  it("aceita exatamente 8 e exatamente 15 dígitos (limites)", () => {
    expect(normalizePhone("12345678")).toBe("12345678");
    expect(normalizePhone("123456789012345")).toBe("123456789012345");
  });

  it("ignora letras e outros caracteres não numéricos", () => {
    expect(normalizePhone("11 abcxyz 99999-8888")).toBe("11999998888");
  });
});
