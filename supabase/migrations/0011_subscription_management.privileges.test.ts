import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0011_subscription_management.sql (área de assinatura
 * do lojista: renovação com troca de plano). Mesmo padrão de 0008/0009/0010.
 *
 * A asserção central deste arquivo é uma só, e é de dinheiro: o plano
 * escolhido NUNCA entra em store_plans fora do ramo `approved`.
 */

const migrationPath = path.resolve(import.meta.dirname, "0011_subscription_management.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function fnBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  const end = sql.indexOf(`comment on function public.${name}`);
  expect(start, `${name} não encontrada`).toBeGreaterThan(-1);
  expect(end, `comment de ${name} não encontrado`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("billing_charge_upsert_creating — p_plan_code sem nunca aceitar preço do cliente", () => {
  const fn = () => fnBody("billing_charge_upsert_creating");

  it("DROP da assinatura de 5 argumentos antes de recriar — sobrecarga deixaria a versão antiga (sem troca de plano) ativa e a chamada ambígua", () => {
    const dropIndex = sql.indexOf("drop function if exists public.billing_charge_upsert_creating(uuid, text, text, text, text);");
    const createIndex = sql.indexOf("create or replace function public.billing_charge_upsert_creating");
    expect(dropIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeLessThan(createIndex);
  });

  it("p_plan_code é opcional (default null) e cai no plano vigente quando ausente", () => {
    const body = fn();
    expect(body).toContain("p_plan_code integer default null");
    expect(body).toContain("v_plan_code := coalesce(p_plan_code, v_current_plan_code)");
  });

  it("o valor SEMPRE deriva de platform_plan_price_cents no banco — nenhum amount vem de parâmetro", () => {
    const body = fn();
    expect(body).toContain("v_amount_cents := public.platform_plan_price_cents(v_plan_code)");
    expect(body).toContain("raise exception 'invalid_plan_code'");
    expect(body).not.toContain("p_amount_cents");
  });

  it("NUNCA escreve em store_plans — a troca de plano não pode valer só por ter clicado", () => {
    const body = fn();
    expect(body).not.toContain("update public.store_plans");
    expect(body).not.toContain("insert into public.store_plans");
  });

  it("cobrança em aberto do MESMO plano é reaproveitada; de plano diferente é cancelada antes de criar a nova", () => {
    const body = fn();
    expect(body).toContain("if v_existing.plan_code = v_plan_code");
    expect(body).toContain("when v_existing.plan_code = v_plan_code then 'expired' else 'cancelled'");
  });

  it("continua concedida só a service_role", () => {
    const grantLine = sql
      .split(";")
      .find((s) => s.includes("grant execute on function public.billing_charge_upsert_creating("));
    expect(grantLine).toBeTruthy();
    expect(grantLine).toContain("service_role");
    expect(grantLine).not.toMatch(/\banon\b/);
    expect(grantLine).not.toMatch(/\bauthenticated\b/);
  });
});

describe("billing_charge_apply_provider_state — troca de plano só com pagamento aprovado", () => {
  const fn = () => fnBody("billing_charge_apply_provider_state");

  it("a escrita em store_plans está DENTRO do ramo approved", () => {
    const body = fn();
    const approvedIndex = body.indexOf("if p_internal_status = 'approved' then");
    const planWriteIndex = body.indexOf("insert into public.store_plans");
    expect(approvedIndex).toBeGreaterThan(-1);
    expect(planWriteIndex).toBeGreaterThan(approvedIndex);
  });

  it("é a ÚNICA escrita em store_plans da migration inteira — nenhum outro caminho muda plano", () => {
    const writes = sql.match(/(insert|update)\s+(into\s+)?public\.store_plans/g) ?? [];
    expect(writes.length).toBe(1);
  });

  it("usa o plan_code da COBRANÇA (já validado e precificado na criação), nunca um parâmetro solto", () => {
    const body = fn();
    expect(body).toContain("values (v_charge.store_id, v_charge.plan_code, now())");
    expect(body).toContain("on conflict (store_id) do update set plan_code = excluded.plan_code");
  });

  it("só grava quando o plano REALMENTE mudou, e audita a troca", () => {
    const body = fn();
    expect(body).toContain("if v_previous_plan_code is distinct from v_charge.plan_code then");
    expect(body).toContain("'plan_changed_by_billing'");
  });

  it("a troca vem ANTES dos três ramos de status (que retornam cedo) — vale para ativação, reativação e renovação", () => {
    const body = fn();
    const approvedBranch = body.slice(body.indexOf("if p_internal_status = 'approved' then"));
    const planWrite = approvedBranch.indexOf("insert into public.store_plans");
    const firstActivation = approvedBranch.indexOf("where id = v_charge.store_id and status = 'pending_payment'");
    const reactivation = approvedBranch.indexOf("and status = 'suspended' and suspension_reason = 'billing_overdue'");
    const renewalLog = approvedBranch.indexOf("'billing_subscription_renewed'");
    expect(planWrite).toBeGreaterThan(-1);
    expect(planWrite).toBeLessThan(firstActivation);
    expect(planWrite).toBeLessThan(reactivation);
    expect(planWrite).toBeLessThan(renewalLog);
  });

  it("preserva tudo da TASK-010: lock da loja (QA-010-001), reativação por billing_overdue e os ramos de conflito", () => {
    const body = fn();
    for (const marker of [
      "perform 1 from public.stores where id = v_charge.store_id for update;",
      "update public.stores set status = 'active', pre_suspension_status = null, suspension_reason = null",
      "'store_reactivated_by_billing'",
      "if v_charge.status = 'manual_review' then",
      "integrity_mismatch_after_approval",
      "terminal_state_conflict_after_approval",
    ]) {
      expect(body, `marcador ausente: ${marker}`).toContain(marker);
    }
  });
});

describe("billing_get_subscription — leitura sanitizada, gated por is_store_member", () => {
  const fn = () => fnBody("billing_get_subscription");

  it("checa is_store_member antes de qualquer leitura", () => {
    const body = fn();
    const checkIndex = body.indexOf("if not public.is_store_member(p_store_id) then");
    const queryIndex = body.indexOf("return query");
    expect(checkIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeLessThan(queryIndex);
    expect(body).toContain("insufficient_privilege");
  });

  it("nunca devolve dado sensível de pagamento", () => {
    const body = fn();
    for (const forbidden of ["provider_payment_id", "provider_idempotency_key", "payer_email", "payer_doc"]) {
      expect(body, `billing_get_subscription não deveria expor ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("período vigente = cobrança approved de maior period_end (mesma regra de upsert_creating e do cron de atraso)", () => {
    const body = fn();
    expect(body).toContain("where bc.store_id = p_store_id and bc.status = 'approved'");
    expect(body).toContain("order by bc.period_end desc");
  });

  it("assinante desde = PRIMEIRA cobrança aprovada, por approved_at (não created_at: Pix gerado e não pago não inicia assinatura)", () => {
    const body = fn();
    expect(body).toContain("order by bc.approved_at asc");
  });

  it("concedida a authenticated, nunca a anon", () => {
    const grantLine = sql.split(";").find((s) => s.includes("grant execute on function public.billing_get_subscription("));
    expect(grantLine).toBeTruthy();
    expect(grantLine).toContain("authenticated");
    expect(grantLine).not.toMatch(/\banon\b/);
    expect(sql).toContain("revoke all on function public.billing_get_subscription(uuid) from public");
  });
});

describe("audit_log_action_check — só ALARGA", () => {
  it("inclui plan_changed_by_billing sem remover nenhum valor anterior", () => {
    const constraintBlock = sql.slice(
      sql.indexOf("add constraint audit_log_action_check check (action in ("),
      sql.lastIndexOf("));"),
    );
    for (const action of [
      "plan_changed_by_billing",
      // Amostra herdada das migrations anteriores — prova que o conjunto cresceu.
      "store_suspended_by_billing_overdue",
      "store_reactivated_by_billing",
      "store_suspended_by_platform_admin",
      "billing_charge_approved",
      "order_created",
    ]) {
      expect(constraintBlock, `audit_log_action_check não inclui ${action}`).toContain(`'${action}'`);
    }
  });
});
