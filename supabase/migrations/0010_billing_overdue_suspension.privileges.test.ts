import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0010_billing_overdue_suspension.sql (suspensão
 * automática por atraso de mensalidade + reativação ao pagar de novo).
 * Mesmo padrão de 0008/0009: normaliza CRLF/comentários e faz asserções
 * sobre o texto bruto do SQL versionado — não requer Postgres/Docker
 * rodando.
 */

const migrationPath = path.resolve(import.meta.dirname, "0010_billing_overdue_suspension.sql");
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

describe("stores.suspension_reason — coluna nova, restrita a platform_admin/billing_overdue", () => {
  it("check constraint fechada", () => {
    expect(sql).toContain(
      "add column if not exists suspension_reason text\n    check (suspension_reason in ('platform_admin', 'billing_overdue'))",
    );
  });
});

describe("billing_suspend_overdue_stores — cron diário, service_role apenas", () => {
  const fn = () => fnBody("billing_suspend_overdue_stores");

  it("só suspende loja active cuja última cobrança approved venceu há mais de 7 dias", () => {
    const body = fn();
    expect(body).toContain("where store_id = v_store.id and status = 'approved'");
    expect(body).toContain("order by period_end desc");
    expect(body).toContain("if v_period_end is null or v_period_end >= now() - interval '7 days' then");
  });

  it("QA-010-001: trava cada loja candidata (for update) ANTES de decidir, nunca decide com dado pré-lock", () => {
    const body = fn();
    const lockIndex = body.indexOf("select * into v_store from public.stores where id = v_candidate.id for update;");
    const rereadIndex = body.indexOf("select period_end into v_period_end");
    const decideIndex = body.indexOf("if v_period_end is null or v_period_end >= now() - interval '7 days' then");
    const suspendIndex = body.indexOf("set status = 'suspended', pre_suspension_status = 'active', suspension_reason = 'billing_overdue'");
    expect(lockIndex).toBeGreaterThan(-1);
    expect(rereadIndex).toBeGreaterThan(lockIndex);
    expect(decideIndex).toBeGreaterThan(rereadIndex);
    expect(suspendIndex).toBeGreaterThan(decideIndex);
  });

  it("QA-010-001: releitura de billing_charges acontece DEPOIS do lock — nunca reaproveita period_end calculado antes de travar a loja", () => {
    const body = fn();
    // A listagem inicial de candidatas só lê `stores` (status=active), nunca
    // billing_charges — o period_end só é lido uma vez, depois do lock.
    const listing = body.slice(body.indexOf("for v_candidate in"), body.indexOf("loop"));
    expect(listing).not.toContain("billing_charges");
  });

  it("loja que muda de status entre a listagem e o lock é pulada (continue), nunca suspensa com dado obsoleto", () => {
    const body = fn();
    expect(body).toContain("if v_store.status <> 'active' then");
    expect(body).toContain("continue;");
  });

  it("grava audit_log store_suspended_by_billing_overdue com actor_user_id null (evento de sistema, não de usuário)", () => {
    const body = fn();
    expect(body).toContain("'store_suspended_by_billing_overdue'");
    expect(body).toMatch(/insert into public\.audit_log \(actor_user_id[^)]*\)\s*\n\s*values \(null, v_store\.id, 'store_suspended_by_billing_overdue'/);
  });

  it("concedida só a service_role, nunca a anon/authenticated/public", () => {
    const grantLine = sql.split(";").find((s) => s.includes("grant execute on function public.billing_suspend_overdue_stores("));
    expect(grantLine).toBeTruthy();
    expect(grantLine).toContain("service_role");
    expect(grantLine).not.toMatch(/\banon\b/);
    expect(grantLine).not.toMatch(/\bauthenticated\b/);
    expect(sql).toContain("revoke all on function public.billing_suspend_overdue_stores() from public");
  });
});

describe("billing_charge_upsert_creating — reabre billable para suspended(billing_overdue), nunca para platform_admin", () => {
  const fn = () => fnBody("billing_charge_upsert_creating");

  it("guarda de store_not_billable aceita suspended só quando suspension_reason=billing_overdue", () => {
    const body = fn();
    expect(body).toContain("if v_store.status not in ('pending_payment', 'active')");
    expect(body).toContain("and not (v_store.status = 'suspended' and v_store.suspension_reason = 'billing_overdue') then");
    expect(body).toContain("raise exception 'store_not_billable'");
  });
});

describe("billing_charge_apply_provider_state — approved ganha o ramo de reativação, preservando os dois ramos anteriores", () => {
  const fn = () => fnBody("billing_charge_apply_provider_state");

  it("ordem dos 3 ramos dentro do approved: pending_payment->active primeiro, depois suspended(billing_overdue)->active, depois renovação simples", () => {
    const body = fn();
    const approvedBranch = body.slice(body.indexOf("if p_internal_status = 'approved' then"));
    const firstActivation = approvedBranch.indexOf("where id = v_charge.store_id and status = 'pending_payment'");
    const reactivation = approvedBranch.indexOf("and status = 'suspended' and suspension_reason = 'billing_overdue'");
    const renewalLog = approvedBranch.indexOf("'billing_subscription_renewed'");
    expect(firstActivation).toBeGreaterThan(-1);
    expect(reactivation).toBeGreaterThan(-1);
    expect(renewalLog).toBeGreaterThan(-1);
    expect(firstActivation).toBeLessThan(reactivation);
    expect(reactivation).toBeLessThan(renewalLog);
  });

  it("QA-010-001: trava a linha da loja (for update) ANTES de qualquer UPDATE em stores/billing_charges dentro do ramo approved — sem isso a renovação simples nunca disputa a mesma trava do cron", () => {
    const body = fn();
    const approvedBranch = body.slice(body.indexOf("if p_internal_status = 'approved' then"));
    const lockIndex = approvedBranch.indexOf("perform 1 from public.stores where id = v_charge.store_id for update;");
    const chargeUpdateIndex = approvedBranch.indexOf("set status = 'approved', approved_at = now()");
    const firstActivation = approvedBranch.indexOf("where id = v_charge.store_id and status = 'pending_payment'");
    expect(lockIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(chargeUpdateIndex);
    expect(lockIndex).toBeLessThan(firstActivation);
  });

  it("reativação restaura status=active e ZERA pre_suspension_status/suspension_reason — nunca deixa suspension_reason órfão numa loja active", () => {
    const body = fn();
    expect(body).toContain(
      "update public.stores set status = 'active', pre_suspension_status = null, suspension_reason = null\n      where id = v_charge.store_id and status = 'suspended' and suspension_reason = 'billing_overdue';",
    );
  });

  it("reativação nunca casa loja suspended por platform_admin (condição exige suspension_reason='billing_overdue' explicitamente)", () => {
    const body = fn();
    const reactivateUpdate = body.slice(
      body.indexOf("update public.stores set status = 'active', pre_suspension_status = null"),
    );
    expect(reactivateUpdate.slice(0, 400)).not.toContain("platform_admin");
    expect(reactivateUpdate).toContain("suspension_reason = 'billing_overdue'");
  });

  it("grava audit_log store_reactivated_by_billing só no ramo de reativação", () => {
    const body = fn();
    expect(body).toContain("'store_reactivated_by_billing'");
  });

  it("os ramos anteriores (manual_review, conflito terminal, mismatch de integridade, pending) continuam intactos", () => {
    const body = fn();
    for (const marker of [
      "if v_charge.status = 'manual_review' then",
      "integrity_mismatch_after_approval",
      "terminal_state_conflict_after_approval",
      "terminal_state_conflict",
      "if p_internal_status = 'pending' then",
    ]) {
      expect(body, `marcador ausente: ${marker}`).toContain(marker);
    }
  });
});

describe("platform_admin_set_store_status — passa a gravar/limpar suspension_reason, comportamento anterior preservado", () => {
  const fn = () => fnBody("platform_admin_set_store_status");

  it("suspend grava suspension_reason='platform_admin' junto de pre_suspension_status", () => {
    const body = fn();
    const suspendBranch = body.slice(body.indexOf("if p_action = 'suspend' then"), body.indexOf("else"));
    expect(suspendBranch).toContain("pre_suspension_status = v_store.status, suspension_reason = 'platform_admin'");
  });

  it("reactivate zera suspension_reason junto de pre_suspension_status, continua restaurando o status anterior via coalesce", () => {
    const body = fn();
    const reactivateBranch = body.slice(body.indexOf("else"), body.lastIndexOf("return v_store"));
    expect(reactivateBranch).toContain("coalesce(v_store.pre_suspension_status, 'active'), pre_suspension_status = null, suspension_reason = null");
    expect(reactivateBranch).not.toMatch(/status\s*=\s*'active'(?!\s*,\s*pre_suspension_status)/);
  });

  it("idempotência de suspender uma loja já suspensa continua intacta (nunca sobrescreve suspension_reason original)", () => {
    const body = fn();
    expect(body).toContain("if v_store.status = 'suspended' then\n      return v_store;");
  });
});

describe("platform_admin_store_overview — passa a devolver suspension_reason, resto idêntico", () => {
  const fn = () => fnBody("platform_admin_store_overview");

  it("suspension_reason na assinatura de retorno e no SELECT", () => {
    const body = fn();
    expect(body).toContain("suspension_reason text,");
    expect(body).toContain("s.id, s.slug, s.name, s.status, s.pre_suspension_status, s.suspension_reason, s.whatsapp");
  });

  it("continua checando is_platform_admin() antes de tudo, e nunca devolve dado sensível de pagamento", () => {
    const body = fn();
    const checkIndex = body.indexOf("if not public.is_platform_admin() then");
    const queryIndex = body.indexOf("return query");
    expect(checkIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeLessThan(queryIndex);
    expect(body).not.toContain("provider_payment_id");
    expect(body).not.toContain("payer_doc");
  });
});

describe("audit_log_action_check — só ALARGA", () => {
  it("inclui os 2 novos eventos de suspensão/reativação por atraso, sem remover nenhum valor anterior (inclusive os de platform_admin da 0009)", () => {
    const constraintBlock = sql.slice(
      sql.indexOf("add constraint audit_log_action_check check (action in ("),
      sql.lastIndexOf("));"),
    );
    for (const action of [
      "store_suspended_by_billing_overdue",
      "store_reactivated_by_billing",
      // Amostra de valores herdados das migrations anteriores.
      "store_suspended_by_platform_admin",
      "store_reactivated_by_platform_admin",
      "billing_charge_approved",
      "store_activated_by_billing",
      "billing_subscription_renewed",
      "order_created",
    ]) {
      expect(constraintBlock, `audit_log_action_check não inclui ${action}`).toContain(`'${action}'`);
    }
  });
});
