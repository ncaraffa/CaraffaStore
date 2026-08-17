import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PlanCode } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Quantos dias antes do vencimento a assinatura já é anunciada como "vence
 * em breve" — no painel (banner) e na própria tela de assinatura. Um único
 * número, importado pelos dois lugares: se um dia virar 7, nada fica
 * dizendo 5 em outra tela.
 */
export const EXPIRY_WARNING_DAYS = 5;

/**
 * Carência antes do bloqueio automático — precisa ser o MESMO número de
 * `billing_suspend_overdue_stores()` (`interval '7 days'`,
 * 0010_billing_overdue_suspension.sql). Está aqui só para a interface
 * poder dizer ao lojista quantos dias ele tem; a decisão real de suspender
 * é sempre do banco, nunca desta constante. Mudar a carência exige mudar
 * os dois lugares.
 */
export const OVERDUE_GRACE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SubscriptionSummary {
  /** Plano VIGENTE (pago). Uma renovação com troca de plano só muda isto depois do pagamento aprovado. */
  currentPlanCode: PlanCode | null;
  /** Quando a primeira cobrança foi aprovada — "assina desde". null se nunca pagou. */
  subscribedAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  lastApprovedPlanCode: PlanCode | null;
  lastApprovedAmountCents: number | null;
}

export interface SubscriptionStatus extends SubscriptionSummary {
  /**
   * Dias inteiros até o vencimento, arredondando para CIMA: um período que
   * termina daqui a 30 minutos ainda é "1 dia", nunca "0". Negativo quando
   * já venceu (o valor absoluto é há quantos dias venceu).
   */
  daysRemaining: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

export async function getSubscriptionSummary(supabase: Client, storeId: string): Promise<SubscriptionSummary | null> {
  const { data, error } = await supabase.rpc("billing_get_subscription", { p_store_id: storeId });
  const row = data?.[0];
  if (error || !row) return null;

  return {
    currentPlanCode: row.current_plan_code,
    subscribedAt: row.subscribed_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    lastApprovedPlanCode: row.last_approved_plan_code,
    lastApprovedAmountCents: row.last_approved_amount_cents,
  };
}

/**
 * Deriva a situação temporal a partir do resumo — separado da consulta de
 * propósito, para ser testável sem banco e para o `now` poder ser injetado
 * nos testes em vez de depender do relógio da máquina.
 *
 * Uma loja sem nenhuma cobrança aprovada (`currentPeriodEnd` nulo) NÃO é
 * tratada como vencida nem como "vence em breve": ela simplesmente ainda
 * não tem assinatura, e a tela mostra esse estado em vez de um aviso
 * alarmante e sem sentido.
 */
export function describeSubscription(summary: SubscriptionSummary, now: Date = new Date()): SubscriptionStatus {
  if (!summary.currentPeriodEnd) {
    return { ...summary, daysRemaining: null, isExpired: false, isExpiringSoon: false };
  }

  const msRemaining = new Date(summary.currentPeriodEnd).getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / MS_PER_DAY);
  const isExpired = msRemaining <= 0;

  return {
    ...summary,
    daysRemaining,
    isExpired,
    isExpiringSoon: !isExpired && daysRemaining <= EXPIRY_WARNING_DAYS,
  };
}

export async function getSubscriptionStatus(supabase: Client, storeId: string): Promise<SubscriptionStatus | null> {
  const summary = await getSubscriptionSummary(supabase, storeId);
  return summary ? describeSubscription(summary) : null;
}
