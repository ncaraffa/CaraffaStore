import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSignatureManifest, parseSignatureHeader, verifyMercadoPagoWebhookSignature } from "./webhook-signature";

const SECRET = "test-webhook-secret-abc123";

function sign(params: { dataId: string; requestId: string | null; ts: string }): string {
  const manifest = buildSignatureManifest(params);
  return createHmac("sha256", SECRET).update(manifest).digest("hex");
}

describe("parseSignatureHeader", () => {
  it("extrai ts e v1 do formato oficial", () => {
    expect(parseSignatureHeader("ts=1704908010,v1=abcdef0123")).toEqual({ ts: "1704908010", v1: "abcdef0123" });
  });

  it("aceita espaços entre os pares", () => {
    expect(parseSignatureHeader("ts=123, v1=abc")).toEqual({ ts: "123", v1: "abc" });
  });

  it("retorna null quando falta ts ou v1", () => {
    expect(parseSignatureHeader("ts=123")).toBeNull();
    expect(parseSignatureHeader("v1=abc")).toBeNull();
    expect(parseSignatureHeader("")).toBeNull();
    expect(parseSignatureHeader(null)).toBeNull();
  });
});

describe("verifyMercadoPagoWebhookSignature", () => {
  it("aceita uma assinatura válida (vetor construído pelo próprio algoritmo documentado)", () => {
    const ts = "1700000000";
    const dataId = "123456789";
    const requestId = "req-abc-123";
    const v1 = sign({ dataId, requestId, ts });

    expect(
      verifyMercadoPagoWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: requestId,
        dataId,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("aceita quando x-request-id está ausente (manifest sem a parte request-id)", () => {
    const ts = "1700000000";
    const dataId = "123456789";
    const v1 = sign({ dataId, requestId: null, ts });

    expect(
      verifyMercadoPagoWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: null,
        dataId,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("normaliza data.id para minúsculas no manifest (id alfanumérico)", () => {
    const ts = "1700000000";
    const dataIdUpper = "ABC123";
    const v1 = sign({ dataId: "abc123", requestId: null, ts });

    expect(
      verifyMercadoPagoWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: null,
        dataId: dataIdUpper,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("rejeita assinatura ausente", () => {
    expect(
      verifyMercadoPagoWebhookSignature({ xSignature: null, xRequestId: "r1", dataId: "1", secret: SECRET }),
    ).toBe(false);
  });

  it("rejeita header malformado", () => {
    expect(
      verifyMercadoPagoWebhookSignature({ xSignature: "garbage", xRequestId: "r1", dataId: "1", secret: SECRET }),
    ).toBe(false);
  });

  it("rejeita quando data.id está ausente", () => {
    const ts = "1700000000";
    const v1 = sign({ dataId: "1", requestId: null, ts });
    expect(
      verifyMercadoPagoWebhookSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: null, dataId: null, secret: SECRET }),
    ).toBe(false);
  });

  it("rejeita hash adulterado", () => {
    const ts = "1700000000";
    const dataId = "123456789";
    expect(
      verifyMercadoPagoWebhookSignature({
        xSignature: `ts=${ts},v1=${"0".repeat(64)}`,
        xRequestId: "req-1",
        dataId,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejeita quando o secret está errado", () => {
    const ts = "1700000000";
    const dataId = "123456789";
    const v1 = sign({ dataId, requestId: "req-1", ts });
    expect(
      verifyMercadoPagoWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: "req-1",
        dataId,
        secret: "wrong-secret",
      }),
    ).toBe(false);
  });

  it("rejeita quando o corpo (data.id) foi trocado depois de assinado", () => {
    const ts = "1700000000";
    const v1 = sign({ dataId: "111", requestId: "req-1", ts });
    expect(
      verifyMercadoPagoWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: "req-1",
        dataId: "222", // payload diferente do que foi assinado
        secret: SECRET,
      }),
    ).toBe(false);
  });
});
