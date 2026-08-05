import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0007_payments.sql (TASK-005 — Pix e pagamentos).
 * Mesmo padrão das migrations anteriores: normaliza CRLF/comentários e
 * faz asserções sobre o texto bruto do SQL versionado.
 */

const migrationPath = path.resolve(import.meta.dirname, "0007_payments.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("can_manage_store_payments", () => {
  it("exige owner/admin E loja active, SECURITY DEFINER, EXECUTE só authenticated", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.can_manage_store_payments"),
      sql.indexOf("comment on function public.can_manage_store_payments"),
    );
    expect(fn).toContain("sm.role in ('owner', 'admin')");
    expect(fn).toContain("s.status = 'active'");
    expect(sql).toContain("revoke all on function public.can_manage_store_payments(uuid) from public");
    expect(sql).toContain("grant execute on function public.can_manage_store_payments(uuid) to authenticated");
  });
});

describe("store_payment_settings — credenciais, zero policy pública", () => {
  it("RLS habilitada e SEM nenhuma policy (só RPC/service_role)", () => {
    expect(sql).toContain("alter table public.store_payment_settings enable row level security");
    expect(sql).not.toMatch(/create policy \w+\s+on public\.store_payment_settings/);
  });

  it("revoga tudo de public/anon/authenticated/service_role, concede só a service_role", () => {
    expect(sql).toContain("revoke all on public.store_payment_settings from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert, update, delete on public.store_payment_settings to service_role");
    const grantLines = sql.split(";").filter((s) => /^\s*grant\s/.test(s.trimStart()) && /\bon\s+public\.store_payment_settings\b/.test(s));
    for (const line of grantLines) {
      expect(line).not.toMatch(/\banon\b/);
      expect(line).not.toMatch(/\bto\b[^;]*\bauthenticated\b/);
    }
  });

  it("encrypted_access_token/encrypted_webhook_secret nunca aparecem em nenhum retorno de função authenticated (payment_settings_get)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.payment_settings_get"),
      sql.indexOf("comment on function public.payment_settings_get"),
    );
    expect(fn).not.toContain("encrypted_access_token");
    expect(fn).not.toContain("encrypted_webhook_secret");
  });
});

describe("order_payments — leitura restrita a owner/admin, sem escrita direta", () => {
  it("RLS habilitada, única policy de SELECT usa can_manage_store_payments (não can_manage_store_orders/can_view_store_orders — staff não vê pagamento)", () => {
    expect(sql).toContain("alter table public.order_payments enable row level security");
    expect(sql).toMatch(/create policy order_payments_select_manager[\s\S]*?using \(public\.can_manage_store_payments\(store_id\)\)/);
  });

  it("revoga tudo antes de conceder; authenticated só recebe SELECT; service_role recebe DML completo", () => {
    expect(sql).toContain("revoke all on public.order_payments from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select on public.order_payments to authenticated");
    expect(sql).toContain("grant select, insert, update, delete on public.order_payments to service_role");
  });

  it("nenhuma linha de GRANT em order_payments menciona anon", () => {
    const grantLines = sql.split(";").filter((s) => /^\s*grant\s/.test(s.trimStart()) && /\bon\s+public\.order_payments\b/.test(s));
    for (const line of grantLines) {
      expect(line).not.toMatch(/\banon\b/);
    }
  });

  it("nenhum GRANT de INSERT/UPDATE/DELETE a authenticated em order_payments", () => {
    const grantLines = sql.split(";").filter((s) => /^\s*grant\s/.test(s.trimStart()) && /\bon\s+public\.order_payments\b/.test(s));
    for (const line of grantLines) {
      if (/\bto\b[^;]*\bauthenticated\b/.test(line)) {
        expect(line).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/);
      }
    }
  });

  it("provider_idempotency_key limitada a 64 caracteres (X-Idempotency-Key)", () => {
    expect(sql).toContain("check (char_length(provider_idempotency_key) between 1 and 64)");
  });

  it("payer_doc_last4 nunca guarda mais que 4 dígitos (CPF/CNPJ completo nunca persistido)", () => {
    expect(sql).toContain("check (payer_doc_last4 ~ '^[0-9]{4}$')");
  });
});

describe("payment_webhook_events — append-only, sem policy pública", () => {
  it("RLS habilitada, sem nenhuma policy, sem GRANT a anon/authenticated", () => {
    expect(sql).toContain("alter table public.payment_webhook_events enable row level security");
    expect(sql).not.toMatch(/create policy \w+\s+on public\.payment_webhook_events/);
    expect(sql).toContain("revoke all on public.payment_webhook_events from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert, update, delete on public.payment_webhook_events to service_role");
  });

  it("UNIQUE (store_id, provider_payment_id, payload_hash) deduplica entregas repetidas", () => {
    expect(sql).toContain("constraint payment_webhook_events_dedup_unique unique (store_id, provider_payment_id, payload_hash)");
  });
});

describe("pix_payment_* — orquestração exclusiva de service_role", () => {
  const orchestrationFns = [
    "pix_payment_attempt_upsert_creating",
    "pix_payment_mark_created",
    "pix_payment_mark_creation_failed",
    "pix_payment_apply_provider_state",
    "pix_webhook_event_record",
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

  it("pix_payment_apply_provider_state nunca confirma pedido em terminal_paid x incoming≠approved sem manual_review", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.pix_payment_apply_provider_state"),
      sql.indexOf("comment on function public.pix_payment_apply_provider_state"),
    );
    expect(fn).toContain("manual_review");
    expect(fn).toContain("v_terminal_paid and p_internal_status <> 'approved'");
    expect(fn).toContain("v_terminal_unpaid and p_internal_status = 'approved'");
  });

  it("pix_payment_apply_provider_state nunca baixa estoque na aprovação (só cria audit + confirma pedido)", () => {
    const approvedBranch = sql.slice(
      sql.indexOf("if p_internal_status = 'approved' then"),
      sql.indexOf("update public.order_payments\n  set status = p_internal_status,"),
    );
    expect(approvedBranch).not.toMatch(/update public\.products/);
  });

  it("pix_payment_attempt_upsert_creating é idempotente por order_id (UNIQUE já garante, mas a função também checa antes de inserir)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.pix_payment_attempt_upsert_creating"),
      sql.indexOf("comment on function public.pix_payment_attempt_upsert_creating"),
    );
    expect(fn).toContain("select * into v_existing from public.order_payments where order_id = p_order_id");
    expect(fn).toContain("return v_existing");
  });
});

describe("payment_settings_* / payment_events_list_sanitized — authenticated, reautorizado no banco", () => {
  const authenticatedFns = ["payment_settings_get", "payment_settings_upsert", "payment_settings_set_enabled", "payment_settings_mark_verified", "payment_events_list_sanitized"];

  it("todas concedidas a authenticated (nunca anon), todas checam can_manage_store_payments", () => {
    for (const fn of authenticatedFns) {
      const grantLine = sql.split(";").find((s) => s.includes(`grant execute on function public.${fn}(`));
      expect(grantLine, `grant ausente para ${fn}`).toBeTruthy();
      expect(grantLine).toContain("authenticated");
      expect(grantLine).not.toMatch(/\banon\b/);

      const body = sql.slice(
        sql.indexOf(`create or replace function public.${fn}`),
        sql.indexOf(`create or replace function public.${fn}`) + 3000,
      );
      expect(body, `${fn} não chama can_manage_store_payments`).toContain("can_manage_store_payments");
    }
  });
});

describe("orders — colunas novas (ALTER TABLE, nunca recriada)", () => {
  it("payment_mode default 'manual', receipt_token_hash nullable — pedidos legados preservados sem migração de dado", () => {
    expect(sql).toContain("add column payment_mode text not null default 'manual' check (payment_mode in ('manual', 'pix'))");
    expect(sql).toContain("add column receipt_token_hash text");
  });
});

describe("order_advance_status/order_cancel — guards de integração Pix (CREATE OR REPLACE, TASK-004 preservada)", () => {
  it("order_advance_status recusa pending->confirmed para payment_mode=pix (só a engine de pagamento confirma)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.order_advance_status"),
      sql.indexOf("comment on function public.order_advance_status"),
    );
    expect(fn).toContain("p_new_status = 'confirmed' and v_order.payment_mode <> 'pix'");
    expect(fn).toContain("payment_not_approved");
  });

  it("order_cancel recusa qualquer pedido payment_mode=pix (pix_order_requires_payment_flow)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.order_cancel"),
      sql.indexOf("comment on function public.order_cancel"),
    );
    expect(fn).toContain("if v_order.payment_mode = 'pix' then");
    expect(fn).toContain("pix_order_requires_payment_flow");
  });

  it("ambas continuam concedidas a authenticated (assinatura/grants preservados)", () => {
    for (const fn of ["order_advance_status", "order_cancel"]) {
      const grantLine = sql.split(";").find((s) => s.includes(`grant execute on function public.${fn}(`));
      expect(grantLine).toContain("authenticated");
    }
  });
});

describe("audit_log_action_check — só ALARGA", () => {
  it("inclui os 12 novos eventos de pagamento sem remover nenhum valor anterior de pedidos/catálogo/auth", () => {
    const constraintBlock = sql.slice(
      sql.indexOf("add constraint audit_log_action_check check (action in ("),
      sql.indexOf("comment on constraint audit_log_action_check"),
    );
    for (const action of [
      "payment_settings_configured",
      "payment_settings_disabled",
      "pix_payment_creation_started",
      "pix_payment_created",
      "pix_payment_approved",
      "pix_payment_rejected",
      "pix_payment_cancelled",
      "pix_payment_expired",
      "pix_payment_reconciliation_failed",
      "order_confirmed_by_payment",
      "order_cancelled_by_payment_failure",
      "payment_manual_review_required",
      "order_created",
      "order_cancelled",
      "product_stock_adjusted",
      "signup_completed",
    ]) {
      expect(constraintBlock, `audit_log_action_check não inclui ${action}`).toContain(`'${action}'`);
    }
  });
});
