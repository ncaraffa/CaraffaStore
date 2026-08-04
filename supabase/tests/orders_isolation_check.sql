-- TASK-004 — Validação de RLS/policies/funções de pedidos (carrinho,
-- checkout sem pagamento, gestão de pedidos) contra Postgres real. Mesmo
-- padrão de supabase/tests/catalog_isolation_check.sql (TASK-003): tudo
-- dentro de UMA transação (BEGIN...ROLLBACK), um SAVEPOINT por cenário,
-- nenhuma alteração persiste.
--
-- Como rodar (requer Docker Desktop e os fixtures já seedados):
--   1. npx supabase start
--   2. npx supabase db reset
--   3. npm run seed:local
--   4. psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/orders_isolation_check.sql
--
-- Concorrência real (criação/cancelamento simultâneos) exige conexões
-- HTTP independentes — coberta em supabase/tests/order-concurrency-check.ts,
-- não aqui (mesmo motivo de stock-concurrency-check.ts para a TASK-003).
-- Isolamento de carrinho por loja (localStorage) é client-side puro —
-- coberto por lib/cart/storage.test.ts, não aqui.

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
  perform set_config('app.pending_store_slug', 'loja-pendente-fixture', true);
  perform set_config('app.suspended_store_id', (select id::text from public.stores where slug = 'loja-suspensa-fixture'), true);
  perform set_config('app.suspended_store_slug', 'loja-suspensa-fixture', true);
end $$;

-- ------------------------------------------------------------
-- Setup: produtos reais (published/draft/archived em store-a, published
-- em store-b) criados como admin-a/admin-b via RPC real — não via
-- INSERT direto, para exercitar o mesmo caminho de produção.
-- ------------------------------------------------------------
savepoint setup;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_prod public.products;
begin
  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto Pedido Published', 'produto-pedido-published', 1000, 10, null, null, null);
  perform set_config('app.published_product_id', v_prod.id::text, true);
  perform public.catalog_set_product_status(v_prod.id, 'published');

  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto Pedido Draft', 'produto-pedido-draft', 500, 10, null, null, null);
  perform set_config('app.draft_product_id', v_prod.id::text, true);

  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto Pedido Archived', 'produto-pedido-archived', 500, 10, null, null, null);
  perform public.catalog_set_product_status(v_prod.id, 'published');
  perform public.catalog_set_product_status(v_prod.id, 'archived');
  perform set_config('app.archived_product_id', v_prod.id::text, true);

  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto Esgotado', 'produto-esgotado', 500, 0, null, null, null);
  perform public.catalog_set_product_status(v_prod.id, 'published');
  perform set_config('app.zero_stock_product_id', v_prod.id::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_b_id'))::text, true);
do $$
declare
  v_prod public.products;
begin
  select * into v_prod from public.catalog_create_product(current_setting('app.store_b_id')::uuid, 'Produto Loja B', 'produto-loja-b-pedido', 700, 10, null, null, null);
  perform public.catalog_set_product_status(v_prod.id, 'published');
  perform set_config('app.store_b_product_id', v_prod.id::text, true);
end $$;
reset role;

-- ------------------------------------------------------------
-- Caso 1: anon cria pedido válido em loja active — preço/total sempre
-- do banco, nunca do cliente (create_order nem aceita esse parâmetro).
-- ------------------------------------------------------------
savepoint case_1;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.create_order(
    current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente Um', '+5511999990001', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 2))
  );
  if v_order.total_cents = 2000 and v_order.subtotal_cents = 2000 and v_order.status = 'pending' then
    raise notice 'PASS - Caso 1: anon cria pedido valido, total calculado no banco (2000)';
  else
    raise exception 'FAIL - Caso 1: total=%, subtotal=%, status=%', v_order.total_cents, v_order.subtotal_cents, v_order.status;
  end if;
  perform set_config('app.case1_order_id', v_order.id::text, true);
end $$;
reset role;
rollback to savepoint case_1;

-- ------------------------------------------------------------
-- Caso 2: pedido em loja pending_payment é rejeitado.
-- ------------------------------------------------------------
savepoint case_2;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.pending_store_slug'), gen_random_uuid(), 'Cliente', '+5511999990002', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 1))
    );
    raise exception 'FAIL - Caso 2: pedido em loja pending_payment foi aceito';
  exception
    when others then
      if sqlerrm = 'store_not_active' then
        raise notice 'PASS - Caso 2: loja pending_payment rejeitada (store_not_active)';
      else
        raise exception 'FAIL - Caso 2: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_2;

-- Caso 3: pedido em loja suspended é rejeitado.
savepoint case_3;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.suspended_store_slug'), gen_random_uuid(), 'Cliente', '+5511999990003', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 1))
    );
    raise exception 'FAIL - Caso 3: pedido em loja suspended foi aceito';
  exception
    when others then
      if sqlerrm = 'store_not_active' then
        raise notice 'PASS - Caso 3: loja suspended rejeitada (store_not_active)';
      else
        raise exception 'FAIL - Caso 3: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_3;

-- Caso 4: carrinho vazio é rejeitado.
savepoint case_4;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente', '+5511999990004', 'pickup', null, null, '[]'::jsonb
    );
    raise exception 'FAIL - Caso 4: carrinho vazio foi aceito';
  exception
    when others then
      if sqlerrm = 'empty_cart' then
        raise notice 'PASS - Caso 4: carrinho vazio rejeitado';
      else
        raise exception 'FAIL - Caso 4: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_4;

-- Caso 5: produto draft é rejeitado.
savepoint case_5;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente', '+5511999990005', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('app.draft_product_id'), 'quantity', 1))
    );
    raise exception 'FAIL - Caso 5: produto draft foi aceito';
  exception
    when others then
      if sqlerrm = 'product_not_available' then
        raise notice 'PASS - Caso 5: produto draft rejeitado';
      else
        raise exception 'FAIL - Caso 5: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_5;

-- Caso 6: produto archived é rejeitado.
savepoint case_6;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente', '+5511999990006', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('app.archived_product_id'), 'quantity', 1))
    );
    raise exception 'FAIL - Caso 6: produto archived foi aceito';
  exception
    when others then
      if sqlerrm = 'product_not_available' then
        raise notice 'PASS - Caso 6: produto archived rejeitado';
      else
        raise exception 'FAIL - Caso 6: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_6;

-- Caso 7: produto de outra loja (store-b) pedido em store-a é rejeitado.
savepoint case_7;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente', '+5511999990007', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('app.store_b_product_id'), 'quantity', 1))
    );
    raise exception 'FAIL - Caso 7: produto de outra loja foi aceito';
  exception
    when others then
      if sqlerrm = 'product_store_mismatch' then
        raise notice 'PASS - Caso 7: produto de outra loja rejeitado (product_store_mismatch)';
      else
        raise exception 'FAIL - Caso 7: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_7;

-- Caso 8: item malformado (quantidade zero/negativa/decimal, product_id inválido) é rejeitado.
savepoint case_8;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_bad_items jsonb[] := array[
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 0)),
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', -1)),
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 1.5)),
    jsonb_build_array(jsonb_build_object('product_id', 'nao-e-um-uuid', 'quantity', 1))
  ];
  v_items jsonb;
  v_i integer;
begin
  for v_i in 1..array_length(v_bad_items, 1) loop
    v_items := v_bad_items[v_i];
    begin
      perform public.create_order(
        current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente', '+5511999990008', 'pickup', null, null, v_items
      );
      raise exception 'FAIL - Caso 8.%: item malformado foi aceito (%)', v_i, v_items;
    exception
      when others then
        if sqlerrm <> 'invalid_item' then
          raise exception 'FAIL - Caso 8.%: erro inesperado: %', v_i, sqlerrm;
        end if;
    end;
  end loop;
  raise notice 'PASS - Caso 8: quantidade zero/negativa/decimal e product_id invalido sempre rejeitados (invalid_item)';
end $$;
reset role;
rollback to savepoint case_8;

-- Caso 9: produto esgotado (stock=0) é rejeitado.
savepoint case_9;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente', '+5511999990009', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('app.zero_stock_product_id'), 'quantity', 1))
    );
    raise exception 'FAIL - Caso 9: produto esgotado foi aceito';
  exception
    when others then
      if sqlerrm = 'insufficient_stock' then
        raise notice 'PASS - Caso 9: produto esgotado (stock=0) rejeitado';
      else
        raise exception 'FAIL - Caso 9: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_9;

-- Caso 10: quantidade acima do estoque disponível é rejeitada (estoque nunca fica negativo).
savepoint case_10;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente', '+5511999990010', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 999))
    );
    raise exception 'FAIL - Caso 10: quantidade acima do estoque foi aceita';
  exception
    when others then
      if sqlerrm = 'insufficient_stock' then
        raise notice 'PASS - Caso 10: quantidade acima do estoque rejeitada';
      else
        raise exception 'FAIL - Caso 10: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_10;

-- Caso 11: entrega sem endereço é rejeitada.
savepoint case_11;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente', '+5511999990011', 'delivery', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 1))
    );
    raise exception 'FAIL - Caso 11: entrega sem endereco foi aceita';
  exception
    when others then
      if sqlerrm = 'delivery_address_required' then
        raise notice 'PASS - Caso 11: entrega sem endereco rejeitada';
      else
        raise exception 'FAIL - Caso 11: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_11;

-- ------------------------------------------------------------
-- Caso 12: estoque reduzido corretamente; snapshots preservados mesmo
-- após o produto ser editado (nome/preço) depois do pedido.
-- ------------------------------------------------------------
savepoint case_12;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.create_order(
    current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente Snapshot', '+5511999990012', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 3))
  );
  perform set_config('app.case12_order_id', v_order.id::text, true);
end $$;
reset role;

do $$
declare
  v_stock integer;
begin
  select stock into v_stock from public.products where id = current_setting('app.published_product_id')::uuid;
  if v_stock = 7 then -- 10 inicial - 3 do pedido
    raise notice 'PASS - Caso 12a: estoque reduzido corretamente (10 -> 7)';
  else
    raise exception 'FAIL - Caso 12a: estoque esperado 7, obtido %', v_stock;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  perform public.catalog_update_product(current_setting('app.published_product_id')::uuid, 'Nome Totalmente Diferente', 'produto-pedido-published', 999999, null, null, null);
end $$;
reset role;

do $$
declare
  v_snapshot_name text;
  v_snapshot_price integer;
begin
  select product_name_snapshot, unit_price_cents into v_snapshot_name, v_snapshot_price
    from public.order_items where order_id = current_setting('app.case12_order_id')::uuid;
  if v_snapshot_name = 'Produto Pedido Published' and v_snapshot_price = 1000 then
    raise notice 'PASS - Caso 12b: snapshot do pedido preservado apos produto ser renomeado/reprecificado';
  else
    raise exception 'FAIL - Caso 12b: snapshot mudou junto com o produto: nome=%, preco=%', v_snapshot_name, v_snapshot_price;
  end if;
end $$;
rollback to savepoint case_12;

-- ------------------------------------------------------------
-- Caso 13: idempotência — mesma key + mesmo conteúdo não duplica pedido
-- nem baixa estoque duas vezes; mesma key + conteúdo diferente é
-- rejeitada.
-- ------------------------------------------------------------
savepoint case_13;
do $$
begin
  perform set_config('app.case13_key', gen_random_uuid()::text, true);
end $$;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_order1 public.orders;
  v_order2 public.orders;
begin
  select * into v_order1 from public.create_order(
    current_setting('app.store_a_slug'), current_setting('app.case13_key')::uuid, 'Cliente Idempotente', '+5511999990013', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 1))
  );
  select * into v_order2 from public.create_order(
    current_setting('app.store_a_slug'), current_setting('app.case13_key')::uuid, 'Cliente Idempotente', '+5511999990013', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 1))
  );
  if v_order1.id = v_order2.id then
    raise notice 'PASS - Caso 13a: reenvio idempotente (mesma key/conteudo) devolve o MESMO pedido';
  else
    raise exception 'FAIL - Caso 13a: reenvio criou um pedido diferente (% vs %)', v_order1.id, v_order2.id;
  end if;
  perform set_config('app.case13_order_id', v_order1.id::text, true);
end $$;
reset role;

do $$
declare
  v_stock integer;
  v_count integer;
begin
  select stock into v_stock from public.products where id = current_setting('app.published_product_id')::uuid;
  if v_stock = 9 then -- 10 - 1, so uma vez
    raise notice 'PASS - Caso 13b: estoque baixado exatamente uma vez apesar de 2 chamadas (10 -> 9)';
  else
    raise exception 'FAIL - Caso 13b: estoque esperado 9, obtido % (baixou mais de uma vez?)', v_stock;
  end if;
  select count(*) into v_count from public.orders where id = current_setting('app.case13_order_id')::uuid;
  if v_count = 1 then
    raise notice 'PASS - Caso 13c: exatamente 1 linha de pedido criada';
  else
    raise exception 'FAIL - Caso 13c: esperado 1 pedido, encontrado %', v_count;
  end if;
end $$;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.create_order(
      current_setting('app.store_a_slug'), current_setting('app.case13_key')::uuid, 'Nome Diferente Agora', '+5511999990013', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 1))
    );
    raise exception 'FAIL - Caso 13d: mesma key com conteudo diferente foi aceita';
  exception
    when others then
      if sqlerrm = 'idempotency_conflict' then
        raise notice 'PASS - Caso 13d: mesma key com conteudo diferente rejeitada (idempotency_conflict)';
      else
        raise exception 'FAIL - Caso 13d: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_13;

-- ------------------------------------------------------------
-- Caso 14: cancelamento devolve estoque; segundo cancelamento não
-- devolve de novo (terminal).
-- ------------------------------------------------------------
savepoint case_14;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.create_order(
    current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente Cancelamento', '+5511999990014', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 4))
  );
  perform set_config('app.case14_order_id', v_order.id::text, true);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  perform public.order_cancel(current_setting('app.case14_order_id')::uuid);
end $$;
reset role;

do $$
declare
  v_stock integer;
  v_status text;
begin
  select stock into v_stock from public.products where id = current_setting('app.published_product_id')::uuid;
  select status into v_status from public.orders where id = current_setting('app.case14_order_id')::uuid;
  if v_stock = 10 and v_status = 'cancelled' then
    raise notice 'PASS - Caso 14a: cancelamento devolveu o estoque (volta a 10) e status = cancelled';
  else
    raise exception 'FAIL - Caso 14a: stock=%, status=%', v_stock, v_status;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    perform public.order_cancel(current_setting('app.case14_order_id')::uuid);
    raise exception 'FAIL - Caso 14b: segundo cancelamento foi aceito';
  exception
    when others then
      if sqlerrm = 'invalid_status_transition' then
        raise notice 'PASS - Caso 14b: segundo cancelamento rejeitado (terminal)';
      else
        raise exception 'FAIL - Caso 14b: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;

do $$
declare
  v_stock integer;
begin
  select stock into v_stock from public.products where id = current_setting('app.published_product_id')::uuid;
  if v_stock = 10 then
    raise notice 'PASS - Caso 14c: estoque nao foi devolvido de novo (continua 10, nao 14)';
  else
    raise exception 'FAIL - Caso 14c: estoque esperado 10, obtido % (devolvido de novo?)', v_stock;
  end if;
end $$;
rollback to savepoint case_14;

-- ------------------------------------------------------------
-- Caso 15: pedido completed não pode ser cancelado; transições
-- inválidas de status são rejeitadas (não retrocede, não pula etapa).
-- ------------------------------------------------------------
savepoint case_15;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.create_order(
    current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente Status', '+5511999990015', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 1))
  );
  perform set_config('app.case15_order_id', v_order.id::text, true);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    perform public.order_advance_status(current_setting('app.case15_order_id')::uuid, 'completed');
    raise exception 'FAIL - Caso 15a: pending->completed direto foi aceito';
  exception
    when others then
      if sqlerrm = 'invalid_status_transition' then
        raise notice 'PASS - Caso 15a: pending->completed direto rejeitado (precisa passar por confirmed/preparing/ready)';
      else
        raise exception 'FAIL - Caso 15a: erro inesperado: %', sqlerrm;
      end if;
  end;

  perform public.order_advance_status(current_setting('app.case15_order_id')::uuid, 'confirmed');
  perform public.order_advance_status(current_setting('app.case15_order_id')::uuid, 'preparing');

  begin
    perform public.order_advance_status(current_setting('app.case15_order_id')::uuid, 'pending');
    raise exception 'FAIL - Caso 15b: retroceder para pending foi aceito';
  exception
    when others then
      if sqlerrm = 'invalid_status_transition' then
        raise notice 'PASS - Caso 15b: retroceder de status (preparing->pending) rejeitado';
      else
        raise exception 'FAIL - Caso 15b: erro inesperado: %', sqlerrm;
      end if;
  end;

  perform public.order_advance_status(current_setting('app.case15_order_id')::uuid, 'ready');
  perform public.order_advance_status(current_setting('app.case15_order_id')::uuid, 'completed');

  begin
    perform public.order_cancel(current_setting('app.case15_order_id')::uuid);
    raise exception 'FAIL - Caso 15c: pedido completed foi cancelado';
  exception
    when others then
      if sqlerrm = 'invalid_status_transition' then
        raise notice 'PASS - Caso 15c: pedido completed nao pode ser cancelado (terminal)';
      else
        raise exception 'FAIL - Caso 15c: erro inesperado: %', sqlerrm;
      end if;
  end;

  begin
    perform public.order_advance_status(current_setting('app.case15_order_id')::uuid, 'ready');
    raise exception 'FAIL - Caso 15d: reabrir pedido completed foi aceito';
  exception
    when others then
      if sqlerrm = 'invalid_status_transition' then
        raise notice 'PASS - Caso 15d: pedido completed nao pode ser reaberto';
      else
        raise exception 'FAIL - Caso 15d: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_15;

-- ------------------------------------------------------------
-- Casos 16-19: Loja A x Loja B, staff sem escrita administrativa,
-- pending_payment/suspended não administram pedidos por RPC.
-- ------------------------------------------------------------
savepoint case_16_setup;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v_order public.orders;
begin
  select * into v_order from public.create_order(
    current_setting('app.store_a_slug'), gen_random_uuid(), 'Cliente Cross', '+5511999990016', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.published_product_id'), 'quantity', 1))
  );
  perform set_config('app.case16_order_id', v_order.id::text, true);
end $$;
reset role;

-- Caso 16: admin-b (Loja B) não lê pedido da Loja A (RLS).
savepoint case_16;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_b_id'))::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.orders where id = current_setting('app.case16_order_id')::uuid;
  if v_count = 0 then
    raise notice 'PASS - Caso 16: admin-b (Loja B) nao le pedido da Loja A';
  else
    raise exception 'FAIL - Caso 16: admin-b conseguiu ler pedido da Loja A';
  end if;
end $$;
reset role;
rollback to savepoint case_16;

-- Caso 17: admin-b não altera/cancela pedido da Loja A.
savepoint case_17;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_b_id'))::text, true);
do $$
begin
  begin
    perform public.order_advance_status(current_setting('app.case16_order_id')::uuid, 'confirmed');
    raise exception 'FAIL - Caso 17a: admin-b avancou status de pedido da Loja A';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 17a: admin-b negado ao avancar status de pedido da Loja A';
      else
        raise exception 'FAIL - Caso 17a: erro inesperado: %', sqlerrm;
      end if;
  end;
  begin
    perform public.order_cancel(current_setting('app.case16_order_id')::uuid);
    raise exception 'FAIL - Caso 17b: admin-b cancelou pedido da Loja A';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 17b: admin-b negado ao cancelar pedido da Loja A';
      else
        raise exception 'FAIL - Caso 17b: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_17;

-- Caso 18: staff (merchant-multi, staff em store-a) lê mas não administra.
savepoint case_18;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_multi_id'))::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.orders where id = current_setting('app.case16_order_id')::uuid;
  if v_count = 1 then
    raise notice 'PASS - Caso 18a: staff (merchant-multi) LE o pedido da propria loja';
  else
    raise exception 'FAIL - Caso 18a: staff nao conseguiu ler pedido da propria loja';
  end if;

  begin
    perform public.order_advance_status(current_setting('app.case16_order_id')::uuid, 'confirmed');
    raise exception 'FAIL - Caso 18b: staff conseguiu avancar status (deveria ser so leitura)';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 18b: staff negado ao avancar status (sem escrita administrativa)';
      else
        raise exception 'FAIL - Caso 18b: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_18;

-- Caso 19: cliente-a (autenticado sem vinculo) não lista nenhum pedido.
savepoint case_19;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.cliente_a_id'))::text, true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.orders;
  if v_count = 0 then
    raise notice 'PASS - Caso 19: autenticado sem vinculo nao ve nenhum pedido';
  else
    raise exception 'FAIL - Caso 19: autenticado sem vinculo viu % pedido(s)', v_count;
  end if;
end $$;
reset role;
rollback to savepoint case_19;

rollback to savepoint case_16_setup;

-- ------------------------------------------------------------
-- Casos 20-21: pending_payment/suspended não administram pedidos por
-- RPC mesmo com um pedido histórico real (inserido via superusuário,
-- simulando um pedido de quando a loja ainda estava active).
-- ------------------------------------------------------------
savepoint case_20_setup;
do $$
declare
  v_pending_order_id uuid;
  v_suspended_order_id uuid;
begin
  insert into public.orders (
    store_id, public_code, idempotency_key, request_fingerprint, customer_name, customer_phone,
    fulfillment_method, status, subtotal_cents, total_cents
  ) values (
    current_setting('app.pending_store_id')::uuid, 'HISTPEND1', gen_random_uuid(), 'x', 'Cliente Historico', '+5511999990020',
    'pickup', 'pending', 1000, 1000
  )
  returning id into v_pending_order_id;
  perform set_config('app.pending_order_id', v_pending_order_id::text, true);

  insert into public.orders (
    store_id, public_code, idempotency_key, request_fingerprint, customer_name, customer_phone,
    fulfillment_method, status, subtotal_cents, total_cents
  ) values (
    current_setting('app.suspended_store_id')::uuid, 'HISTSUSP1', gen_random_uuid(), 'x', 'Cliente Historico', '+5511999990021',
    'pickup', 'pending', 1000, 1000
  )
  returning id into v_suspended_order_id;
  perform set_config('app.suspended_order_id', v_suspended_order_id::text, true);
end $$;

-- Caso 20: pending_payment (merchant-pending, owner) não administra pedido próprio por RPC.
savepoint case_20;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);
do $$
begin
  begin
    perform public.order_advance_status(current_setting('app.pending_order_id')::uuid, 'confirmed');
    raise exception 'FAIL - Caso 20a: pending_payment avancou status de pedido proprio';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 20a: pending_payment negado ao avancar status (mesmo dono, mesma loja)';
      else
        raise exception 'FAIL - Caso 20a: erro inesperado: %', sqlerrm;
      end if;
  end;
  begin
    perform public.order_cancel(current_setting('app.pending_order_id')::uuid);
    raise exception 'FAIL - Caso 20b: pending_payment cancelou pedido proprio';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 20b: pending_payment negado ao cancelar pedido proprio';
      else
        raise exception 'FAIL - Caso 20b: erro inesperado: %', sqlerrm;
      end if;
  end;
  if (select count(*) from public.orders where id = current_setting('app.pending_order_id')::uuid) = 0 then
    raise notice 'PASS - Caso 20c: pending_payment tambem nao LISTA (RLS) o proprio pedido';
  else
    raise exception 'FAIL - Caso 20c: pending_payment conseguiu ler o proprio pedido via SELECT';
  end if;
end $$;
reset role;
rollback to savepoint case_20;

-- Caso 21: suspended (merchant-suspended, owner) não administra pedido próprio por RPC.
savepoint case_21;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_suspended_id'))::text, true);
do $$
begin
  begin
    perform public.order_advance_status(current_setting('app.suspended_order_id')::uuid, 'confirmed');
    raise exception 'FAIL - Caso 21a: suspended avancou status de pedido proprio';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 21a: suspended negado ao avancar status (mesmo dono, mesma loja)';
      else
        raise exception 'FAIL - Caso 21a: erro inesperado: %', sqlerrm;
      end if;
  end;
  begin
    perform public.order_cancel(current_setting('app.suspended_order_id')::uuid);
    raise exception 'FAIL - Caso 21b: suspended cancelou pedido proprio';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 21b: suspended negado ao cancelar pedido proprio';
      else
        raise exception 'FAIL - Caso 21b: erro inesperado: %', sqlerrm;
      end if;
  end;
end $$;
reset role;
rollback to savepoint case_21;

rollback to savepoint case_20_setup;

-- ------------------------------------------------------------
-- Casos 22-24: DML direto negado; auditoria não fabricável.
-- ------------------------------------------------------------
savepoint case_22;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    insert into public.orders (
      store_id, public_code, idempotency_key, request_fingerprint, customer_name, customer_phone,
      fulfillment_method, status, subtotal_cents, total_cents
    ) values (
      current_setting('app.store_a_id')::uuid, 'DMLDIRECT', gen_random_uuid(), 'x', 'x', '+5511999990022',
      'pickup', 'pending', 0, 0
    );
    raise exception 'FAIL - Caso 22: INSERT direto em orders foi aceito';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 22: INSERT direto em orders negado (permission denied)';
  end;
end $$;
reset role;
rollback to savepoint case_22;

savepoint case_23;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    insert into public.order_items (
      order_id, store_id, product_id, product_name_snapshot, unit_price_cents, quantity, line_total_cents
    ) values (
      gen_random_uuid(), current_setting('app.store_a_id')::uuid, current_setting('app.published_product_id')::uuid,
      'x', 100, 1, 100
    );
    raise exception 'FAIL - Caso 23: INSERT direto em order_items foi aceito';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 23: INSERT direto em order_items negado (permission denied)';
  end;
end $$;
reset role;
rollback to savepoint case_23;

-- Caso 24: anon não lista nenhum pedido (sem GRANT nenhum em orders/order_items).
savepoint case_24;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform count(*) from public.orders;
    raise exception 'FAIL - Caso 24: anon conseguiu consultar orders';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 24: anon negado ao consultar orders (permission denied, sem GRANT)';
  end;
end $$;
reset role;
rollback to savepoint case_24;

-- Nenhuma alteração persiste: garante execução repetível a qualquer momento.
rollback;
