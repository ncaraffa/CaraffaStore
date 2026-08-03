import { describe, expect, it } from "vitest";
import { hashIdentifier } from "./hash";

describe("hashIdentifier", () => {
  it("é determinístico para o mesmo valor", () => {
    expect(hashIdentifier("fulano@example.test")).toBe(hashIdentifier("fulano@example.test"));
  });

  it("normaliza maiúsculas/minúsculas e espaços nas pontas", () => {
    expect(hashIdentifier("Fulano@Example.TEST")).toBe(hashIdentifier("fulano@example.test"));
    expect(hashIdentifier("  fulano@example.test  ")).toBe(hashIdentifier("fulano@example.test"));
  });

  it("gera hashes diferentes para valores diferentes", () => {
    expect(hashIdentifier("fulano@example.test")).not.toBe(hashIdentifier("beltrano@example.test"));
  });

  it("nunca contém o valor original em texto puro", () => {
    const hash = hashIdentifier("fulano@example.test");
    expect(hash).not.toContain("fulano");
    expect(hash).not.toContain("example.test");
  });

  it("é hexadecimal e de tamanho fixo", () => {
    expect(hashIdentifier("qualquer-valor")).toMatch(/^[0-9a-f]{32}$/);
  });
});
