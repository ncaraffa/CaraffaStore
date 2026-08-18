-- TASK-012 commit 4 — Cupons: validação, cálculo, entitlement, snapshot
-- e ciclo reserved/consumed/released. Contra Postgres real.
--
-- Uso:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/coupons_check.sql

\set ON_ERROR_STOP on
begin;

-- ============================================================
-- Fixtures: uma loja por plano, cada uma com produto publicado
-- ============================================================
do $setup$
declare v_plan text; v_uid uuid; v_ws uuid; v_store uuid; v_prod uuid;
begin
  foreach v_plan in array array['essential','growth','professional'] loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
              'cup-' || v_plan || '@test.local','x',now(),now(),now());
    insert into public.workspaces (owner_user_id, name) values (v_uid,'WS ' || v_plan) returning id into v_ws;
    insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
      values (v_ws, v_plan, 'active', now());
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');
    insert into public.stores (slug, name, status, workspace_id)
      values ('cup-' || v_plan, 'Loja ' || v_plan, 'active', v_ws) returning id into v_store;
    insert into public.store_members (store_id, user_id, role) values (v_store, v_uid, 'owner');
    -- Produto de R$100 com estoque folgado.
    insert into public.products (store_id, name, slug, price_cents, stock, status)
      values (v_store, 'Produto', 'produto', 10000, 1000, 'published') returning id into v_prod;

    perform set_config('app.' || v_plan || '_uid', v_uid::text, true);
    perform set_config('app.' || v_plan || '_store', v_store::text, true);
    perform set_config('app.' || v_plan || '_prod', v_prod::text, true);
  end loop;
end;
$setup$;

-- ============================================================
-- Caso 1: entitlement — Essencial NÃO cria cupom nem pela RPC
-- ============================================================
do $t$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.essential_uid'))::text, true);
  begin
    perform public.coupon_upsert(current_setting('app.essential_store')::uuid, null,
      'NATAL10', 'percentage', 1000);
  exception when others then
    if sqlerrm <> 'coupons_not_available' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: Essencial criou cupom'; end if;
  raise notice 'PASS - Essencial recusado na criacao de cupom (backend, nao menu escondido)';
end;
$t$;

-- ============================================================
-- Caso 2: Growth e Professional criam; código normalizado
-- ============================================================
do $t$
declare v_plan text; v_c public.coupons;
begin
  foreach v_plan in array array['growth','professional'] loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', current_setting('app.' || v_plan || '_uid'))::text, true);
    select * into v_c from public.coupon_upsert(
      current_setting('app.' || v_plan || '_store')::uuid, null, '  natal10  ', 'percentage', 1000);
    if v_c.normalized_code <> 'NATAL10' then
      raise exception 'FAIL: normalizacao (% -> %)', '  natal10  ', v_c.normalized_code;
    end if;
  end loop;
  raise notice 'PASS - Growth/Professional criam cupom; "  natal10  " normaliza para NATAL10';
end;
$t$;

-- ============================================================
-- Caso 3: mesmo código em lojas diferentes = cupons diferentes
-- ============================================================
do $t$
declare v_g uuid; v_p uuid;
begin
  select id into v_g from public.coupons where store_id = current_setting('app.growth_store')::uuid;
  select id into v_p from public.coupons where store_id = current_setting('app.professional_store')::uuid;
  if v_g = v_p then raise exception 'FAIL: NATAL10 compartilhado entre lojas'; end if;
  raise notice 'PASS - NATAL10 da loja A e NATAL10 da loja B sao cupons independentes';
end;
$t$;

-- ============================================================
-- Caso 4: percentual, valor fixo, teto e arredondamento
-- ============================================================
do $t$
declare v integer;
begin
  -- 10% de R$250 = R$25
  if public.coupon_discount_for('percentage', 1000, null, 25000) <> 2500 then
    raise exception 'FAIL: 10%% de 25000';
  end if;
  -- 20% de R$1.000 = R$200, com teto de R$50 -> R$50
  if public.coupon_discount_for('percentage', 2000, 5000, 100000) <> 5000 then
    raise exception 'FAIL: teto de desconto';
  end if;
  -- fixo R$20
  if public.coupon_discount_for('fixed_amount', 2000, null, 15000) <> 2000 then
    raise exception 'FAIL: valor fixo';
  end if;
  -- fração de centavo: 10% de 1999 = 199,9 -> 199 (floor, deterministico)
  v := public.coupon_discount_for('percentage', 1000, null, 1999);
  if v <> 199 then raise exception 'FAIL: arredondamento 1999 -> % (esperado 199)', v; end if;
  -- desconto fixo maior que o subtotal nunca passa do subtotal
  if public.coupon_discount_for('fixed_amount', 2000, null, 1500) <> 1500 then
    raise exception 'FAIL: desconto fixo maior que subtotal';
  end if;
  raise notice 'PASS - percentual, fixo, teto, floor de fracao de centavo e limite do subtotal';
end;
$t$;

-- ============================================================
-- Caso 5: matriz de validação
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.growth_store')::uuid;
  v_uid uuid := current_setting('app.growth_uid')::uuid;
  v_id uuid;
  r record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  select id into v_id from public.coupons where store_id = v_store;

  -- case-insensitive + whitespace
  select * into r from public.coupon_validate(v_store, '  natal10 ', 20000);
  if not r.valid or r.discount_cents <> 2000 then raise exception 'FAIL: case/whitespace'; end if;

  -- inexistente
  select * into r from public.coupon_validate(v_store, 'NAOEXISTE', 20000);
  if r.valid or r.reason <> 'coupon_not_found' then raise exception 'FAIL: inexistente'; end if;

  -- inativo
  perform public.coupon_upsert(v_store, v_id, 'NATAL10', 'percentage', 1000, null, null, null, null, null, false);
  select * into r from public.coupon_validate(v_store, 'NATAL10', 20000);
  if r.valid or r.reason <> 'coupon_inactive' then raise exception 'FAIL: inativo -> %', r.reason; end if;

  -- ainda nao iniciado
  perform public.coupon_upsert(v_store, v_id, 'NATAL10', 'percentage', 1000, null, null,
    now() + interval '2 days', now() + interval '5 days', null, true);
  select * into r from public.coupon_validate(v_store, 'NATAL10', 20000);
  if r.valid or r.reason <> 'coupon_not_started' then raise exception 'FAIL: nao iniciado -> %', r.reason; end if;

  -- expirado
  perform public.coupon_upsert(v_store, v_id, 'NATAL10', 'percentage', 1000, null, null,
    now() - interval '5 days', now() - interval '1 day', null, true);
  select * into r from public.coupon_validate(v_store, 'NATAL10', 20000);
  if r.valid or r.reason <> 'coupon_expired' then raise exception 'FAIL: expirado -> %', r.reason; end if;

  -- pedido minimo
  perform public.coupon_upsert(v_store, v_id, 'NATAL10', 'percentage', 1000, 30000, null, null, null, null, true);
  select * into r from public.coupon_validate(v_store, 'NATAL10', 20000);
  if r.valid or r.reason <> 'coupon_minimum_not_met' then raise exception 'FAIL: minimo -> %', r.reason; end if;
  select * into r from public.coupon_validate(v_store, 'NATAL10', 30000);
  if not r.valid then raise exception 'FAIL: minimo atingido deveria valer'; end if;

  -- desconto que zeraria o total: recusado explicitamente (nao criamos Pix de R$0)
  perform public.coupon_upsert(v_store, null, 'TUDO', 'fixed_amount', 100000, null, null, null, null, null, true);
  select * into r from public.coupon_validate(v_store, 'TUDO', 10000);
  if r.valid or r.reason <> 'coupon_would_zero_total' then
    raise exception 'FAIL: total zero deveria ser recusado -> %', r.reason;
  end if;

  -- devolve NATAL10 ao estado neutro para os casos seguintes
  perform public.coupon_upsert(v_store, v_id, 'NATAL10', 'percentage', 1000, null, null, null, null, null, true);

  raise notice 'PASS - matriz de validacao (case, whitespace, inexistente, inativo, janela, minimo, total zero)';
end;
$t$;

-- ============================================================
-- Caso 6: cross-tenant — código da loja B não vale na loja A
-- ============================================================
do $t$
declare r record;
begin
  -- PROMOB existe só na loja professional
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.professional_uid'))::text, true);
  perform public.coupon_upsert(current_setting('app.professional_store')::uuid, null,
    'PROMOB', 'fixed_amount', 1000);

  select * into r from public.coupon_validate(current_setting('app.growth_store')::uuid, 'PROMOB', 20000);
  if r.valid or r.reason <> 'coupon_not_found' then
    raise exception 'FAIL: cupom de outra loja aceito -> %', r.reason;
  end if;
  raise notice 'PASS - cupom de outra loja responde coupon_not_found (sem vazar existencia)';
end;
$t$;

-- ============================================================
-- Caso 7: checkout — snapshot financeiro e reserva
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.growth_store')::uuid;
  v_uid uuid := current_setting('app.growth_uid')::uuid;
  v_prod uuid := current_setting('app.growth_prod')::uuid;
  v_id uuid;
  v_order public.orders;
  v_red public.coupon_redemptions;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  select id into v_id from public.coupons where store_id = v_store and normalized_code = 'NATAL10';
  select c.id into v_id from public.coupon_upsert(
    v_store, v_id, 'NATAL10', 'percentage', 1000, null, null, null, null, 200, true) c;

  -- carrinho de R$200 (2 x R$100) + NATAL10 10%
  select * into v_order from public.create_order(
    'cup-growth', gen_random_uuid(), 'Cliente', '11999998888', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2)),
    'natal10');

  if v_order.subtotal_cents <> 20000 then raise exception 'FAIL: subtotal % (esperado 20000)', v_order.subtotal_cents; end if;
  if v_order.discount_cents <> 2000 then raise exception 'FAIL: desconto % (esperado 2000)', v_order.discount_cents; end if;
  if v_order.total_cents <> 18000 then raise exception 'FAIL: total % (esperado 18000)', v_order.total_cents; end if;
  if v_order.coupon_code_snapshot is null then raise exception 'FAIL: snapshot do codigo ausente'; end if;
  if v_order.coupon_discount_value_snapshot <> 1000 then raise exception 'FAIL: snapshot do valor'; end if;

  select * into v_red from public.coupon_redemptions where order_id = v_order.id;
  if v_red.status <> 'reserved' then raise exception 'FAIL: resgate nao reservado (%)', v_red.status; end if;
  if public.coupon_used_count(v_id) <> 1 then raise exception 'FAIL: contagem de uso'; end if;

  perform set_config('app.order_id', v_order.id::text, true);
  perform set_config('app.coupon_id', v_id::text, true);
  raise notice 'PASS - checkout: subtotal 20000, desconto 2000, total 18000, resgate RESERVADO';
end;
$t$;

-- ============================================================
-- Caso 8: consume no pagamento + idempotência de replay
-- ============================================================
do $t$
declare
  v_order uuid := current_setting('app.order_id')::uuid;
  v_id uuid := current_setting('app.coupon_id')::uuid;
  v_status text;
begin
  -- confirma o pedido (é o que o webhook aprovado faz)
  update public.orders set status = 'confirmed' where id = v_order;
  select status into v_status from public.coupon_redemptions where order_id = v_order;
  if v_status <> 'consumed' then raise exception 'FAIL: nao consumiu (%)', v_status; end if;
  if public.coupon_used_count(v_id) <> 1 then raise exception 'FAIL: contagem apos consumo'; end if;

  -- REPLAY do webhook: mesma transicao de novo
  update public.orders set status = 'confirmed' where id = v_order;
  update public.orders set status = 'preparing' where id = v_order;
  if public.coupon_used_count(v_id) <> 1 then
    raise exception 'FAIL: replay consumiu duas vezes (%)', public.coupon_used_count(v_id);
  end if;
  if (select count(*) from public.coupon_redemptions where order_id = v_order) <> 1 then
    raise exception 'FAIL: replay criou segundo resgate';
  end if;
  raise notice 'PASS - pagamento consome uma vez; replay de webhook/reconciliacao nao consome de novo';
end;
$t$;

-- ============================================================
-- Caso 9: release ao cancelar antes do pagamento
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.growth_store')::uuid;
  v_prod uuid := current_setting('app.growth_prod')::uuid;
  v_id uuid := current_setting('app.coupon_id')::uuid;
  v_order public.orders;
  v_before integer;
  v_status text;
begin
  v_before := public.coupon_used_count(v_id);

  select * into v_order from public.create_order(
    'cup-growth', gen_random_uuid(), 'Cliente 2', '11999997777', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
    'NATAL10');
  if public.coupon_used_count(v_id) <> v_before + 1 then raise exception 'FAIL: reserva nao contou'; end if;

  update public.orders set status = 'cancelled' where id = v_order.id;
  select status into v_status from public.coupon_redemptions where order_id = v_order.id;
  if v_status <> 'released' then raise exception 'FAIL: nao liberou (%)', v_status; end if;
  if public.coupon_used_count(v_id) <> v_before then
    raise exception 'FAIL: vaga nao voltou (% vs %)', public.coupon_used_count(v_id), v_before;
  end if;

  -- release repetido é inerte
  update public.orders set status = 'cancelled' where id = v_order.id;
  if public.coupon_used_count(v_id) <> v_before then raise exception 'FAIL: release duplo alterou contagem'; end if;
  raise notice 'PASS - cancelamento libera a vaga; release repetido e inerte';
end;
$t$;

-- ============================================================
-- Caso 10: resgate consumido NÃO volta ao cancelar
-- ============================================================
do $t$
declare
  v_order uuid := current_setting('app.order_id')::uuid;
  v_id uuid := current_setting('app.coupon_id')::uuid;
  v_status text;
begin
  update public.orders set status = 'cancelled' where id = v_order;
  select status into v_status from public.coupon_redemptions where order_id = v_order;
  if v_status <> 'consumed' then
    raise exception 'FAIL: resgate ja pago voltou para % (reabriria promocao paga)', v_status;
  end if;
  raise notice 'PASS - resgate ja consumido nao e liberado por cancelamento posterior';
end;
$t$;

-- ============================================================
-- Caso 11: limite de utilizações
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.growth_store')::uuid;
  v_uid uuid := current_setting('app.growth_uid')::uuid;
  v_prod uuid := current_setting('app.growth_prod')::uuid;
  v_id uuid;
  v_ok boolean := false;
  r record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  select id into v_id from public.coupons where store_id = v_store and normalized_code = 'NATAL10';

  -- limita ao que ja foi usado: proxima tentativa tem que ser recusada
  perform public.coupon_upsert(v_store, v_id, 'NATAL10', 'percentage', 1000, null, null, null, null,
    public.coupon_used_count(v_id), true);

  select * into r from public.coupon_validate(v_store, 'NATAL10', 20000);
  if r.valid or r.reason <> 'coupon_usage_limit_reached' then
    raise exception 'FAIL: limite nao barrou -> %', r.reason;
  end if;

  begin
    perform public.create_order('cup-growth', gen_random_uuid(), 'Cliente 3', '11999996666', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), 'NATAL10');
  exception when others then
    if sqlerrm <> 'coupon_usage_limit_reached' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: checkout aceitou cupom esgotado'; end if;

  -- max_uses NULL = ilimitado
  perform public.coupon_upsert(v_store, v_id, 'NATAL10', 'percentage', 1000, null, null, null, null, null, true);
  select * into r from public.coupon_validate(v_store, 'NATAL10', 20000);
  if not r.valid then raise exception 'FAIL: max_uses NULL deveria ser ilimitado -> %', r.reason; end if;
  raise notice 'PASS - limite de usos barra validacao E checkout; max_uses NULL e ilimitado';
end;
$t$;

-- ============================================================
-- Caso 12: snapshot imune a edição posterior do cupom
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.growth_store')::uuid;
  v_uid uuid := current_setting('app.growth_uid')::uuid;
  v_order uuid := current_setting('app.order_id')::uuid;
  v_id uuid := current_setting('app.coupon_id')::uuid;
  o public.orders;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  -- lojista muda NATAL10 de 10% para 15% DEPOIS do pedido
  perform public.coupon_upsert(v_store, v_id, 'NATAL10', 'percentage', 1500, null, null, null, null, null, true);

  select * into o from public.orders where id = v_order;
  if o.discount_cents <> 2000 or o.total_cents <> 18000 then
    raise exception 'FAIL: pedido historico mudou (% / %)', o.discount_cents, o.total_cents;
  end if;
  if o.coupon_discount_value_snapshot <> 1000 then
    raise exception 'FAIL: snapshot do percentual mudou para %', o.coupon_discount_value_snapshot;
  end if;
  raise notice 'PASS - editar NATAL10 para 15%% nao altera o pedido antigo (10%%, R$180)';
end;
$t$;

-- ============================================================
-- Caso 13: Essencial não aplica cupom no checkout
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.essential_store')::uuid;
  v_prod uuid := current_setting('app.essential_prod')::uuid;
  v_ok boolean := false;
  r record;
begin
  -- injeta um cupom direto na tabela (simula downgrade: cupom preexistente)
  insert into public.coupons (store_id, code, normalized_code, discount_type, discount_value)
    values (v_store, 'ANTIGO', 'ANTIGO', 'percentage', 1000);

  select * into r from public.coupon_validate(v_store, 'ANTIGO', 20000);
  if r.valid or r.reason <> 'coupons_not_available' then
    raise exception 'FAIL: Essencial validou cupom -> %', r.reason;
  end if;

  begin
    perform public.create_order('cup-essential', gen_random_uuid(), 'Cliente E', '11999995555', 'pickup', null, null,
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)), 'ANTIGO');
  exception when others then
    if sqlerrm <> 'coupons_not_available' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: Essencial aplicou cupom no checkout'; end if;

  -- downgrade preserva o cupom no banco (nao apaga)
  if not exists (select 1 from public.coupons where store_id = v_store and normalized_code = 'ANTIGO') then
    raise exception 'FAIL: cupom foi apagado no Essencial';
  end if;
  raise notice 'PASS - Essencial: cupom preservado no banco, mas nao aplicavel no checkout';
end;
$t$;

-- ============================================================
-- Caso 14: pedido sem cupom continua coerente
-- ============================================================
do $t$
declare
  v_prod uuid := current_setting('app.growth_prod')::uuid;
  v_order public.orders;
begin
  select * into v_order from public.create_order(
    'cup-growth', gen_random_uuid(), 'Sem cupom', '11999994444', 'pickup', null, null,
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 3)), null);
  if v_order.discount_cents <> 0 then raise exception 'FAIL: desconto sem cupom'; end if;
  if v_order.total_cents <> v_order.subtotal_cents then raise exception 'FAIL: total <> subtotal sem cupom'; end if;
  if exists (select 1 from public.coupon_redemptions where order_id = v_order.id) then
    raise exception 'FAIL: criou resgate sem cupom';
  end if;
  raise notice 'PASS - pedido sem cupom: desconto 0, total = subtotal, nenhum resgate';
end;
$t$;

do $t$ begin raise notice 'OK: TODOS os casos de cupom passaram'; end; $t$;

rollback;
