import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de regressão por análise estática para
 * supabase/migrations/0006_orders.sql (TASK-004 — carrinho, checkout
 * sem pagamento, gestão de pedidos). Mesmo padrão das migrations
 * anteriores: normaliza CRLF/comentários e faz asserções sobre o texto
 * bruto do SQL versionado.
 */

const migrationPath = path.resolve(import.meta.dirname, "0006_orders.sql");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n").toLowerCase();
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("can_view_store_orders / can_manage_store_orders — autorização operacional", () => {
  it("can_view_store_orders exige membership E loja active (sem exigir owner/admin)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.can_view_store_orders"),
      sql.indexOf("comment on function public.can_view_store_orders"),
    );
    expect(fn).toContain("sm.user_id = auth.uid()");
    expect(fn).toContain("s.status = 'active'");
    expect(fn).not.toMatch(/role in \('owner', 'admin'\)/);
  });

  it("can_manage_store_orders exige owner/admin E loja active", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.can_manage_store_orders"),
      sql.indexOf("comment on function public.can_manage_store_orders"),
    );
    expect(fn).toContain("sm.role in ('owner', 'admin')");
    expect(fn).toContain("s.status = 'active'");
  });

  it("ambas SECURITY DEFINER, search_path vazio, revogadas de public, EXECUTE só para authenticated", () => {
    for (const name of ["can_view_store_orders", "can_manage_store_orders"]) {
      expect(sql).toContain(`revoke all on function public.${name}(uuid) from public`);
      expect(sql).toContain(`grant execute on function public.${name}(uuid) to authenticated`);
    }
  });
});

describe("orders/order_items — sem escrita direta, sem leitura pública", () => {
  it("revoga tudo antes de conceder; authenticated só recebe SELECT em ambas as tabelas", () => {
    for (const table of ["orders", "order_items"]) {
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated, service_role`);
      expect(sql).toContain(`grant select on public.${table} to authenticated`);
    }
  });

  it("nenhum GRANT de INSERT/UPDATE/DELETE a authenticated em orders/order_items", () => {
    for (const table of ["orders", "order_items"]) {
      const grantLines = sql.split(";").filter((s) => /^\s*grant\s/.test(s.trimStart()) && new RegExp(`\\bon\\s+public\\.${table}\\b`).test(s));
      for (const line of grantLines) {
        if (/\bto\b[^;]*\bauthenticated\b/.test(line)) {
          expect(line).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/);
        }
      }
    }
  });

  it("nenhuma linha de GRANT menciona anon em orders/order_items (nunca público)", () => {
    for (const table of ["orders", "order_items"]) {
      const grantLines = sql.split(";").filter((s) => /^\s*grant\s/.test(s.trimStart()) && new RegExp(`\\bon\\s+public\\.${table}\\b`).test(s));
      for (const line of grantLines) {
        expect(line).not.toMatch(/\banon\b/);
      }
    }
  });

  it("RLS habilitada e a única policy de SELECT usa can_view_store_orders", () => {
    expect(sql).toContain("alter table public.orders enable row level security");
    expect(sql).toContain("alter table public.order_items enable row level security");
    expect(sql).toMatch(/create policy orders_select_member[\s\S]*?using \(public\.can_view_store_orders\(store_id\)\)/);
    expect(sql).toMatch(/create policy order_items_select_member[\s\S]*?using \(public\.can_view_store_orders\(store_id\)\)/);
  });

  it("idempotency_key é UNIQUE por loja; public_code também", () => {
    expect(sql).toContain("constraint orders_store_idempotency_unique unique (store_id, idempotency_key)");
    expect(sql).toContain("constraint orders_store_public_code_unique unique (store_id, public_code)");
  });

  it("endereço de entrega é obrigatório quando fulfillment_method = delivery (constraint de banco)", () => {
    expect(sql).toContain("constraint orders_delivery_address_required check (");
    expect(sql).toContain("fulfillment_method <> 'delivery' or (delivery_address is not null");
  });

  it("store_id de orders/order_items é ON DELETE RESTRICT (registro histórico, mesma classe de audit_log)", () => {
    expect(sql).toMatch(/store_id uuid not null references public\.stores \(id\) on delete restrict/);
  });
});

describe("create_order — pública (anon), atômica, idempotente", () => {
  it("EXECUTE concedido a anon E authenticated (checkout sem login)", () => {
    expect(sql).toContain(
      "grant execute on function public.create_order(text, uuid, text, text, text, text, text, jsonb) to anon, authenticated",
    );
  });

  it("nunca confia em preço/total vindo do cliente — preço sempre lido de products dentro da função", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.create_order"),
      sql.indexOf("comment on function public.create_order"),
    );
    expect(fn).not.toMatch(/p_price|p_total|p_subtotal|p_unit_price/);
    expect(fn).toContain("v_row.price_cents");
    expect(fn).toContain("v_subtotal := v_subtotal + (v_row.price_cents * v_row.quantity)");
  });

  it("bloqueia produtos em ORDER BY id (evita deadlock)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.create_order"),
      sql.indexOf("comment on function public.create_order"),
    );
    expect(fn).toMatch(/order by p\.id\s*\n\s*for update of p/);
  });

  it("idempotência via advisory lock + fingerprint por (store_id, idempotency_key)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.create_order"),
      sql.indexOf("comment on function public.create_order"),
    );
    expect(fn).toContain("pg_advisory_xact_lock(hashtextextended(v_store_id::text || ':' || p_idempotency_key::text, 0))");
    expect(fn).toContain("'idempotency_conflict'");
    expect(fn).toContain("v_existing_order.request_fingerprint = v_fingerprint");
  });

  it("exige loja active e rejeita carrinho vazio", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.create_order"),
      sql.indexOf("comment on function public.create_order"),
    );
    expect(fn).toContain("'store_not_active'");
    expect(fn).toContain("'empty_cart'");
  });

  it("estoque reduzido com compare-and-swap (nunca SELECT-depois-UPDATE) e verificado por row_count", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.create_order"),
      sql.indexOf("comment on function public.create_order"),
    );
    expect(fn).toContain("where p.id = x.product_id and p.stock >= x.quantity");
    expect(fn).toContain("get diagnostics v_stock_updated_count = row_count");
    expect(fn).toContain("'stock_would_be_negative'");
  });

  it("grava order_created e order_stock_reserved na mesma transação", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.create_order"),
      sql.indexOf("comment on function public.create_order"),
    );
    expect(fn).toContain("'order_created'");
    expect(fn).toContain("'order_stock_reserved'");
  });
});

describe("order_advance_status — máquina de estados linear", () => {
  it("EXECUTE só para authenticated (nunca anon)", () => {
    expect(sql).toContain("grant execute on function public.order_advance_status(uuid, text) to authenticated");
    expect(sql).not.toMatch(/grant execute on function public\.order_advance_status\(uuid, text\) to anon/);
  });

  it("exige can_manage_store_orders e valida a transição via case/when explícito", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.order_advance_status"),
      sql.indexOf("comment on function public.order_advance_status"),
    );
    expect(fn).toContain("public.can_manage_store_orders(v_order.store_id)");
    expect(fn).toContain("when 'pending' then p_new_status = 'confirmed'");
    expect(fn).toContain("when 'confirmed' then p_new_status = 'preparing'");
    expect(fn).toContain("when 'preparing' then p_new_status = 'ready'");
    expect(fn).toContain("when 'ready' then p_new_status = 'completed'");
    expect(fn).toContain("else false");
    expect(fn).toContain("'invalid_status_transition'");
  });

  it("preenche completed_at só ao chegar em completed", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.order_advance_status"),
      sql.indexOf("comment on function public.order_advance_status"),
    );
    expect(fn).toContain("completed_at = case when p_new_status = 'completed' then now() else completed_at end");
  });
});

describe("order_cancel — atômico, devolve estoque exatamente uma vez", () => {
  it("EXECUTE só para authenticated (nunca anon)", () => {
    expect(sql).toContain("grant execute on function public.order_cancel(uuid) to authenticated");
    expect(sql).not.toMatch(/grant execute on function public\.order_cancel\(uuid\) to anon/);
  });

  it("trava a linha do pedido (for update) antes de checar status — serializa cancelamentos concorrentes", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.order_cancel"),
      sql.indexOf("comment on function public.order_cancel"),
    );
    expect(fn).toMatch(/select \* into v_order from public\.orders where id = p_order_id for update/);
  });

  it("completed e cancelled são terminais (nunca cancelados de novo)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.order_cancel"),
      sql.indexOf("comment on function public.order_cancel"),
    );
    expect(fn).toContain("if v_order.status in ('completed', 'cancelled') then");
    expect(fn).toContain("'invalid_status_transition'");
  });

  it("bloqueia produtos em ORDER BY id antes de devolver estoque (evita deadlock)", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.order_cancel"),
      sql.indexOf("comment on function public.order_cancel"),
    );
    expect(fn).toMatch(/order by p\.id\s*\n\s*for update of p/);
  });

  it("grava order_cancelled e order_stock_restored", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.order_cancel"),
      sql.indexOf("comment on function public.order_cancel"),
    );
    expect(fn).toContain("'order_cancelled'");
    expect(fn).toContain("'order_stock_restored'");
  });
});

describe("audit_log_action_check — só ALARGA (nunca estreita)", () => {
  it("todos os valores anteriores permanecem, os 5 eventos de pedido são adicionados", () => {
    const constraintStmt = sql.slice(
      sql.indexOf("alter table public.audit_log\n  drop constraint audit_log_action_check"),
      sql.indexOf("comment on constraint audit_log_action_check"),
    );
    const expectedActions = [
      "signup_completed",
      "password_recovery_completed",
      "category_created",
      "product_created",
      "product_stock_adjusted",
      "product_cover_changed",
      "order_created",
      "order_status_changed",
      "order_cancelled",
      "order_stock_reserved",
      "order_stock_restored",
    ];
    for (const action of expectedActions) {
      expect(constraintStmt).toContain(`'${action}'`);
    }
  });
});
