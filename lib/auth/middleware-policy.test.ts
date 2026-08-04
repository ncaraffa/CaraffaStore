import { describe, expect, it } from "vitest";
import { resolveMiddlewareDecision } from "./middleware-policy";

function decide(overrides: Partial<Parameters<typeof resolveMiddlewareDecision>[0]>) {
  return resolveMiddlewareDecision({
    pathname: "/dashboard",
    search: "",
    isApiRoute: false,
    user: null,
    ...overrides,
  });
}

const verifiedUser = { emailConfirmedAt: "2026-08-03T00:00:00.000Z", isRecoverySession: false };
const unverifiedUser = { emailConfirmedAt: null, isRecoverySession: false };
const recoveryUser = { emailConfirmedAt: "2026-08-03T00:00:00.000Z", isRecoverySession: true };

describe("resolveMiddlewareDecision", () => {
  it("deixa rotas de API passarem sem redirecionar, mesmo anônimo", () => {
    expect(decide({ isApiRoute: true, pathname: "/api/stores/x/products", user: null })).toEqual({
      action: "next",
    });
  });

  it("deixa páginas públicas passarem mesmo sem sessão", () => {
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/confirm"]) {
      expect(decide({ pathname: path, user: null })).toEqual({ action: "next" });
    }
  });

  it("TASK-003: deixa o catálogo público (/loja/*) passar mesmo sem sessão", () => {
    for (const path of ["/loja/store-a", "/loja/store-a/produto/algum-produto"]) {
      expect(decide({ pathname: path, user: null })).toEqual({ action: "next" });
    }
  });

  it("anônimo em rota protegida é redirecionado para /login com next validado", () => {
    const result = decide({ pathname: "/dashboard", search: "", user: null });
    expect(result).toEqual({ action: "redirect", location: "/login?next=%2Fdashboard" });
  });

  it("anônimo com next contendo query preserva a query no redirect", () => {
    const result = decide({ pathname: "/dashboard", search: "?tab=pedidos", user: null });
    expect(result).toEqual({
      action: "redirect",
      location: `/login?next=${encodeURIComponent("/dashboard?tab=pedidos")}`,
    });
  });

  it("não propaga next para /login quando o destino não é permitido (defesa extra contra open redirect)", () => {
    // pathname fora da allowlist do isAllowedRedirect nunca deveria
    // chegar aqui vindo de dentro do app, mas o middleware não deve
    // confiar cegamente no pathname da requisição.
    const result = decide({ pathname: "/rota-desconhecida-fora-da-allowlist", user: null });
    expect(result).toEqual({ action: "redirect", location: "/login" });
  });

  it("autenticado não verificado em rota comum é redirecionado para /verify", () => {
    const result = decide({ pathname: "/dashboard", user: unverifiedUser });
    expect(result).toEqual({ action: "redirect", location: "/verify" });
  });

  it("autenticado não verificado pode acessar /verify, /logout e /auth/confirm", () => {
    for (const path of ["/verify", "/logout", "/auth/confirm"]) {
      expect(decide({ pathname: path, user: unverifiedUser })).toEqual({ action: "next" });
    }
  });

  it("autenticado não verificado NÃO pode acessar /login, /signup, /forgot-password, /reset-password mesmo sendo PUBLIC_PATHS para anônimo", () => {
    // Regressão: PUBLIC_PATHS existe para liberar acesso a quem não tem
    // sessão nenhuma — não pode virar uma brecha para uma sessão
    // autenticada-mas-não-verificada acessar /reset-password e trocar a
    // senha antes de confirmar o e-mail (T2-DEC-002).
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password"]) {
      expect(decide({ pathname: path, user: unverifiedUser })).toEqual({
        action: "redirect",
        location: "/verify",
      });
    }
  });

  it("autenticado e verificado passa normalmente", () => {
    const result = decide({ pathname: "/dashboard", user: verifiedUser });
    expect(result).toEqual({ action: "next" });
  });

  it("autenticado e verificado pode acessar /onboarding, /select-store, /pending-payment, /suspended", () => {
    for (const path of ["/onboarding", "/select-store", "/pending-payment", "/suspended", "/"]) {
      expect(decide({ pathname: path, user: verifiedUser })).toEqual({ action: "next" });
    }
  });

  it("sessão de recuperação de senha só acessa /reset-password e /logout", () => {
    for (const path of ["/reset-password", "/logout"]) {
      expect(decide({ pathname: path, user: recoveryUser })).toEqual({ action: "next" });
    }
  });

  it("sessão de recuperação de senha é redirecionada para /reset-password em qualquer outra rota, incluindo /dashboard e /onboarding", () => {
    // Regressão: sem esta checagem, uma sessão de recuperação (ex.: link
    // clicado num computador compartilhado) daria acesso total à conta,
    // não só à troca de senha.
    for (const path of ["/dashboard", "/onboarding", "/select-store", "/verify", "/login", "/"]) {
      expect(decide({ pathname: path, user: recoveryUser })).toEqual({
        action: "redirect",
        location: "/reset-password",
      });
    }
  });
});
