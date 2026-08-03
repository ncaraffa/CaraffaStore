import { describe, expect, it, vi } from "vitest";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, isPasswordLeaked, validatePasswordPolicy } from "./password-policy";

describe("validatePasswordPolicy", () => {
  it("rejeita senha com 14 caracteres (abaixo do mínimo)", () => {
    const result = validatePasswordPolicy("a".repeat(14));
    expect(result.valid).toBe(false);
  });

  it("aceita senha com exatamente 15 caracteres (mínimo)", () => {
    const result = validatePasswordPolicy("a".repeat(15));
    expect(result.valid).toBe(true);
  });

  it("aceita senha com 64 caracteres", () => {
    const result = validatePasswordPolicy("a".repeat(64));
    expect(result.valid).toBe(true);
  });

  it("aceita senha com 128 caracteres (máximo aceito)", () => {
    const result = validatePasswordPolicy("a".repeat(MAX_PASSWORD_LENGTH));
    expect(result.valid).toBe(true);
  });

  it("rejeita senha acima do máximo aceito", () => {
    const result = validatePasswordPolicy("a".repeat(MAX_PASSWORD_LENGTH + 1));
    expect(result.valid).toBe(false);
  });

  it("aceita frase-senha com espaços, sem exigir composição", () => {
    const result = validatePasswordPolicy("correto cavalo bateria grampo azul");
    expect(result.valid).toBe(true);
  });

  it("aceita senha só com letras minúsculas (sem exigência de maiúscula/número/símbolo)", () => {
    const result = validatePasswordPolicy("somenteletrasminusculas");
    expect(result.valid).toBe(true);
  });

  it("preserva espaços líderes/finais sem alterar a senha (não faz trim)", () => {
    const withSpaces = "  senha com espacos nas pontas  ";
    expect(withSpaces.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    const result = validatePasswordPolicy(withSpaces);
    expect(result.valid).toBe(true);
  });

  it("rejeita valores que não são string", () => {
    expect(validatePasswordPolicy(12345678901234567890).valid).toBe(false);
    expect(validatePasswordPolicy(null).valid).toBe(false);
    expect(validatePasswordPolicy(undefined).valid).toBe(false);
  });
});

describe("isPasswordLeaked", () => {
  it("sempre false quando desativado (padrão local, sem chamada de rede)", async () => {
    const fetchImpl = vi.fn();
    const result = await isPasswordLeaked("qualquer-coisa", {
      enabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("envia apenas o prefixo de 5 caracteres do hash (k-anonimato) quando ativado", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      // SHA-1("senha-de-teste-conhecida") calculado offline para o teste;
      // só o prefixo pode aparecer na URL, nunca a senha em si.
      expect(String(url)).toContain("api.pwnedpasswords.com/range/");
      expect(String(url)).not.toContain("senha-de-teste-conhecida");
      return new Response("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:5\n", { status: 200 });
    });
    await isPasswordLeaked("senha-de-teste-conhecida", {
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("detecta senha vazada quando o sufixo aparece na resposta com contagem > 0", async () => {
    const password = "password123456789";
    const { createHash } = await import("node:crypto");
    const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const suffix = sha1.slice(5);

    const fetchImpl = vi.fn(async () => new Response(`${suffix}:42\nOUTRO0000000000000000000000000000:0\n`, { status: 200 }));
    const result = await isPasswordLeaked(password, { enabled: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toBe(true);
  });

  it("não marca como vazada quando o sufixo não aparece na resposta", async () => {
    const fetchImpl = vi.fn(async () => new Response("0000000000000000000000000000000000:9\n", { status: 200 }));
    const result = await isPasswordLeaked("uma-senha-qualquer-nao-vazada", {
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe(false);
  });

  it("ignora entradas de padding com contagem 0", async () => {
    const password = "outra-senha-de-teste-para-padding";
    const { createHash } = await import("node:crypto");
    const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const suffix = sha1.slice(5);

    // Mesmo sufixo aparecendo com contagem 0 não deveria acontecer na API
    // real (padding usa sufixos aleatórios), mas o parser deve tratar
    // count=0 como "não vazada" de qualquer forma, por segurança.
    const fetchImpl = vi.fn(async () => new Response(`${suffix}:0\n`, { status: 200 }));
    const result = await isPasswordLeaked(password, { enabled: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toBe(false);
  });

  it("falha aberta (não vazada) quando o serviço externo está indisponível", async () => {
    const fetchImpl = vi.fn(async () => new Response("erro", { status: 503 }));
    const result = await isPasswordLeaked("qualquer-senha-longa-o-suficiente", {
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe(false);
  });

  it("falha aberta quando o fetch lança (rede indisponível)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await isPasswordLeaked("qualquer-senha-longa-o-suficiente", {
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe(false);
  });
});
