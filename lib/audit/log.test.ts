import { describe, expect, it } from "vitest";
import { hashForAudit } from "./log";

describe("hashForAudit", () => {
  it("é determinístico para o mesmo valor", () => {
    expect(hashForAudit("fulano@example.test")).toBe(hashForAudit("fulano@example.test"));
  });

  it("normaliza maiúsculas/minúsculas e espaços nas pontas antes de gerar o hash", () => {
    expect(hashForAudit("Fulano@Example.TEST")).toBe(hashForAudit("fulano@example.test"));
    expect(hashForAudit("  fulano@example.test  ")).toBe(hashForAudit("fulano@example.test"));
  });

  it("gera hashes diferentes para e-mails diferentes", () => {
    expect(hashForAudit("fulano@example.test")).not.toBe(hashForAudit("beltrano@example.test"));
  });

  it("nunca contém o valor original em texto puro", () => {
    const hash = hashForAudit("fulano@example.test");
    expect(hash).not.toContain("fulano");
    expect(hash).not.toContain("example.test");
  });

  it("é hexadecimal e de tamanho fixo (32 caracteres)", () => {
    const hash = hashForAudit("qualquer-valor@example.test");
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });
});
