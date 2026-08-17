import { describe, expect, it } from "vitest";
import { describeSubscription, EXPIRY_WARNING_DAYS, OVERDUE_GRACE_DAYS, type SubscriptionSummary } from "./subscription";

const NOW = new Date("2026-08-16T12:00:00.000Z");

function summary(periodEnd: string | null): SubscriptionSummary {
  return {
    currentPlanCode: 30,
    subscribedAt: "2026-01-10T12:00:00.000Z",
    currentPeriodStart: "2026-07-17T12:00:00.000Z",
    currentPeriodEnd: periodEnd,
    lastApprovedPlanCode: 30,
    lastApprovedAmountCents: 3000,
  };
}

/** Dias exatos a partir de NOW, para não depender de aritmética no teste. */
function inDays(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe("describeSubscription", () => {
  it("assinatura confortável: não avisa nada", () => {
    const result = describeSubscription(summary(inDays(20)), NOW);
    expect(result.daysRemaining).toBe(20);
    expect(result.isExpired).toBe(false);
    expect(result.isExpiringSoon).toBe(false);
  });

  it("exatamente no limite do aviso (5 dias) já avisa — o dia do corte está DENTRO da janela", () => {
    const result = describeSubscription(summary(inDays(EXPIRY_WARNING_DAYS)), NOW);
    expect(result.daysRemaining).toBe(EXPIRY_WARNING_DAYS);
    expect(result.isExpiringSoon).toBe(true);
    expect(result.isExpired).toBe(false);
  });

  it("um dia antes da janela (6 dias) ainda não avisa", () => {
    const result = describeSubscription(summary(inDays(EXPIRY_WARNING_DAYS + 1)), NOW);
    expect(result.isExpiringSoon).toBe(false);
  });

  it("faltando poucas horas: arredonda para CIMA (1 dia), nunca mostra 0 para quem ainda não venceu", () => {
    const result = describeSubscription(summary(new Date(NOW.getTime() + 30 * 60 * 1000).toISOString()), NOW);
    expect(result.daysRemaining).toBe(1);
    expect(result.isExpired).toBe(false);
    expect(result.isExpiringSoon).toBe(true);
  });

  it("vencida: isExpired, nunca isExpiringSoon ao mesmo tempo (são estados excludentes na interface)", () => {
    const result = describeSubscription(summary(inDays(-3)), NOW);
    expect(result.isExpired).toBe(true);
    expect(result.isExpiringSoon).toBe(false);
    expect(result.daysRemaining).toBe(-3);
  });

  it("vencida no exato instante: já conta como vencida", () => {
    const result = describeSubscription(summary(NOW.toISOString()), NOW);
    expect(result.isExpired).toBe(true);
    expect(result.daysRemaining).toBe(0);
  });

  it("loja sem nenhuma cobrança aprovada não é 'vencida' nem 'vencendo' — só não tem assinatura", () => {
    const result = describeSubscription(summary(null), NOW);
    expect(result.daysRemaining).toBeNull();
    expect(result.isExpired).toBe(false);
    expect(result.isExpiringSoon).toBe(false);
  });

  it("preserva o resumo original sem alterar nenhum campo", () => {
    const input = summary(inDays(10));
    const result = describeSubscription(input, NOW);
    expect(result.currentPlanCode).toBe(input.currentPlanCode);
    expect(result.subscribedAt).toBe(input.subscribedAt);
    expect(result.currentPeriodStart).toBe(input.currentPeriodStart);
    expect(result.lastApprovedAmountCents).toBe(input.lastApprovedAmountCents);
  });
});

describe("constantes de prazo", () => {
  it("a janela de aviso é menor que a carência antes do bloqueio — senão o lojista só seria avisado depois de já poder ser bloqueado", () => {
    expect(EXPIRY_WARNING_DAYS).toBeLessThan(OVERDUE_GRACE_DAYS);
  });

  it("OVERDUE_GRACE_DAYS espelha o interval '7 days' de billing_suspend_overdue_stores (0010)", () => {
    expect(OVERDUE_GRACE_DAYS).toBe(7);
  });
});
