import { describe, expect, it } from "vitest";
import { isAllowedRedirect, safeRedirectTarget } from "./redirects";

describe("isAllowedRedirect", () => {
  it("aceita destinos internos conhecidos", () => {
    expect(isAllowedRedirect("/")).toBe(true);
    expect(isAllowedRedirect("/login")).toBe(true);
    expect(isAllowedRedirect("/onboarding")).toBe(true);
    expect(isAllowedRedirect("/onboarding/slug")).toBe(true);
    expect(isAllowedRedirect("/dashboard?tab=pedidos")).toBe(true);
  });

  it("rejeita URLs absolutas (http/https)", () => {
    expect(isAllowedRedirect("https://evil.com")).toBe(false);
    expect(isAllowedRedirect("http://evil.com/login")).toBe(false);
  });

  it("rejeita protocol-relative (//host)", () => {
    expect(isAllowedRedirect("//evil.com")).toBe(false);
    expect(isAllowedRedirect("//evil.com/login")).toBe(false);
  });

  it("rejeita variantes com backslash usadas para simular //host", () => {
    expect(isAllowedRedirect("/\\evil.com")).toBe(false);
    expect(isAllowedRedirect("\\\\evil.com")).toBe(false);
  });

  it("rejeita caminho fora da allowlist", () => {
    expect(isAllowedRedirect("/nao-existe")).toBe(false);
    expect(isAllowedRedirect("/admin")).toBe(false);
  });

  it("rejeita tentativa de escapar a allowlist via dot-segments", () => {
    expect(isAllowedRedirect("/onboarding/../../evil")).toBe(false);
  });

  it("rejeita valores vazios/nulos/indefinidos", () => {
    expect(isAllowedRedirect("")).toBe(false);
    expect(isAllowedRedirect(null)).toBe(false);
    expect(isAllowedRedirect(undefined)).toBe(false);
  });

  it("rejeita string absurdamente longa", () => {
    expect(isAllowedRedirect(`/dashboard?x=${"a".repeat(600)}`)).toBe(false);
  });

  it("rejeita caminho malformado", () => {
    expect(isAllowedRedirect("/%")).toBe(false);
  });
});

describe("safeRedirectTarget", () => {
  it("devolve o candidato quando permitido", () => {
    expect(safeRedirectTarget("/onboarding")).toBe("/onboarding");
  });

  it("devolve o fallback quando não permitido", () => {
    expect(safeRedirectTarget("https://evil.com")).toBe("/");
    expect(safeRedirectTarget("https://evil.com", "/login")).toBe("/login");
  });
});
