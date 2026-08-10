import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0008_saas_billing.sql (TASK-007 — billing da
 * própria CaraffaStore + ativação automática). Mesmo padrão das
 * migrations anteriores (ver 0007_payments.privileges.test.ts): normaliza
 * CRLF/comentários e faz asserções sobre o texto bruto do SQL versionado
 * — não requer Postgres/Docker rodando.
 */

const migrationPath = path.resolve(import.meta.dirname, "0008_saas_billing.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("platform_plan_price_cents — única fonte de verdade de preço no banco", () => {
  it("immutable, search_path vazio, mapeia 30->3000, 50->5000, 80->7000", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.platform_plan_price_cents"),
      sql.indexOf("comment on function public.platform_plan_price_cents"),
    );
    expect(fn).toContain("immutable");
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain("when 30 then 3000");
    expect(fn).toContain("when 50 then 5000");
    expect(fn).toContain("when 80 then 7000");
    expect(fn).toContain("else null");
  });

  it("concedida a authenticated e service_role, nunca a anon/public direto", () => {
    const grantLine = sql.split(";").find((s) => s.includes("grant execute on function public.platform_plan_price_cents("));
    expect(grantLine).toBeTruthy();
    expect(grantLine).toContain("authenticated");
    expect(grantLine).toContain("service_role");
    expect(grantLine).not.toMatch(/\banon\b/);
    expect(sql).toContain("revoke all on function public.platform_plan_price_cents(integer) from public");
  });
});

describe("billing_charges — leitura por qualquer membro, escrita só via RPC", () => {
  it("plan_code restrito a 30/50/80 e amount_cents sempre positivo (nunca aceita valor negativo/zero)", () => {
    expect(sql).toContain("plan_code integer not null check (plan_code in (30, 50, 80))");
    expect(sql).toContain("amount_cents integer not null check (amount_cents > 0)");
  });

  it("índice único parcial garante no máximo UMA cobrança creating/pending por loja (defesa de concorrência real, não só em memória)", () => {
    expect(sql).toContain("create unique index billing_charges_one_active_per_store");
    expect(sql).toContain("on public.billing_charges (store_id)");
    expect(sql).toContain("where status in ('creating', 'pending')");
  });

  it("provider_idempotency_key único por loja e provider_payment_id único globalmente (nunca reusado entre cobranças)", () => {
    expect(sql).toContain("constraint billing_charges_store_idempotency_unique unique (store_id, provider_idempotency_key)");
    expect(sql).toContain("constraint billing_charges_provider_payment_id_unique unique (provider, provider_payment_id)");
  });

  it("payer_doc_last4 nunca guarda mais que 4 dígitos (mesma regra de order_payments)", () => {
    expect(sql).toContain("payer_doc_last4 text not null check (payer_doc_last4 ~ '^[0-9]{4}$')");
  });

  it("RLS habilitada, única policy é SELECT via is_store_member (qualquer membro, não só owner/admin)", () => {
    expect(sql).toContain("alter table public.billing_charges enable row level security");
    expect(sql).toMatch(/create policy billing_charges_select_member[\s\S]*?using \(public\.is_store_member\(store_id\)\)/);

    const policyNames = [...sql.matchAll(/create policy (\w+)\s+on public\.billing_charges/g)].map((m) => m[1]);
    expect(policyNames).toEqual(["billing_charges_select_member"]);
  });

  it("revoga tudo antes de conceder; authenticated só recebe SELECT; service_role recebe DML completo; nunca anon", () => {
    expect(sql).toContain("revoke all on public.billing_charges from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select on public.billing_charges to authenticated");
    expect(sql).toContain("grant select, insert, update, delete on public.billing_charges to service_role");

    const grantLines = sql.split(";").filter((s) => /^\s*grant\s/.test(s.trimStart()) && /\bon\s+public\.billing_charges\b/.test(s));
    for (const line of grantLines) {
      expect(line).not.toMatch(/\banon\b/);
      if (/\bto\b[^;]*\bauthenticated\b/.test(line)) {
        expect(line).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/);
      }
    }
  });
});

describe("billing_webhook_events — append-only, sem policy pública", () => {
  it("RLS habilitada, sem nenhuma policy, sem GRANT a anon/authenticated", () => {
    expect(sql).toContain("alter table public.billing_webhook_events enable row level security");
    expect(sql).not.toMatch(/create policy \w+\s+on public\.billing_webhook_events/);
    expect(sql).toContain("revoke all on public.billing_webhook_events from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert, update, delete on public.billing_webhook_events to service_role");
  });

  it("UNIQUE (store_id, provider_payment_id, payload_hash) deduplica entregas repetidas — mesmo desenho de payment_webhook_events", () => {
    expect(sql).toContain("constraint billing_webhook_events_dedup_unique unique (store_id, provider_payment_id, payload_hash)");
  });
});

describe("billing_charge_upsert_creating — nunca aceita plan_code/amount_cents do cliente", () => {
  const fnBody = () =>
    sql.slice(
      sql.indexOf("create or replace function public.billing_charge_upsert_creating"),
      sql.indexOf("comment on function public.billing_charge_upsert_creating"),
    );

  it("assinatura da função não tem parâmetro p_plan_code nem p_amount_cents", () => {
    const signature = sql.slice(
      sql.indexOf("create or replace function public.billing_charge_upsert_creating"),
      sql.indexOf("returns public.billing_charges", sql.indexOf("create or replace function public.billing_charge_upsert_creating")),
    );
    expect(signature).not.toMatch(/p_plan_code/);
    expect(signature).not.toMatch(/p_amount_cents/);
  });

  it("deriva plan_code de store_plans e amount_cents de platform_plan_price_cents — nunca de parâmetro", () => {
    const fn = fnBody();
    expect(fn).toContain("select plan_code into v_plan_code from public.store_plans where store_id = p_store_id");
    expect(fn).toContain("v_amount_cents := public.platform_plan_price_cents(v_plan_code)");
  });

  it("recusa loja fora de pending_payment/active (store_not_billable) e plano ausente (plan_not_selected)", () => {
    const fn = fnBody();
    expect(fn).toContain("if v_store.status not in ('pending_payment', 'active') then");
    expect(fn).toContain("store_not_billable");
    expect(fn).toContain("plan_not_selected");
    expect(fn).toContain("invalid_plan_code");
  });

  it("trava a linha da loja (FOR UPDATE) antes de decidir — serializa criação concorrente", () => {
    const fn = fnBody();
    expect(fn).toContain("select * into v_store from public.stores where id = p_store_id for update");
  });

  it("reaproveita cobrança creating/pending não expirada em vez de criar outra (refresh/duplo clique/duas abas)", () => {
    const fn = fnBody();
    expect(fn).toContain("where store_id = p_store_id and status in ('creating', 'pending')");
    expect(fn).toContain("return v_existing");
  });

  it("trata unique_violation da corrida real devolvendo a cobrança vencedora, nunca erra pro cliente", () => {
    const fn = fnBody();
    expect(fn).toContain("exception");
    expect(fn).toContain("when unique_violation then");
  });

  it("renovação: period_start continua de period_end da última cobrança approved se ainda não venceu; senão começa agora", () => {
    const fn = fnBody();
    expect(fn).toContain("where store_id = p_store_id and status = 'approved'");
    expect(fn).toContain("if v_last_period_end is not null and v_last_period_end > now() then");
    expect(fn).toContain("v_period_start := v_last_period_end");
  });
});

describe("billing_charge_apply_provider_state — único caminho de decisão, idempotente", () => {
  const fnBody = () =>
    sql.slice(
      sql.indexOf("create or replace function public.billing_charge_apply_provider_state"),
      sql.indexOf("comment on function public.billing_charge_apply_provider_state"),
    );

  it("diverência de external_reference/amount/currency vira manual_review, nunca decide sozinho", () => {
    const fn = fnBody();
    expect(fn).toContain("v_charge.external_reference <> p_external_reference");
    expect(fn).toContain("v_charge.amount_cents <> p_amount_cents");
    expect(fn).toContain("v_charge.currency <> p_currency");
    expect(fn).toContain("status = 'manual_review'");
  });

  it("conflito de estado terminal (já approved recebendo não-approved, ou já rejeitado recebendo approved) vira manual_review", () => {
    const fn = fnBody();
    expect(fn).toContain("v_terminal_paid and p_internal_status <> 'approved'");
    expect(fn).toContain("v_terminal_unpaid and p_internal_status = 'approved'");
  });

  it("manual_review nunca é reavaliado automaticamente depois (early return)", () => {
    const fn = fnBody();
    expect(fn).toMatch(/if v_charge\.status = 'manual_review' then\s+return v_charge;/);
  });

  it("aprovação ativa a loja atomicamente (pending_payment->active) só uma vez, via WHERE status='pending_payment'", () => {
    const fn = fnBody();
    expect(fn).toContain("update public.stores set status = 'active'");
    expect(fn).toContain("where id = v_charge.store_id and status = 'pending_payment'");
    expect(fn).toContain("store_activated_by_billing");
    expect(fn).toContain("billing_subscription_renewed");
  });

  it("REGRESSÃO (bug encontrado no QA dinâmico): UPDATE em public.stores nunca referencia updated_at — a tabela não tem essa coluna (ver 0001_init.sql), e referenciá-la faz o RPC inteiro falhar em silêncio (reconcile.ts trata erro de RPC como apply_failed, e o webhook ainda responde 200 — a loja nunca é ativada de verdade)", () => {
    const approvedBranch = sql.slice(
      sql.indexOf("if p_internal_status = 'approved' then"),
      sql.indexOf("return v_charge;\n  end if;\n\n  -- rejected"),
    );
    const storesUpdateStatements = approvedBranch.match(/update public\.stores set[^;]*;/g) ?? [];
    expect(storesUpdateStatements.length).toBeGreaterThan(0);
    for (const statement of storesUpdateStatements) {
      expect(statement).not.toContain("updated_at");
    }
  });

  it("trava a linha da cobrança (FOR UPDATE) antes de decidir — webhook duplicado/reconciliação concorrente serializam aqui", () => {
    const fn = fnBody();
    expect(fn).toContain("select * into v_charge from public.billing_charges where id = p_charge_id for update");
  });

  it("provider_payment_id divergente do já registrado é rejeitado (nunca troca o pagamento vinculado)", () => {
    const fn = fnBody();
    expect(fn).toContain("v_charge.provider_payment_id is not null and v_charge.provider_payment_id <> p_provider_payment_id");
    expect(fn).toContain("provider_payment_id_mismatch");
  });
});

describe("billing_charge_* / billing_webhook_event_record — exclusivos de service_role", () => {
  const orchestrationFns = [
    "billing_charge_upsert_creating",
    "billing_charge_mark_created",
    "billing_charge_mark_creation_failed",
    "billing_charge_apply_provider_state",
    "billing_webhook_event_record",
  ];

  it("todas revogadas de public e concedidas SÓ a service_role (nunca anon/authenticated)", () => {
    for (const fn of orchestrationFns) {
      const revokeLine = sql.split(";").find((s) => s.includes(`revoke all on function public.${fn}(`));
      const grantLine = sql.split(";").find((s) => s.includes(`grant execute on function public.${fn}(`));
      expect(revokeLine, `revoke ausente para ${fn}`).toBeTruthy();
      expect(grantLine, `grant ausente para ${fn}`).toBeTruthy();
      expect(grantLine).toContain("service_role");
      expect(grantLine).not.toMatch(/\banon\b/);
      expect(grantLine).not.toMatch(/\bauthenticated\b/);
    }
  });
});

describe("billing_get_current_charge — leitura sanitizada, authenticated reautorizado no banco", () => {
  it("concedida a authenticated (nunca anon/service_role), checa is_store_member internamente", () => {
    const grantLine = sql.split(";").find((s) => s.includes("grant execute on function public.billing_get_current_charge("));
    expect(grantLine).toBeTruthy();
    expect(grantLine).toContain("authenticated");
    expect(grantLine).not.toMatch(/\banon\b/);
    expect(grantLine).not.toMatch(/\bservice_role\b/);

    const fn = sql.slice(
      sql.indexOf("create or replace function public.billing_get_current_charge"),
      sql.indexOf("comment on function public.billing_get_current_charge"),
    );
    expect(fn).toContain("if not public.is_store_member(p_store_id) then");
    expect(fn).toContain("insufficient_privilege");
  });

  it("nunca devolve provider_payment_id/provider_idempotency_key/payer_email/payer_doc_* (retorno sanitizado)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.billing_get_current_charge"),
      sql.indexOf("comment on function public.billing_get_current_charge"),
    );
    expect(fn).not.toContain("provider_payment_id");
    expect(fn).not.toContain("provider_idempotency_key");
    expect(fn).not.toContain("payer_email");
    expect(fn).not.toContain("payer_doc");
  });
});

describe("audit_log_action_check — só ALARGA", () => {
  it("inclui os 9 novos eventos de billing sem remover nenhum valor anterior", () => {
    const constraintBlock = sql.slice(
      sql.indexOf("add constraint audit_log_action_check check (action in ("),
      sql.indexOf("comment on constraint audit_log_action_check"),
    );
    for (const action of [
      "billing_charge_creation_started",
      "billing_charge_created",
      "billing_charge_approved",
      "billing_charge_rejected",
      "billing_charge_cancelled",
      "billing_charge_expired",
      "billing_manual_review_required",
      "store_activated_by_billing",
      "billing_subscription_renewed",
      // Amostra de valores herdados de migrations anteriores — prova que
      // o conjunto cresceu em vez de ser substituído.
      "pix_payment_approved",
      "payment_manual_review_required",
      "order_created",
    ]) {
      expect(constraintBlock, `audit_log_action_check não inclui ${action}`).toContain(`'${action}'`);
    }
  });
});
