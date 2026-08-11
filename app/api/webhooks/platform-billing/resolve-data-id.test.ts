import { describe, expect, it } from "vitest";
import { resolveWebhookDataId } from "./resolve-data-id";

describe("resolveWebhookDataId — QA-FINAL-005", () => {
  it("query e body iguais — segue com o valor", () => {
    expect(resolveWebhookDataId("42", "42")).toEqual({ dataId: "42", inconsistent: false });
  });

  it("query presente, body ausente — segue com o valor da query", () => {
    expect(resolveWebhookDataId("42", null)).toEqual({ dataId: "42", inconsistent: false });
  });

  it("query ausente, body presente — usa o body como reserva (formato de notificação sem query)", () => {
    expect(resolveWebhookDataId(null, "42")).toEqual({ dataId: "42", inconsistent: false });
  });

  it("query e body diferentes — rejeita como inconsistente, não escolhe nenhum dos dois", () => {
    const result = resolveWebhookDataId("42", "99");
    expect(result.inconsistent).toBe(true);
    expect(result.dataId).toBeNull();
  });

  it("query é a fonte de verdade quando ambos presentes e iguais (não é o body que decide)", () => {
    expect(resolveWebhookDataId("42", "42").dataId).toBe("42");
  });

  it("nenhum dos dois presente — dataId null, sem inconsistência (handlePlatformBillingWebhook rejeita como invalid_request)", () => {
    expect(resolveWebhookDataId(null, null)).toEqual({ dataId: null, inconsistent: false });
  });
});
