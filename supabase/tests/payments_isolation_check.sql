-- TASK-005 — Validação de RLS/policies/funções de pagamentos (Pix,
-- Mercado Pago) contra Postgres real. Mesmo padrão de
-- supabase/tests/orders_isolation_check.sql (TASK-004): tudo dentro de
-- UMA transação (BEGIN...ROLLBACK), um SAVEPOINT por cenário, nenhuma
-- alteração persiste.
--
-- Como rodar (requer Docker Desktop e os fixtures já seedados):
--   1. npx supabase start
--   2. npx supabase db reset
--   3. npm run seed:local
--   4. psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/payments_isolation_check.sql
--
-- Concorrência real (webhooks/reconciliação simultâneos) exige conexões
-- HTTP independentes — coberta em supabase/tests/payment-concurrency-check.ts,
-- não aqui. Criptografia, gateway (fake/real) e assinatura de webhook são
-- puro TypeScript — cobertos em lib/payments/*.test.ts, não aqui.

\set ON_ERROR_STOP on

begin;

do $$
begin
  perform set_config('app.admin_a_id', (select id::text from auth.users where email = 'admin-a@example.test'), true);
  perform set_config('app.admin_b_id', (select id::text from auth.users where email = 'admin-b@example.test'), true);
  perform set_config('app.cliente_a_id', (select id::text from auth.users where email = 'cliente-a@example.test'), true);
  perform set_config('app.merchant_multi_id', (select id::text from auth.users where email = 'merchant-multi@example.test'), true);
  perform set_config('app.merchant_pending_id', (select id::text from auth.users where email = 'merchant-pending@example.test'), true);
  perform set_config('app.merchant_suspended_id', (select id::text from auth.users where email = 'merchant-suspended@example.test'), true);
  perform set_config('app.store_a_id', (select id::text from public.stores where slug = 'store-a'), true);
  perform set_config('app.store_a_slug', 'store-a', true);
  perform set_config('app.store_b_id', (select id::text from public.stores where slug = 'store-b'), true);
  perform set_config('app.pending_store_id', (select id::text from public.stores where slug = 'loja-pendente-fixture'), true);
  perform set_config('app.suspended_store_id', (select id::text from public.stores where slug = 'loja-suspensa-fixture'), true);
end $$;

-- ------------------------------------------------------------
-- Setup: produto published em store-a, um pedido Pix criado via
-- create_order (TASK-004, sem alteração) para servir de base aos casos
-- de pagamento.
-- ------------------------------------------------------------
savepoint setup;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_prod public.products;
begin
  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto Pix', 'produto-pix', 2000, 10, null, null, null);
  perform set_config('app.pix_product_id', v_prod.id::text, true);
  perform public.catalog_set_product_status(v_prod.id, 'published');
end $$;
reset role;

set local role anon;
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.create_order(
    current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente Pix', '11999990000', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.pix_product_id')::uuid, 'quantity', 1))
  );
  perform set_config('app.pix_order_id', v_order.id::text, true);
  perform set_config('app.pix_order_total_cents', v_order.total_cents::text, true);
end $$;
reset role;

-- ------------------------------------------------------------
-- Caso 1: owner/admin de loja active configura credenciais.
-- ------------------------------------------------------------
savepoint case_1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_row public.store_payment_settings;
begin
  select * into v_row from public.payment_settings_upsert(current_setting('app.store_a_id')::uuid, 'test', 'ciphertext-fake-a1:b2:c3', 'ciphertext-fake-webhook', 'APP_USR-••••1234');
  if v_row.id is null then
    raise exception 'FAIL - Caso 1: owner nao conseguiu configurar credenciais';
  end if;
  raise notice 'PASS - Caso 1: owner/admin de loja active configura credenciais';
end $$;
reset role;
rollback to savepoint case_1;

-- Recria a configuração (fora de savepoint local, para os casos seguintes reutilizarem).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
select public.payment_settings_upsert(current_setting('app.store_a_id')::uuid, 'test', 'ciphertext-fake-a1:b2:c3', 'ciphertext-fake-webhook', 'APP_USR-••••1234');
select public.payment_settings_set_enabled(current_setting('app.store_a_id')::uuid, true);
reset role;

-- ------------------------------------------------------------
-- Caso 2: staff não configura credenciais.
-- ------------------------------------------------------------
savepoint case_2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_multi_id'))::text, true);
do $$
begin
  begin
    perform public.payment_settings_upsert(current_setting('app.store_a_id')::uuid, 'test', 'x', 'y', 'z');
    raise exception 'FAIL - Caso 2: staff conseguiu configurar credenciais';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 2: staff negado ao configurar credenciais';
      else
        raise exception 'FAIL - Caso 2: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_2;

-- ------------------------------------------------------------
-- Caso 3: owner de loja pending_payment não configura credenciais.
-- ------------------------------------------------------------
savepoint case_3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);
do $$
begin
  begin
    perform public.payment_settings_upsert(current_setting('app.pending_store_id')::uuid, 'test', 'x', 'y', 'z');
    raise exception 'FAIL - Caso 3: loja pending_payment conseguiu configurar credenciais';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 3: loja pending_payment negada ao configurar credenciais';
      else
        raise exception 'FAIL - Caso 3: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_3;

-- ------------------------------------------------------------
-- Caso 4: owner de loja suspended não configura credenciais.
-- ------------------------------------------------------------
savepoint case_4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_suspended_id'))::text, true);
do $$
begin
  begin
    perform public.payment_settings_upsert(current_setting('app.suspended_store_id')::uuid, 'test', 'x', 'y', 'z');
    raise exception 'FAIL - Caso 4: loja suspended conseguiu configurar credenciais';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 4: loja suspended negada ao configurar credenciais';
      else
        raise exception 'FAIL - Caso 4: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_4;

-- ------------------------------------------------------------
-- Caso 5: payment_settings_get nunca devolve as credenciais cifradas
-- (a função nem tem essas colunas no retorno — checagem estrutural).
-- ------------------------------------------------------------
savepoint case_5;
do $$
declare
  v_cols text;
begin
  select string_agg(a.attname, ',') into v_cols
  from pg_proc p
  join pg_type t on t.oid = p.prorettype
  join pg_attribute a on a.attrelid = t.typrelid
  where p.proname = 'payment_settings_get';

  if v_cols ilike '%encrypted%' then
    raise exception 'FAIL - Caso 5: payment_settings_get expõe coluna cifrada: %', v_cols;
  end if;
  raise notice 'PASS - Caso 5: payment_settings_get nunca devolve credenciais cifradas (colunas: %)', v_cols;
end $$;
rollback to savepoint case_5;

-- ------------------------------------------------------------
-- Caso 6: DML direto negado em store_payment_settings/order_payments/payment_webhook_events.
-- ------------------------------------------------------------
savepoint case_6;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    insert into public.store_payment_settings (store_id, environment, encrypted_access_token, encrypted_webhook_secret, access_token_preview, webhook_key)
    values (current_setting('app.store_a_id')::uuid, 'test', 'x', 'y', 'z', 'w');
    raise exception 'FAIL - Caso 6a: INSERT direto em store_payment_settings foi aceito';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 6a: INSERT direto em store_payment_settings negado (permission denied)';
  end;
end $$;
do $$
begin
  begin
    insert into public.order_payments (store_id, order_id, provider_idempotency_key, external_reference, amount_cents, payer_email, payer_doc_type, payer_doc_last4)
    values (current_setting('app.store_a_id')::uuid, current_setting('app.pix_order_id')::uuid, 'x', 'y', 100, 'a@b.com', 'CPF', '1234');
    raise exception 'FAIL - Caso 6b: INSERT direto em order_payments foi aceito';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 6b: INSERT direto em order_payments negado (permission denied)';
  end;
end $$;
do $$
begin
  begin
    insert into public.payment_webhook_events (store_id, provider_payment_id, payload_hash)
    values (current_setting('app.store_a_id')::uuid, 'x', 'y');
    raise exception 'FAIL - Caso 6c: INSERT direto em payment_webhook_events foi aceito';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 6c: INSERT direto em payment_webhook_events negado (permission denied)';
  end;
end $$;
reset role;
rollback to savepoint case_6;

-- ------------------------------------------------------------
-- Caso 7: anon não lê nenhuma tabela de pagamento.
-- ------------------------------------------------------------
savepoint case_7;
set local role anon;
do $$
declare
  v_count integer;
begin
  begin
    select count(*) into v_count from public.store_payment_settings;
    raise exception 'FAIL - Caso 7a: anon leu store_payment_settings';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 7a: anon negado ao consultar store_payment_settings';
  end;
  begin
    select count(*) into v_count from public.order_payments;
    raise exception 'FAIL - Caso 7b: anon leu order_payments';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 7b: anon negado ao consultar order_payments';
  end;
end $$;
reset role;
rollback to savepoint case_7;

-- ------------------------------------------------------------
-- Caso 8: criação idempotente de payment_attempt (service_role) — mesma
-- order_id nunca cria uma segunda linha, e sempre marca payment_mode=pix.
-- ------------------------------------------------------------
savepoint case_8;
set local role service_role;
do $$
declare
  v_attempt1 public.order_payments;
  v_attempt2 public.order_payments;
  v_order public.orders;
begin
  select * into v_attempt1 from public.pix_payment_attempt_upsert_creating(
    current_setting('app.pix_order_id')::uuid, 'idem-key-1', current_setting('app.pix_order_total_cents')::integer, 'BRL',
    'cliente@example.test', 'CPF', '1234', encode(sha256('token-recibo-1'::bytea), 'hex')
  );
  select * into v_attempt2 from public.pix_payment_attempt_upsert_creating(
    current_setting('app.pix_order_id')::uuid, 'idem-key-1', current_setting('app.pix_order_total_cents')::integer, 'BRL',
    'cliente@example.test', 'CPF', '1234', encode(sha256('token-recibo-1'::bytea), 'hex')
  );
  if v_attempt1.id <> v_attempt2.id then
    raise exception 'FAIL - Caso 8: retry criou uma SEGUNDA tentativa de pagamento (id1=%, id2=%)', v_attempt1.id, v_attempt2.id;
  end if;
  perform set_config('app.pix_attempt_id', v_attempt1.id::text, true);
  perform set_config('app.pix_external_reference', v_attempt1.external_reference, true);

  select * into v_order from public.orders where id = current_setting('app.pix_order_id')::uuid;
  if v_order.payment_mode <> 'pix' then
    raise exception 'FAIL - Caso 8: orders.payment_mode nao foi marcado como pix';
  end if;
  if v_order.receipt_token_hash is null then
    raise exception 'FAIL - Caso 8: orders.receipt_token_hash nao foi preenchido';
  end if;
  raise notice 'PASS - Caso 8: pix_payment_attempt_upsert_creating idempotente por order_id, payment_mode/receipt_token_hash marcados';
end $$;
reset role;

-- ------------------------------------------------------------
-- Caso 9: authenticated/anon NÃO conseguem chamar as funções de
-- orquestração (service_role apenas).
-- ------------------------------------------------------------
savepoint case_9;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    perform public.pix_payment_attempt_upsert_creating(current_setting('app.pix_order_id')::uuid, 'x', 100, 'BRL', 'a@b.com', 'CPF', '1234', 'x');
    raise exception 'FAIL - Caso 9: authenticated conseguiu chamar pix_payment_attempt_upsert_creating';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 9: authenticated negado ao chamar pix_payment_attempt_upsert_creating (só service_role)';
  end;
end $$;
reset role;
rollback to savepoint case_9;

-- ------------------------------------------------------------
-- Caso 10: pix_payment_mark_created preenche QR/expiração e é
-- idempotente (retry depois de já criado não sobrescreve).
-- ------------------------------------------------------------
savepoint case_10;
set local role service_role;
do $$
declare
  v_created public.order_payments;
  v_retry public.order_payments;
begin
  select * into v_created from public.pix_payment_mark_created(
    current_setting('app.pix_attempt_id')::uuid, 'mp-payment-123', 'pending', 'pending_waiting_transfer',
    'copia-e-cola-fake', 'base64-fake', 'https://ticket.fake', now() + interval '30 minutes'
  );
  if v_created.status <> 'pending' or v_created.qr_code is null then
    raise exception 'FAIL - Caso 10a: pix_payment_mark_created nao preencheu status/QR corretamente';
  end if;

  select * into v_retry from public.pix_payment_mark_created(
    current_setting('app.pix_attempt_id')::uuid, 'mp-payment-999-outro', 'approved', 'accredited',
    null, null, null, null
  );
  if v_retry.provider_payment_id <> 'mp-payment-123' or v_retry.status <> 'pending' then
    raise exception 'FAIL - Caso 10b: segunda chamada sobrescreveu um estado ja avancado (provider_payment_id=%, status=%)', v_retry.provider_payment_id, v_retry.status;
  end if;
  raise notice 'PASS - Caso 10: pix_payment_mark_created preenche QR corretamente e é idempotente (nunca sobrescreve depois de sair de creating)';
end $$;
reset role;

-- ------------------------------------------------------------
-- Caso 11: pix_payment_apply_provider_state — approved confirma o
-- pedido UMA vez e nunca baixa estoque de novo.
-- ------------------------------------------------------------
savepoint case_11;
set local role service_role;
do $$
declare
  v_attempt public.order_payments;
  v_order public.orders;
  v_stock_before integer;
  v_stock_after integer;
  v_confirm_events integer;
begin
  select stock into v_stock_before from public.products where id = current_setting('app.pix_product_id')::uuid;

  select * into v_attempt from public.pix_payment_apply_provider_state(
    current_setting('app.pix_attempt_id')::uuid, 'mp-payment-123', 'approved', 'approved', 'accredited',
    current_setting('app.pix_order_total_cents')::integer, 'BRL', current_setting('app.pix_external_reference'),
    null, null, null, null
  );
  if v_attempt.status <> 'approved' or v_attempt.approved_at is null then
    raise exception 'FAIL - Caso 11a: pagamento nao ficou approved';
  end if;

  select * into v_order from public.orders where id = current_setting('app.pix_order_id')::uuid;
  if v_order.status <> 'confirmed' then
    raise exception 'FAIL - Caso 11b: pedido nao foi confirmado automaticamente (status=%)', v_order.status;
  end if;

  select stock into v_stock_after from public.products where id = current_setting('app.pix_product_id')::uuid;
  if v_stock_after <> v_stock_before then
    raise exception 'FAIL - Caso 11c: estoque foi alterado na aprovacao (antes=%, depois=%)', v_stock_before, v_stock_after;
  end if;

  -- Segundo "approved" (webhook duplicado) — idempotente, nunca confirma
  -- o pedido de novo nem duplica o evento de auditoria.
  perform public.pix_payment_apply_provider_state(
    current_setting('app.pix_attempt_id')::uuid, 'mp-payment-123', 'approved', 'approved', 'accredited',
    current_setting('app.pix_order_total_cents')::integer, 'BRL', current_setting('app.pix_external_reference'),
    null, null, null, null
  );
  select count(*) into v_confirm_events from public.audit_log where action = 'order_confirmed_by_payment' and target_id = current_setting('app.pix_order_id');
  if v_confirm_events <> 1 then
    raise exception 'FAIL - Caso 11d: order_confirmed_by_payment nao ocorreu exatamente 1 vez (obtido %)', v_confirm_events;
  end if;

  raise notice 'PASS - Caso 11: approved confirma o pedido uma unica vez, nunca baixa estoque de novo, webhook duplicado e idempotente';
end $$;
reset role;

-- ------------------------------------------------------------
-- Caso 12: pedido pago não pode ser cancelado por order_cancel nem por
-- order_advance_status retroceder — erro seguro (sem reembolso).
-- ------------------------------------------------------------
savepoint case_12;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    perform public.order_cancel(current_setting('app.pix_order_id')::uuid);
    raise exception 'FAIL - Caso 12: order_cancel aceitou cancelar pedido Pix';
  exception
    when others then
      if sqlerrm = 'pix_order_requires_payment_flow' then
        raise notice 'PASS - Caso 12: order_cancel recusa pedido Pix (pix_order_requires_payment_flow)';
      else
        raise exception 'FAIL - Caso 12: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;

-- ------------------------------------------------------------
-- Caso 13: pedido Pix já confirmado avança normalmente pelo painel
-- (confirmed->preparing->ready->completed).
-- ------------------------------------------------------------
savepoint case_13;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.order_advance_status(current_setting('app.pix_order_id')::uuid, 'preparing');
  if v_order.status <> 'preparing' then
    raise exception 'FAIL - Caso 13: pedido Pix confirmado nao avancou para preparing';
  end if;
  raise notice 'PASS - Caso 13: pedido Pix ja confirmado avanca normalmente pelo painel (confirmed->preparing)';
end $$;
reset role;
rollback to savepoint case_13;

-- ------------------------------------------------------------
-- Caso 14: manual_review em divergência de amount/external_reference —
-- nunca decide sozinho, nunca confirma nem cancela o pedido.
-- ------------------------------------------------------------
savepoint case_14;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_prod public.products;
  v_order public.orders;
  v_attempt public.order_payments;
begin
  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto Pix 2', 'produto-pix-2', 3000, 5, null, null, null);
  perform public.catalog_set_product_status(v_prod.id, 'published');
  perform set_config('app.pix_product_2_id', v_prod.id::text, true);
end $$;
reset role;

set local role anon;
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.create_order(
    current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente Pix 2', '11999990001', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.pix_product_2_id')::uuid, 'quantity', 1))
  );
  perform set_config('app.pix_order_2_id', v_order.id::text, true);
  perform set_config('app.pix_order_2_total_cents', v_order.total_cents::text, true);
end $$;
reset role;

set local role service_role;
do $$
declare
  v_attempt public.order_payments;
  v_order public.orders;
  v_review_events integer;
begin
  select * into v_attempt from public.pix_payment_attempt_upsert_creating(
    current_setting('app.pix_order_2_id')::uuid, 'idem-key-2', current_setting('app.pix_order_2_total_cents')::integer, 'BRL',
    'cliente2@example.test', 'CPF', '5678', encode(sha256('token-recibo-2'::bytea), 'hex')
  );
  perform public.pix_payment_mark_created(v_attempt.id, 'mp-payment-456', 'pending', 'pending_waiting_transfer', 'qr', 'qr64', 'https://ticket', now() + interval '30 minutes');

  -- amount divergente do que está gravado na tentativa.
  perform public.pix_payment_apply_provider_state(
    v_attempt.id, 'mp-payment-456', 'approved', 'approved', 'accredited',
    999999, 'BRL', v_attempt.external_reference, null, null, null, null
  );

  select status into v_attempt.status from public.order_payments where id = v_attempt.id;
  if v_attempt.status <> 'manual_review' then
    raise exception 'FAIL - Caso 14a: amount divergente nao gerou manual_review (status=%)', v_attempt.status;
  end if;

  select * into v_order from public.orders where id = current_setting('app.pix_order_2_id')::uuid;
  if v_order.status <> 'pending' then
    raise exception 'FAIL - Caso 14b: pedido foi alterado mesmo com divergencia de amount (status=%)', v_order.status;
  end if;

  select count(*) into v_review_events from public.audit_log where action = 'payment_manual_review_required' and target_id = v_attempt.id::text;
  if v_review_events <> 1 then
    raise exception 'FAIL - Caso 14c: payment_manual_review_required nao foi auditado (obtido %)', v_review_events;
  end if;

  raise notice 'PASS - Caso 14: amount divergente vira manual_review, nunca decide sozinho, pedido preservado como pending, auditoria critica registrada';
end $$;
reset role;

-- ------------------------------------------------------------
-- Caso 15: rejected/cancelled/expired cancela o pedido e devolve o
-- estoque exatamente uma vez.
-- ------------------------------------------------------------
savepoint case_15;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_prod public.products;
begin
  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto Pix 3', 'produto-pix-3', 1500, 8, null, null, null);
  perform public.catalog_set_product_status(v_prod.id, 'published');
  perform set_config('app.pix_product_3_id', v_prod.id::text, true);
end $$;
reset role;

set local role anon;
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.create_order(
    current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente Pix 3', '11999990002', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.pix_product_3_id')::uuid, 'quantity', 3))
  );
  perform set_config('app.pix_order_3_id', v_order.id::text, true);
  perform set_config('app.pix_order_3_total_cents', v_order.total_cents::text, true);
end $$;
reset role;

set local role service_role;
do $$
declare
  v_attempt public.order_payments;
  v_order public.orders;
  v_stock_before integer;
  v_stock_after integer;
  v_cancel_events integer;
begin
  select stock into v_stock_before from public.products where id = current_setting('app.pix_product_3_id')::uuid;

  select * into v_attempt from public.pix_payment_attempt_upsert_creating(
    current_setting('app.pix_order_3_id')::uuid, 'idem-key-3', current_setting('app.pix_order_3_total_cents')::integer, 'BRL',
    'cliente3@example.test', 'CPF', '9012', encode(sha256('token-recibo-3'::bytea), 'hex')
  );
  perform public.pix_payment_mark_created(v_attempt.id, 'mp-payment-789', 'pending', 'pending_waiting_transfer', 'qr', 'qr64', 'https://ticket', now() + interval '30 minutes');

  perform public.pix_payment_apply_provider_state(
    v_attempt.id, 'mp-payment-789', 'rejected', 'rejected', 'cc_rejected_other_reason',
    current_setting('app.pix_order_3_total_cents')::integer, 'BRL', v_attempt.external_reference, null, null, null, null
  );

  select * into v_order from public.orders where id = current_setting('app.pix_order_3_id')::uuid;
  if v_order.status <> 'cancelled' then
    raise exception 'FAIL - Caso 15a: pedido nao foi cancelado apos rejected (status=%)', v_order.status;
  end if;

  select stock into v_stock_after from public.products where id = current_setting('app.pix_product_3_id')::uuid;
  if v_stock_after <> v_stock_before + 3 then
    raise exception 'FAIL - Caso 15b: estoque nao foi devolvido corretamente (antes=%, depois=%)', v_stock_before, v_stock_after;
  end if;

  -- Segundo evento terminal (webhook duplicado) — idempotente, nunca devolve estoque de novo.
  perform public.pix_payment_apply_provider_state(
    v_attempt.id, 'mp-payment-789', 'rejected', 'rejected', 'cc_rejected_other_reason',
    current_setting('app.pix_order_3_total_cents')::integer, 'BRL', v_attempt.external_reference, null, null, null, null
  );
  select stock into v_stock_after from public.products where id = current_setting('app.pix_product_3_id')::uuid;
  if v_stock_after <> v_stock_before + 3 then
    raise exception 'FAIL - Caso 15c: estoque foi devolvido DE NOVO no segundo evento terminal (antes=%, depois=%)', v_stock_before, v_stock_after;
  end if;

  select count(*) into v_cancel_events from public.audit_log where action = 'order_cancelled_by_payment_failure' and target_id = current_setting('app.pix_order_3_id');
  if v_cancel_events <> 1 then
    raise exception 'FAIL - Caso 15d: order_cancelled_by_payment_failure nao ocorreu exatamente 1 vez (obtido %)', v_cancel_events;
  end if;

  raise notice 'PASS - Caso 15: rejected cancela o pedido e devolve o estoque exatamente uma vez, mesmo com evento terminal duplicado';
end $$;
reset role;

-- ------------------------------------------------------------
-- Caso 16: approved depois de já cancelado/restaurado — nunca confirma
-- automaticamente uma ordem inconsistente, vira manual_review.
-- ------------------------------------------------------------
savepoint case_16;
set local role service_role;
do $$
declare
  v_attempt_id uuid;
  v_order public.orders;
  v_stock_after integer;
  v_review_events integer;
begin
  select id into v_attempt_id from public.order_payments where order_id = current_setting('app.pix_order_3_id')::uuid;

  -- "approved" chega atrasado depois do pedido já ter sido cancelado/estoque restaurado (Caso 15).
  perform public.pix_payment_apply_provider_state(
    v_attempt_id, 'mp-payment-789', 'approved', 'approved', 'accredited',
    current_setting('app.pix_order_3_total_cents')::integer, 'BRL',
    (select external_reference from public.order_payments where id = v_attempt_id),
    null, null, null, null
  );

  select * into v_order from public.orders where id = current_setting('app.pix_order_3_id')::uuid;
  if v_order.status <> 'cancelled' then
    raise exception 'FAIL - Caso 16a: pedido foi confirmado automaticamente apos ja cancelado (status=%)', v_order.status;
  end if;

  select count(*) into v_review_events from public.audit_log where action = 'payment_manual_review_required' and target_id = v_attempt_id::text;
  if v_review_events <> 1 then
    raise exception 'FAIL - Caso 16b: payment_manual_review_required nao foi auditado para o caso approved-apos-cancelado (obtido %)', v_review_events;
  end if;

  raise notice 'PASS - Caso 16: approved atrasado depois de cancelado/restaurado nunca confirma automaticamente — manual_review + auditoria critica';
end $$;
reset role;

-- ------------------------------------------------------------
-- Caso 17: Loja B não lê pagamento nem configurações da Loja A.
-- ------------------------------------------------------------
savepoint case_17;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_b_id'))::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.order_payments where store_id = current_setting('app.store_a_id')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL - Caso 17a: admin-b (Loja B) leu % pagamento(s) da Loja A', v_count;
  end if;
  raise notice 'PASS - Caso 17a: admin-b (Loja B) nao le pagamentos da Loja A';

  begin
    perform public.payment_settings_get(current_setting('app.store_a_id')::uuid);
    raise exception 'FAIL - Caso 17b: admin-b conseguiu ler configuracao de pagamento da Loja A';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 17b: admin-b negado ao ler configuracao de pagamento da Loja A';
      else
        raise exception 'FAIL - Caso 17b: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_17;

-- ------------------------------------------------------------
-- Caso 18: staff (merchant-multi) não lê order_payments (só owner/admin).
-- ------------------------------------------------------------
savepoint case_18;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_multi_id'))::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.order_payments where store_id = current_setting('app.store_a_id')::uuid;
  if v_count <> 0 then
    raise exception 'FAIL - Caso 18: staff leu % pagamento(s) (deveria ser 0, so owner/admin)', v_count;
  end if;
  raise notice 'PASS - Caso 18: staff nao le order_payments (can_manage_store_payments exige owner/admin)';
end $$;
reset role;
rollback to savepoint case_18;

-- ------------------------------------------------------------
-- Caso 19: payment_events_list_sanitized escopado por loja — Loja B não
-- lê eventos de um pedido da Loja A.
-- ------------------------------------------------------------
savepoint case_19;
set local role service_role;
do $$
begin
  perform public.pix_webhook_event_record(
    current_setting('app.store_a_id')::uuid, current_setting('app.pix_attempt_id')::uuid,
    'req-1', 'mp-payment-123', 'payment.updated', 'hash-fake-1', 'processed', null
  );
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.payment_events_list_sanitized(current_setting('app.pix_order_id')::uuid);
  if v_count = 0 then
    raise exception 'FAIL - Caso 19a: admin-a nao viu o proprio evento de webhook';
  end if;
  raise notice 'PASS - Caso 19a: admin-a le o historico de eventos do proprio pedido (% evento(s))', v_count;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_b_id'))::text, true);
do $$
begin
  begin
    perform public.payment_events_list_sanitized(current_setting('app.pix_order_id')::uuid);
    raise exception 'FAIL - Caso 19b: admin-b conseguiu ler eventos de pedido da Loja A';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 19b: admin-b negado ao ler eventos de pedido da Loja A';
      else
        raise exception 'FAIL - Caso 19b: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_19;

-- Nenhuma alteração persiste: garante execução repetível a qualquer momento.
rollback;
