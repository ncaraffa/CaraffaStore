import { describe, expect, it } from "vitest";
import {
  forgotPasswordSchema,
  loginSchema,
  merchantProfileSchema,
  planSchema,
  resetPasswordSchema,
  signupSchema,
  slugSchema,
  storeNameSchema,
} from "./schemas";

describe("signupSchema", () => {
  it("rejeita senha com 14 caracteres", () => {
    const result = signupSchema.safeParse({ email: "a@example.test", password: "a".repeat(14) });
    expect(result.success).toBe(false);
  });

  it("aceita senha com 15 caracteres (mínimo)", () => {
    const result = signupSchema.safeParse({ email: "a@example.test", password: "a".repeat(15) });
    expect(result.success).toBe(true);
  });

  it("aceita senha com 64 caracteres", () => {
    const result = signupSchema.safeParse({ email: "a@example.test", password: "a".repeat(64) });
    expect(result.success).toBe(true);
  });

  it("aceita frase-senha com espaços", () => {
    const result = signupSchema.safeParse({
      email: "a@example.test",
      password: "correto cavalo bateria grampo",
    });
    expect(result.success).toBe(true);
  });

  it("normaliza e-mail para minúsculas e sem espaços nas pontas", () => {
    const result = signupSchema.safeParse({
      email: "  Fulano@Example.TEST  ",
      password: "a".repeat(20),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("fulano@example.test");
    }
  });

  it("rejeita e-mail inválido", () => {
    expect(signupSchema.safeParse({ email: "nao-e-email", password: "a".repeat(20) }).success).toBe(
      false,
    );
  });
});

describe("loginSchema", () => {
  it("aceita senha curta (não é o lugar de aplicar a política de força)", () => {
    // O login não deve diferenciar "senha errada" de "senha fora da
    // política" — ambos resultam na mesma mensagem genérica na Server
    // Action, então o schema de login não pode rejeitar por comprimento.
    const result = loginSchema.safeParse({ email: "a@example.test", password: "123" });
    expect(result.success).toBe(true);
  });

  it("rejeita senha vazia", () => {
    expect(loginSchema.safeParse({ email: "a@example.test", password: "" }).success).toBe(false);
  });
});

describe("forgotPasswordSchema / resetPasswordSchema", () => {
  it("forgotPassword exige e-mail válido", () => {
    expect(forgotPasswordSchema.safeParse({ email: "invalido" }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: "a@example.test" }).success).toBe(true);
  });

  it("resetPassword aplica a mesma política de senha do cadastro", () => {
    expect(resetPasswordSchema.safeParse({ password: "a".repeat(14) }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "a".repeat(15) }).success).toBe(true);
  });
});

describe("merchantProfileSchema", () => {
  it("aceita nome e whatsapp válidos", () => {
    expect(
      merchantProfileSchema.safeParse({ merchantName: "Fulano de Tal", whatsapp: "+5511999998888" })
        .success,
    ).toBe(true);
  });

  it("rejeita whatsapp com letras", () => {
    expect(
      merchantProfileSchema.safeParse({ merchantName: "Fulano", whatsapp: "não é telefone" }).success,
    ).toBe(false);
  });

  it("rejeita nome de 1 caractere", () => {
    expect(merchantProfileSchema.safeParse({ merchantName: "F", whatsapp: "+5511999998888" }).success).toBe(
      false,
    );
  });
});

describe("storeNameSchema", () => {
  it("rejeita nome vazio", () => {
    expect(storeNameSchema.safeParse({ storeName: "" }).success).toBe(false);
  });

  it("aceita nome válido", () => {
    expect(storeNameSchema.safeParse({ storeName: "Loja do Fulano" }).success).toBe(true);
  });
});

describe("slugSchema", () => {
  it("aceita qualquer texto não vazio (normalização/validação real fica no banco)", () => {
    expect(slugSchema.safeParse({ slug: "Loja do Fulano!!" }).success).toBe(true);
  });

  it("rejeita slug vazio", () => {
    expect(slugSchema.safeParse({ slug: "" }).success).toBe(false);
    expect(slugSchema.safeParse({ slug: "   " }).success).toBe(false);
  });
});

describe("planSchema", () => {
  it("aceita 30, 50 e 80", () => {
    for (const plan of [30, 50, 80]) {
      expect(planSchema.safeParse({ planCode: plan }).success).toBe(true);
    }
  });

  it("aceita valores enviados como string (form data) e converte", () => {
    const result = planSchema.safeParse({ planCode: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.planCode).toBe(50);
    }
  });

  it("rejeita plano forjado fora do conjunto fechado 30|50|80", () => {
    for (const plan of [0, 1, 29, 31, 49, 51, 79, 81, 100, -30, 999999]) {
      expect(planSchema.safeParse({ planCode: plan }).success).toBe(false);
    }
  });

  it("rejeita valor não numérico", () => {
    expect(planSchema.safeParse({ planCode: "trinta" }).success).toBe(false);
  });
});
