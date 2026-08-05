import { describe, expect, it } from "vitest";
import { isValidCnpj, isValidCpf, onlyDigits, parseDocument } from "./document";

describe("onlyDigits", () => {
  it("remove tudo que não é dígito", () => {
    expect(onlyDigits("111.444.777-35")).toBe("11144477735");
    expect(onlyDigits("11.444.777/0001-61")).toBe("11444777000161");
  });
});

describe("isValidCpf", () => {
  it("aceita um CPF com dígitos verificadores corretos", () => {
    expect(isValidCpf("11144477735")).toBe(true);
  });

  it("rejeita dígito verificador incorreto", () => {
    expect(isValidCpf("11144477736")).toBe(false);
  });

  it("rejeita todos os dígitos iguais", () => {
    expect(isValidCpf("11111111111")).toBe(false);
  });

  it("rejeita tamanho errado", () => {
    expect(isValidCpf("123")).toBe(false);
  });
});

describe("isValidCnpj", () => {
  it("aceita um CNPJ com dígitos verificadores corretos", () => {
    expect(isValidCnpj("11444777000161")).toBe(true);
  });

  it("rejeita dígito verificador incorreto", () => {
    expect(isValidCnpj("11444777000162")).toBe(false);
  });

  it("rejeita todos os dígitos iguais", () => {
    expect(isValidCnpj("11111111111111")).toBe(false);
  });
});

describe("parseDocument", () => {
  it("detecta CPF por tamanho e valida", () => {
    expect(parseDocument("111.444.777-35")).toEqual({ type: "CPF", digits: "11144477735" });
  });

  it("detecta CNPJ por tamanho e valida", () => {
    expect(parseDocument("11.444.777/0001-61")).toEqual({ type: "CNPJ", digits: "11444777000161" });
  });

  it("retorna null para documento inválido", () => {
    expect(parseDocument("123456")).toBeNull();
    expect(parseDocument("00000000000")).toBeNull();
  });
});
