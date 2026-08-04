import { describe, expect, it } from "vitest";
import { storeStatusRedirectPath } from "./store-redirect";

describe("storeStatusRedirectPath", () => {
  it("mapeia cada status para a rota correta (sem slug)", () => {
    expect(storeStatusRedirectPath("onboarding")).toBe("/onboarding");
    expect(storeStatusRedirectPath("pending_payment")).toBe("/pending-payment");
    expect(storeStatusRedirectPath("active")).toBe("/dashboard");
    expect(storeStatusRedirectPath("suspended")).toBe("/suspended");
  });

  it("anexa ?store=slug quando informado, exceto para onboarding", () => {
    expect(storeStatusRedirectPath("pending_payment", "loja-x")).toBe("/pending-payment?store=loja-x");
    expect(storeStatusRedirectPath("active", "loja-x")).toBe("/dashboard?store=loja-x");
    expect(storeStatusRedirectPath("suspended", "loja-x")).toBe("/suspended?store=loja-x");
  });

  it("onboarding nunca carrega ?store= (a loja ainda não está pronta/confirmada)", () => {
    expect(storeStatusRedirectPath("onboarding", "loja-x")).toBe("/onboarding");
  });

  it("codifica o slug na query string", () => {
    expect(storeStatusRedirectPath("active", "loja com espaço")).toBe(
      "/dashboard?store=loja%20com%20espa%C3%A7o",
    );
  });
});
