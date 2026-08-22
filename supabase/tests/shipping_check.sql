-- TASK-013 — Frete por CEP: faixas, acréscimo, frete grátis, snapshot no
-- pedido, autorização e resistência a payload adulterado. Contra
-- Postgres real.
--
-- Uso:
--   docker exec -i supabase_db_commerce-platform-local \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
--     < supabase/tests/shipping_check.sql
--
-- Ou, com psql local:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/shipping_check.sql
--
-- Tudo roda dentro de uma transação com ROLLBACK no fim: não deixa
-- nenhuma linha para trás, nem no banco local.

\set ON_ERROR_STOP on
begin;

-- ============================================================
-- Fixtures
-- ============================================================
--
-- Duas lojas:
--   frete-on  -> Corumbá/MS, entrega configurada
--   frete-off -> sem configuração nenhuma (caminho legado)
--
-- Produto de R$10,00 nas duas, estoque folgado — assim qualquer subtotal
-- múltiplo de R$10 sai de uma quantidade inteira.

do $setup$
declare
  v_uid uuid;
  v_ws uuid;
  v_store uuid;
  v_prod uuid;
  v_slug text;
begin
  foreach v_slug in array array['frete-on', 'frete-off'] loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'ship-' || v_slug || '@test.local', 'x', now(), now(), now());
    insert into public.workspaces (owner_user_id, name) values (v_uid, 'WS ' || v_slug) returning id into v_ws;
    insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
      values (v_ws, 'growth', 'active', now());
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');
    insert into public.stores (slug, name, status, workspace_id)
      values (v_slug, 'Loja ' || v_slug, 'active', v_ws) returning id into v_store;
    insert into public.store_members (store_id, user_id, role) values (v_store, v_uid, 'owner');
    insert into public.products (store_id, name, slug, price_cents, stock, status)
      values (v_store, 'Produto', 'produto', 1000, 10000, 'published') returning id into v_prod;

    perform set_config('app.' || replace(v_slug, '-', '_') || '_uid', v_uid::text, true);
    perform set_config('app.' || replace(v_slug, '-', '_') || '_store', v_store::text, true);
    perform set_config('app.' || replace(v_slug, '-', '_') || '_prod', v_prod::text, true);
  end loop;

  -- Um staff na loja com frete, para provar que staff não configura.
  v_uid := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'ship-staff@test.local', 'x', now(), now(), now());
  insert into public.store_members (store_id, user_id, role)
    values (current_setting('app.frete_on_store')::uuid, v_uid, 'staff');
  perform set_config('app.staff_uid', v_uid::text, true);

  -- E um estranho, sem vínculo nenhum.
  v_uid := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'ship-outsider@test.local', 'x', now(), now(), now());
  perform set_config('app.outsider_uid', v_uid::text, true);

  -- CEPs que o SERVIDOR ja resolveu. Em producao quem escreve aqui e
  -- lib/shipping/service-only/postal-code-store.ts, depois de uma
  -- resposta real do ViaCEP; no teste plantamos o mesmo resultado.
  -- 01310100 (Sao Paulo/SP) fica de fora de proposito num dos casos.
  perform public.shipping_postal_code_upsert('79330000', 'Corumbá', 'MS');
  perform public.shipping_postal_code_upsert('79002000', 'Campo Grande', 'MS');
  perform public.shipping_postal_code_upsert('78005000', 'Cuiabá', 'MT');
  perform public.shipping_postal_code_upsert('01310100', 'São Paulo', 'SP');
end;
$setup$;

-- ============================================================
-- Caso 1: só owner/admin configura frete
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.frete_on_store')::uuid;
  v_denied integer := 0;
begin
  foreach v_store in array array[v_store] loop null; end loop; -- no-op, mantém a variável usada

  -- staff
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.staff_uid'))::text, true);
  begin
    perform public.shipping_settings_upsert(
      current_setting('app.frete_on_store')::uuid, true, '79330000', 'Corumbá', 'MS',
      1000, 2000, 3500, 500, false, null);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_denied := v_denied + 1;
  end;

  -- estranho
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.outsider_uid'))::text, true);
  begin
    perform public.shipping_settings_upsert(
      current_setting('app.frete_on_store')::uuid, true, '79330000', 'Corumbá', 'MS',
      1000, 2000, 3500, 500, false, null);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_denied := v_denied + 1;
  end;

  if v_denied <> 2 then
    raise exception 'FAIL: staff/estranho conseguiram configurar frete (% recusas de 2)', v_denied;
  end if;
  raise notice 'PASS - staff e nao-membro sao recusados por shipping_settings_upsert';
end;
$t$;

-- ============================================================
-- Caso 2: entrega ligada sem CEP de origem é recusada
-- ============================================================
do $t$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.frete_on_uid'))::text, true);
  begin
    perform public.shipping_settings_upsert(
      current_setting('app.frete_on_store')::uuid, true, null, null, null, 1000, 2000, 3500, 0, false, null);
  exception when others then
    if sqlerrm <> 'origin_required' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: entrega ligada sem origem foi aceita'; end if;

  -- frete grátis ligado sem mínimo também não passa
  v_ok := false;
  begin
    perform public.shipping_settings_upsert(
      current_setting('app.frete_on_store')::uuid, true, '79330000', 'Corumbá', 'MS',
      1000, 2000, 3500, 0, true, null);
  exception when others then
    if sqlerrm <> 'invalid_free_shipping_minimum' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: frete gratis sem minimo foi aceito'; end if;

  -- valor negativo também não
  v_ok := false;
  begin
    perform public.shipping_settings_upsert(
      current_setting('app.frete_on_store')::uuid, true, '79330000', 'Corumbá', 'MS',
      -100, 2000, 3500, 0, false, null);
  exception when others then
    if sqlerrm <> 'invalid_shipping_fee' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: valor negativo de frete foi aceito'; end if;

  raise notice 'PASS - origem ausente, minimo invalido e valor negativo sao recusados';
end;
$t$;

-- ============================================================
-- Caso 3: configuração válida, e o CEP é guardado só com dígitos
-- ============================================================
do $t$
declare v_row public.store_shipping_settings;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.frete_on_uid'))::text, true);
  select * into v_row from public.shipping_settings_upsert(
    current_setting('app.frete_on_store')::uuid, true, '79330-000', ' Corumbá ', 'ms',
    1000, 2000, 3500, 500, false, null);

  if v_row.origin_postal_code <> '79330000' then
    raise exception 'FAIL: CEP nao normalizado (%)', v_row.origin_postal_code;
  end if;
  if v_row.origin_state <> 'MS' then raise exception 'FAIL: UF nao normalizada (%)', v_row.origin_state; end if;
  if v_row.origin_city <> 'Corumbá' then raise exception 'FAIL: cidade nao aparada (%)', v_row.origin_city; end if;
  raise notice 'PASS - configuracao salva: CEP so digitos, UF maiuscula, cidade aparada';
end;
$t$;

-- ============================================================
-- Caso 4: as três faixas — mesma cidade, mesmo estado, outro estado
-- ============================================================
--
-- Loja em Corumbá/MS: same_city 1000, same_state 2000, other_state 3500,
-- acréscimo 500. Cada faixa soma o acréscimo.
do $t$
declare v_fee record;
begin
  select * into v_fee from public.shipping_fee_for(
    'Corumbá', 'MS', 'Corumbá', 'MS', 1000, 2000, 3500, 500, false, null, 5000);
  if v_fee.rule <> 'same_city' or v_fee.shipping_cents <> 1500 then
    raise exception 'FAIL: mesma cidade -> % / % (esperado same_city / 1500)', v_fee.rule, v_fee.shipping_cents;
  end if;

  select * into v_fee from public.shipping_fee_for(
    'Corumbá', 'MS', 'Campo Grande', 'MS', 1000, 2000, 3500, 500, false, null, 5000);
  if v_fee.rule <> 'same_state' or v_fee.shipping_cents <> 2500 then
    raise exception 'FAIL: mesmo estado -> % / % (esperado same_state / 2500)', v_fee.rule, v_fee.shipping_cents;
  end if;

  select * into v_fee from public.shipping_fee_for(
    'Corumbá', 'MS', 'Cuiabá', 'MT', 1000, 2000, 3500, 500, false, null, 5000);
  if v_fee.rule <> 'other_state' or v_fee.shipping_cents <> 4000 then
    raise exception 'FAIL: outro estado -> % / % (esperado other_state / 4000)', v_fee.rule, v_fee.shipping_cents;
  end if;

  raise notice 'PASS - faixas: same_city 1500, same_state 2500, other_state 4000 (acrescimo somado)';
end;
$t$;

-- ============================================================
-- Caso 5: acento e caixa não mudam a faixa
-- ============================================================
--
-- Uma cidade grafada "CORUMBA" pelo ViaCEP e "Corumbá" pelo lojista não
-- pode virar frete interestadual.
do $t$
declare v_fee record;
begin
  select * into v_fee from public.shipping_fee_for(
    'Corumbá', 'MS', 'CORUMBA', 'ms', 1000, 2000, 3500, 500, false, null, 5000);
  if v_fee.rule <> 'same_city' then
    raise exception 'FAIL: CORUMBA vs Corumba caiu em % (esperado same_city)', v_fee.rule;
  end if;

  select * into v_fee from public.shipping_fee_for(
    'São Paulo', 'SP', '  sao   paulo  ', 'SP', 1000, 2000, 3500, 0, false, null, 5000);
  if v_fee.rule <> 'same_city' then
    raise exception 'FAIL: espacos/acentos em Sao Paulo cairam em % (esperado same_city)', v_fee.rule;
  end if;

  raise notice 'PASS - normalizacao: acento, caixa e espacos nao mudam a faixa';
end;
$t$;

-- ============================================================
-- Caso 6: frete grátis zera TUDO, inclusive o acréscimo
-- ============================================================
do $t$
declare v_fee record;
begin
  -- atingiu o mínimo de R$200
  select * into v_fee from public.shipping_fee_for(
    'Corumbá', 'MS', 'Cuiabá', 'MT', 1000, 2000, 3500, 500, true, 20000, 20000);
  if v_fee.rule <> 'free' or v_fee.shipping_cents <> 0 then
    raise exception 'FAIL: minimo atingido -> % / % (esperado free / 0)', v_fee.rule, v_fee.shipping_cents;
  end if;

  -- não atingiu: volta à faixa normal, com acréscimo
  select * into v_fee from public.shipping_fee_for(
    'Corumbá', 'MS', 'Cuiabá', 'MT', 1000, 2000, 3500, 500, true, 20000, 19999);
  if v_fee.rule <> 'other_state' or v_fee.shipping_cents <> 4000 then
    raise exception 'FAIL: minimo nao atingido -> % / % (esperado other_state / 4000)', v_fee.rule, v_fee.shipping_cents;
  end if;

  raise notice 'PASS - frete gratis = 0 exato (acrescimo NAO cobrado); 1 centavo abaixo volta a cobrar';
end;
$t$;

-- ============================================================
-- Caso 7: pedido real — as três faixas gravadas em orders
-- ============================================================
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_order public.orders;
begin
  perform set_config('request.jwt.claims', null, true);

  -- 10 unidades de R$10 = R$100 de produtos, destino mesma cidade
  select * into v_order from public.create_order(
    p_store_slug => 'frete-on',
    p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Cliente Corumbá',
    p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery',
    p_delivery_address => null,
    p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 10)),
    p_coupon_code => null,
    p_shipping_postal_code => '79330-000',
    p_shipping_street => 'Rua Delamare',
    p_shipping_number => '123',
    p_shipping_complement => 'Apto 10',
    p_shipping_neighborhood => 'Centro');

  if v_order.subtotal_cents <> 10000 then raise exception 'FAIL: subtotal %', v_order.subtotal_cents; end if;
  if v_order.shipping_rule <> 'same_city' then raise exception 'FAIL: faixa % (esperado same_city)', v_order.shipping_rule; end if;
  if v_order.shipping_amount_cents <> 1500 then raise exception 'FAIL: frete % (esperado 1500)', v_order.shipping_amount_cents; end if;
  if v_order.total_cents <> 11500 then raise exception 'FAIL: total % (esperado 11500)', v_order.total_cents; end if;
  if v_order.shipping_postal_code <> '79330000' then raise exception 'FAIL: CEP do pedido %', v_order.shipping_postal_code; end if;
  if v_order.shipping_state <> 'MS' then raise exception 'FAIL: UF do pedido %', v_order.shipping_state; end if;
  if v_order.shipping_origin_city <> 'Corumbá' then raise exception 'FAIL: origem do pedido %', v_order.shipping_origin_city; end if;
  if v_order.delivery_address is null or v_order.delivery_address not like '%Rua Delamare, 123%' then
    raise exception 'FAIL: delivery_address nao derivado (%)', v_order.delivery_address;
  end if;
  perform set_config('app.order_same_city', v_order.id::text, true);

  -- mesmo estado
  select * into v_order from public.create_order(
    p_store_slug => 'frete-on',
    p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Cliente Campo Grande',
    p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery',
    p_delivery_address => null,
    p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 10)),
    p_coupon_code => null,
    p_shipping_postal_code => '79002000',
    p_shipping_street => 'Rua 14 de Julho',
    p_shipping_number => '500',
    p_shipping_complement => null,
    p_shipping_neighborhood => 'Centro');
  if v_order.shipping_rule <> 'same_state' or v_order.shipping_amount_cents <> 2500 then
    raise exception 'FAIL: mesmo estado -> % / %', v_order.shipping_rule, v_order.shipping_amount_cents;
  end if;
  if v_order.total_cents <> 12500 then raise exception 'FAIL: total mesmo estado %', v_order.total_cents; end if;

  -- outro estado
  select * into v_order from public.create_order(
    p_store_slug => 'frete-on',
    p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Cliente Cuiabá',
    p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery',
    p_delivery_address => null,
    p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 10)),
    p_coupon_code => null,
    p_shipping_postal_code => '78005000',
    p_shipping_street => 'Av. Getúlio Vargas',
    p_shipping_number => '10',
    p_shipping_complement => null,
    p_shipping_neighborhood => 'Centro');
  if v_order.shipping_rule <> 'other_state' or v_order.shipping_amount_cents <> 4000 then
    raise exception 'FAIL: outro estado -> % / %', v_order.shipping_rule, v_order.shipping_amount_cents;
  end if;
  if v_order.total_cents <> 14000 then raise exception 'FAIL: total outro estado %', v_order.total_cents; end if;

  raise notice 'PASS - pedidos reais gravam faixa, frete e total corretos nas tres faixas';
end;
$t$;

-- ============================================================
-- Caso 8: frete grátis dentro do pedido, medido DEPOIS do cupom
-- ============================================================
--
-- Regra da especificação: o mínimo compara o subtotal já descontado.
--   Produtos R$220, cupom -R$30 -> R$190 < R$200 -> NÃO ganha.
--   Produtos R$220, sem cupom   -> R$220 >= R$200 -> ganha.
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_store uuid := current_setting('app.frete_on_store')::uuid;
  v_order public.orders;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.frete_on_uid'))::text, true);
  perform public.shipping_settings_upsert(v_store, true, '79330000', 'Corumbá', 'MS',
    1000, 2000, 3500, 500, true, 20000);
  perform public.coupon_upsert(v_store, null, 'FRETE30', 'fixed_amount', 3000);

  perform set_config('request.jwt.claims', null, true);

  -- R$220 com cupom de R$30 -> R$190 -> NÃO ganha frete grátis
  select * into v_order from public.create_order(
    p_store_slug => 'frete-on',
    p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Cliente Quase',
    p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery',
    p_delivery_address => null,
    p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 22)),
    p_coupon_code => 'frete30',
    p_shipping_postal_code => '79330000',
    p_shipping_street => 'Rua Delamare',
    p_shipping_number => '1',
    p_shipping_complement => null,
    p_shipping_neighborhood => 'Centro');

  if v_order.subtotal_cents <> 22000 then raise exception 'FAIL: subtotal %', v_order.subtotal_cents; end if;
  if v_order.discount_cents <> 3000 then raise exception 'FAIL: desconto %', v_order.discount_cents; end if;
  if v_order.shipping_rule <> 'same_city' or v_order.shipping_amount_cents <> 1500 then
    raise exception 'FAIL: com cupom deveria pagar frete normal -> % / %', v_order.shipping_rule, v_order.shipping_amount_cents;
  end if;
  -- 22000 - 3000 + 1500
  if v_order.total_cents <> 20500 then raise exception 'FAIL: total % (esperado 20500)', v_order.total_cents; end if;

  -- R$220 sem cupom -> ganha frete grátis, e o acréscimo não é cobrado
  select * into v_order from public.create_order(
    p_store_slug => 'frete-on',
    p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Cliente Gratis',
    p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery',
    p_delivery_address => null,
    p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 22)),
    p_coupon_code => null,
    p_shipping_postal_code => '79330000',
    p_shipping_street => 'Rua Delamare',
    p_shipping_number => '1',
    p_shipping_complement => null,
    p_shipping_neighborhood => 'Centro');

  if v_order.shipping_rule <> 'free' or v_order.shipping_amount_cents <> 0 then
    raise exception 'FAIL: sem cupom deveria ser gratis -> % / %', v_order.shipping_rule, v_order.shipping_amount_cents;
  end if;
  if v_order.total_cents <> 22000 then raise exception 'FAIL: total gratis % (esperado 22000)', v_order.total_cents; end if;

  raise notice 'PASS - frete gratis medido apos o cupom: R$190 paga frete, R$220 nao paga';
end;
$t$;

-- ============================================================
-- Caso 9: a prévia da tela bate com o pedido, centavo a centavo
-- ============================================================
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_quote record;
  v_order public.orders;
  v_key uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', null, true);

  select * into v_quote from public.shipping_quote(
    'frete-on',
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 15)),
    'FRETE30', '79002-000');

  if not v_quote.available then raise exception 'FAIL: previa indisponivel (%)', v_quote.reason; end if;
  if v_quote.rule <> 'same_state' then raise exception 'FAIL: previa faixa %', v_quote.rule; end if;

  select * into v_order from public.create_order(
    p_store_slug => 'frete-on',
    p_idempotency_key => v_key,
    p_customer_name => 'Cliente Previa',
    p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery',
    p_delivery_address => null,
    p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 15)),
    p_coupon_code => 'FRETE30',
    p_shipping_postal_code => '79002-000',
    p_shipping_street => 'Rua 14 de Julho',
    p_shipping_number => '500',
    p_shipping_complement => null,
    p_shipping_neighborhood => 'Centro');

  if v_quote.subtotal_cents <> v_order.subtotal_cents then
    raise exception 'FAIL: subtotal previa % vs pedido %', v_quote.subtotal_cents, v_order.subtotal_cents;
  end if;
  if v_quote.discount_cents <> v_order.discount_cents then
    raise exception 'FAIL: desconto previa % vs pedido %', v_quote.discount_cents, v_order.discount_cents;
  end if;
  if v_quote.shipping_cents <> v_order.shipping_amount_cents then
    raise exception 'FAIL: frete previa % vs pedido %', v_quote.shipping_cents, v_order.shipping_amount_cents;
  end if;
  if v_quote.total_cents <> v_order.total_cents then
    raise exception 'FAIL: total previa % vs pedido %', v_quote.total_cents, v_order.total_cents;
  end if;

  raise notice 'PASS - previa (shipping_quote) e pedido (create_order) dao exatamente o mesmo total';
end;
$t$;

-- ============================================================
-- Caso 10: payload adulterado não muda o frete
-- ============================================================
--
-- O valor do frete não é parâmetro de create_order, então não existe
-- campo para o cliente forjar. O que dá para tentar é mentir no
-- subtotal enviado à prévia — e a prévia ignora, porque recalcula de
-- products. Aqui provamos as duas coisas.
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_quote record;
  v_count integer;
begin
  perform set_config('request.jwt.claims', null, true);

  -- shipping_quote não aceita subtotal do cliente: nem existe parâmetro.
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'shipping_quote'
    and 'p_subtotal_cents' = any (p.proargnames);
  if v_count <> 0 then raise exception 'FAIL: shipping_quote aceita subtotal do cliente'; end if;

  -- create_order não aceita valor de frete: nem existe parâmetro.
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_order'
    and (
      'p_shipping_amount_cents' = any (p.proargnames)
      or 'p_shipping_cents' = any (p.proargnames)
      or 'p_total_cents' = any (p.proargnames)
      or 'p_discount_cents' = any (p.proargnames)
    );
  if v_count <> 0 then raise exception 'FAIL: create_order aceita valor financeiro do cliente'; end if;

  -- E um carrinho com produto de outra loja não vira frete de graça:
  -- a prévia recusa antes de calcular.
  select * into v_quote from public.shipping_quote(
    'frete-on',
    jsonb_build_array(jsonb_build_object('product_id', current_setting('app.frete_off_prod')::uuid, 'quantity', 1)),
    null, '79330000');
  if v_quote.available or v_quote.reason <> 'product_not_found' then
    raise exception 'FAIL: previa aceitou produto de outra loja (% / %)', v_quote.available, v_quote.reason;
  end if;

  raise notice 'PASS - nenhum valor financeiro entra pelo cliente (nem frete, nem subtotal, nem total)';
end;
$t$;

-- ============================================================
-- Caso 11: pedido antigo não muda quando a configuração muda
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.frete_on_store')::uuid;
  v_order_id uuid := current_setting('app.order_same_city')::uuid;
  v_before integer;
  v_after integer;
  v_rule text;
begin
  select shipping_amount_cents into v_before from public.orders where id = v_order_id;
  if v_before <> 1500 then raise exception 'FAIL: frete inicial % (esperado 1500)', v_before; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.frete_on_uid'))::text, true);
  perform public.shipping_settings_upsert(v_store, true, '79330000', 'Corumbá', 'MS',
    3000, 9000, 9900, 0, false, null);

  select shipping_amount_cents, shipping_rule into v_after, v_rule from public.orders where id = v_order_id;
  if v_after <> 1500 then raise exception 'FAIL: pedido antigo mudou de % para %', v_before, v_after; end if;
  if v_rule <> 'same_city' then raise exception 'FAIL: faixa do pedido antigo mudou (%)', v_rule; end if;

  raise notice 'PASS - configuracao mudou de R$10 para R$30; pedido antigo continua com R$15 (10+5)';
end;
$t$;

-- ============================================================
-- Caso 12: idempotência conhece o endereço
-- ============================================================
--
-- Mesma chave com CEP diferente não pode devolver o pedido antigo (com o
-- frete antigo) como se fosse sucesso.
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_key uuid := gen_random_uuid();
  v_first public.orders;
  v_again public.orders;
  v_conflict boolean := false;
begin
  perform set_config('request.jwt.claims', null, true);

  select * into v_first from public.create_order(
    p_store_slug => 'frete-on', p_idempotency_key => v_key,
    p_customer_name => 'Cliente Idem', p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 3)),
    p_coupon_code => null,
    p_shipping_postal_code => '79330000', p_shipping_street => 'Rua A', p_shipping_number => '1',
    p_shipping_complement => null, p_shipping_neighborhood => 'Centro');

  -- reenvio idêntico: mesmo pedido, sem duplicar
  select * into v_again from public.create_order(
    p_store_slug => 'frete-on', p_idempotency_key => v_key,
    p_customer_name => 'Cliente Idem', p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 3)),
    p_coupon_code => null,
    p_shipping_postal_code => '79330000', p_shipping_street => 'Rua A', p_shipping_number => '1',
    p_shipping_complement => null, p_shipping_neighborhood => 'Centro');
  if v_again.id <> v_first.id then raise exception 'FAIL: reenvio identico criou outro pedido'; end if;

  -- mesma chave, outro CEP/cidade -> conflito
  begin
    perform public.create_order(
      p_store_slug => 'frete-on', p_idempotency_key => v_key,
      p_customer_name => 'Cliente Idem', p_customer_phone => '11999998888',
      p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
      p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 3)),
      p_coupon_code => null,
      p_shipping_postal_code => '78005000', p_shipping_street => 'Rua A', p_shipping_number => '1',
      p_shipping_complement => null, p_shipping_neighborhood => 'Centro');
  exception when others then
    if sqlerrm <> 'idempotency_conflict' then raise; end if;
    v_conflict := true;
  end;
  if not v_conflict then raise exception 'FAIL: mesma chave com outro endereco nao deu conflito'; end if;

  raise notice 'PASS - idempotencia inclui o endereco: reenvio identico devolve o mesmo pedido, CEP diferente recusa';
end;
$t$;

-- ============================================================
-- Caso 13: endereço incompleto ou CEP inválido recusa o pedido
-- ============================================================
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_denied integer := 0;
begin
  perform set_config('request.jwt.claims', null, true);

  begin
    perform public.create_order(
      p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
      p_customer_name => 'Cliente', p_customer_phone => '11999998888',
      p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
      p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
      p_coupon_code => null,
      p_shipping_postal_code => '7933', p_shipping_street => 'Rua A', p_shipping_number => '1',
      p_shipping_complement => null, p_shipping_neighborhood => 'Centro');
  exception when others then
    if sqlerrm <> 'invalid_shipping_postal_code' then raise; end if;
    v_denied := v_denied + 1;
  end;

  begin
    perform public.create_order(
      p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
      p_customer_name => 'Cliente', p_customer_phone => '11999998888',
      p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
      p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
      p_coupon_code => null,
      p_shipping_postal_code => '79330000', p_shipping_street => null, p_shipping_number => '1',
      p_shipping_complement => null, p_shipping_neighborhood => 'Centro');
  exception when others then
    if sqlerrm <> 'invalid_shipping_street' then raise; end if;
    v_denied := v_denied + 1;
  end;

  -- CEP com 8 dígitos, bem formado, mas que o servidor nunca resolveu.
  -- É o caso do serviço de CEP fora do ar (ou CEP inexistente): sem
  -- destino confirmado não há faixa a aplicar, e o pedido é recusado em
  -- vez de arbitrar um valor.
  begin
    perform public.create_order(
      p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
      p_customer_name => 'Cliente', p_customer_phone => '11999998888',
      p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
      p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
      p_coupon_code => null,
      p_shipping_postal_code => '99999999', p_shipping_street => 'Rua A', p_shipping_number => '1',
      p_shipping_complement => null, p_shipping_neighborhood => 'Centro');
  exception when others then
    if sqlerrm <> 'shipping_destination_unresolved' then raise; end if;
    v_denied := v_denied + 1;
  end;

  -- CEP longo demais também não vira um CEP "quase certo": o banco
  -- rejeita em vez de truncar para 8 dígitos, igual ao frontend.
  begin
    perform public.create_order(
      p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
      p_customer_name => 'Cliente', p_customer_phone => '11999998888',
      p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
      p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
      p_coupon_code => null,
      p_shipping_postal_code => '793300001234', p_shipping_street => 'Rua A', p_shipping_number => '1',
      p_shipping_complement => null, p_shipping_neighborhood => 'Centro');
  exception when others then
    if sqlerrm <> 'invalid_shipping_postal_code' then raise; end if;
    v_denied := v_denied + 1;
  end;

  -- E letras no CEP viram nada, não um CEP parcial.
  begin
    perform public.create_order(
      p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
      p_customer_name => 'Cliente', p_customer_phone => '11999998888',
      p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
      p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
      p_coupon_code => null,
      p_shipping_postal_code => 'CEP-INVALIDO', p_shipping_street => 'Rua A', p_shipping_number => '1',
      p_shipping_complement => null, p_shipping_neighborhood => 'Centro');
  exception when others then
    if sqlerrm <> 'invalid_shipping_postal_code' then raise; end if;
    v_denied := v_denied + 1;
  end;

  if v_denied <> 5 then raise exception 'FAIL: endereco invalido aceito (% recusas de 5)', v_denied; end if;
  raise notice 'PASS - CEP curto/longo/com letras, rua ausente e CEP nao resolvido recusam o pedido';
end;
$t$;

-- ============================================================
-- Caso 14: loja sem frete configurado continua funcionando igual
-- ============================================================
--
-- Regressão de compatibilidade: nenhuma loja perde a modalidade de
-- entrega por causa desta migration, e o pedido continua sem frete.
do $t$
declare
  v_prod uuid := current_setting('app.frete_off_prod')::uuid;
  v_order public.orders;
  v_denied boolean := false;
  v_quote record;
begin
  perform set_config('request.jwt.claims', null, true);

  select * into v_order from public.create_order(
    p_store_slug => 'frete-off', p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Cliente Legado', p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery',
    p_delivery_address => 'Rua Antiga, 45 - fundos',
    p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 4)));

  if v_order.shipping_amount_cents <> 0 then raise exception 'FAIL: loja sem frete cobrou %', v_order.shipping_amount_cents; end if;
  if v_order.shipping_rule is not null then raise exception 'FAIL: faixa gravada sem configuracao (%)', v_order.shipping_rule; end if;
  if v_order.delivery_address <> 'Rua Antiga, 45 - fundos' then
    raise exception 'FAIL: endereco livre alterado (%)', v_order.delivery_address;
  end if;
  if v_order.total_cents <> v_order.subtotal_cents - v_order.discount_cents then
    raise exception 'FAIL: total legado divergiu';
  end if;

  -- endereço livre continua obrigatório para entrega nessa loja
  begin
    perform public.create_order(
      p_store_slug => 'frete-off', p_idempotency_key => gen_random_uuid(),
      p_customer_name => 'Cliente Legado', p_customer_phone => '11999998888',
      p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
      p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)));
  exception when others then
    if sqlerrm <> 'delivery_address_required' then raise; end if;
    v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL: entrega sem endereco foi aceita na loja legada'; end if;

  -- e a prévia avisa a tela que essa loja não tem frete
  select * into v_quote from public.shipping_quote(
    'frete-off', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
    null, '79002000');
  if v_quote.shipping_enabled or v_quote.reason <> 'shipping_disabled' then
    raise exception 'FAIL: previa nao sinalizou frete desligado (% / %)', v_quote.shipping_enabled, v_quote.reason;
  end if;

  raise notice 'PASS - loja sem frete: entrega com endereco livre, frete zero, previa sinaliza desligado';
end;
$t$;

-- ============================================================
-- Caso 15: retirada nunca paga frete
-- ============================================================
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_order public.orders;
begin
  perform set_config('request.jwt.claims', null, true);

  select * into v_order from public.create_order(
    p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Cliente Retirada', p_customer_phone => '11999998888',
    p_fulfillment_method => 'pickup', p_delivery_address => null, p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 5)),
    p_coupon_code => null,
    -- endereço enviado mesmo assim: tem que ser ignorado
    p_shipping_postal_code => '78005000', p_shipping_street => 'Rua X', p_shipping_number => '9',
    p_shipping_complement => null, p_shipping_neighborhood => 'Centro');

  if v_order.shipping_amount_cents <> 0 then raise exception 'FAIL: retirada cobrou frete %', v_order.shipping_amount_cents; end if;
  if v_order.shipping_rule is not null then raise exception 'FAIL: retirada gravou faixa (%)', v_order.shipping_rule; end if;
  if v_order.shipping_postal_code is not null then raise exception 'FAIL: retirada gravou CEP de entrega'; end if;
  if v_order.total_cents <> v_order.subtotal_cents then raise exception 'FAIL: total da retirada %', v_order.total_cents; end if;

  raise notice 'PASS - retirada ignora endereco enviado e nunca cobra frete';
end;
$t$;

-- ============================================================
-- Caso 16: a CHECK do total conhece as três parcelas
-- ============================================================
do $t$
declare
  v_order_id uuid := current_setting('app.order_same_city')::uuid;
  v_blocked boolean := false;
begin
  begin
    update public.orders set total_cents = 1 where id = v_order_id;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'FAIL: total incoerente foi aceito pelo banco'; end if;
  raise notice 'PASS - orders_total_matches_components impede total fora de subtotal - desconto + frete';
end;
$t$;


-- ============================================================
-- Caso 17 (ATAQUE A e B) — cidade e UF forjadas
-- ============================================================
--
-- Este é o ataque que a primeira versão desta feature permitia: mandar
-- um CEP de São Paulo e, no mesmo payload, city="Corumbá"/state="MS"
-- para pagar a faixa de mesma cidade (R$15 em vez de R$40).
--
-- A defesa é estrutural: os parâmetros deixaram de existir. Provamos as
-- duas metades — que a função recusa os argumentos, e que o valor
-- cobrado segue o CEP real de qualquer maneira.
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_order public.orders;
  v_refused boolean := false;
begin
  perform set_config('request.jwt.claims', null, true);

  -- A) tentar enviar cidade/UF: a chamada nem existe.
  begin
    execute format($sql$
      select public.create_order(
        p_store_slug => 'frete-on', p_idempotency_key => %L::uuid,
        p_customer_name => 'Atacante', p_customer_phone => '11999998888',
        p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
        p_items => %L::jsonb, p_coupon_code => null,
        p_shipping_postal_code => '01310100', p_shipping_street => 'Av Paulista',
        p_shipping_number => '1000', p_shipping_complement => null,
        p_shipping_neighborhood => 'Bela Vista',
        p_shipping_city => 'Corumbá', p_shipping_state => 'MS')
    $sql$, gen_random_uuid(), jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)));
  exception when undefined_function then
    -- 42883: não existe função create_order que aceite esses argumentos.
    -- Exigimos ESTE erro, e não "qualquer erro": um `when others` faria
    -- o teste passar até com um erro de digitação do próprio teste.
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL: create_order aceitou p_shipping_city/p_shipping_state';
  end if;
  if exists (select 1 from public.orders where customer_name = 'Atacante') then
    raise exception 'FAIL: o payload com cidade forjada chegou a criar pedido';
  end if;

  -- B) o caminho legítimo, com o MESMO CEP de São Paulo: tem que cair em
  -- outro estado, nunca em mesma cidade nem mesmo estado.
  select * into v_order from public.create_order(
    p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Comprador SP', p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
    p_coupon_code => null,
    p_shipping_postal_code => '01310100', p_shipping_street => 'Av Paulista', p_shipping_number => '1000',
    p_shipping_complement => null, p_shipping_neighborhood => 'Bela Vista');

  if v_order.shipping_rule <> 'other_state' then
    raise exception 'FAIL: CEP de SP caiu em % (esperado other_state)', v_order.shipping_rule;
  end if;
  if v_order.shipping_city <> 'São Paulo' or v_order.shipping_state <> 'SP' then
    raise exception 'FAIL: destino gravado % / % (esperado São Paulo / SP)',
      v_order.shipping_city, v_order.shipping_state;
  end if;
  if v_order.shipping_amount_cents = 1500 then
    raise exception 'FAIL: CEP de SP pagou frete de mesma cidade';
  end if;

  raise notice 'PASS - ATAQUE A/B: cidade e UF forjadas nao existem como parametro; CEP de SP paga other_state';
end;
$t$;

-- ============================================================
-- Caso 18 (ATAQUE C, D, E, F) — valores enviados pelo cliente
-- ============================================================
--
-- O cliente tenta mandar frete, subtotal, desconto e total. Nenhum
-- desses é parâmetro de create_order nem de shipping_quote — a defesa é
-- a mesma de sempre: o que não entra não pode ser forjado.
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_forbidden text[] := array[
    'p_shipping_amount_cents', 'p_shipping_cents', 'p_shipping_fee_cents',
    'p_subtotal_cents', 'p_discount_cents', 'p_total_cents',
    'p_shipping_city', 'p_shipping_state', 'p_city', 'p_state', 'p_rule', 'p_free_shipping'
  ];
  v_arg text;
  v_count integer;
  v_quote record;
begin
  perform set_config('request.jwt.claims', null, true);

  foreach v_arg in array v_forbidden loop
    select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_order', 'shipping_quote')
      and v_arg = any (p.proargnames);
    if v_count <> 0 then
      raise exception 'FAIL: % ainda e parametro de create_order/shipping_quote', v_arg;
    end if;
  end loop;

  -- D) subtotal adulterado para ganhar frete grátis: shipping_quote não
  -- aceita subtotal, e recalcula de products. Um carrinho de R$10 nunca
  -- vira R$200 por afirmação do cliente.
  select * into v_quote from public.shipping_quote(
    'frete-on', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
    null, '79330000');
  if v_quote.subtotal_cents <> 1000 then
    raise exception 'FAIL: subtotal da previa % (esperado 1000)', v_quote.subtotal_cents;
  end if;
  if v_quote.rule = 'free' then
    raise exception 'FAIL: carrinho de R$10 recebeu frete gratis';
  end if;

  -- E) desconto adulterado: o único campo de cupom é o CÓDIGO, e um
  -- código inexistente não vira desconto nenhum.
  select * into v_quote from public.shipping_quote(
    'frete-on', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1)),
    'CUPOM-QUE-NAO-EXISTE', '79330000');
  if v_quote.discount_cents <> 0 then
    raise exception 'FAIL: cupom inexistente gerou desconto de %', v_quote.discount_cents;
  end if;

  raise notice 'PASS - ATAQUE C/D/E/F: frete, subtotal, desconto e total nao sao aceitos do cliente';
end;
$t$;

-- ============================================================
-- Caso 19 (ATAQUE F + TOCTOU) — total da tela vs total cobrado
-- ============================================================
--
-- Cenário do requisito 6: o cliente recebe cotação de R$10 de frete, o
-- lojista muda para R$30, e o cliente tenta finalizar com a cotação
-- antiga.
--
-- A regra escolhida é a mais simples e segura: create_order SEMPRE
-- recalcula, e p_expected_total_cents só serve para RECUSAR quando o
-- valor mudou — o comprador nunca escolhe qual preço pagar, e também
-- nunca é debitado num valor que não viu.
do $t$
declare
  v_prod uuid := current_setting('app.frete_on_prod')::uuid;
  v_store uuid := current_setting('app.frete_on_store')::uuid;
  v_quote record;
  v_order public.orders;
  v_refused boolean := false;
  v_quoted integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.frete_on_uid'))::text, true);
  perform public.shipping_settings_upsert(v_store, true, '79330000', 'Corumbá', 'MS',
    1000, 2000, 3500, 0, false, null);
  perform set_config('request.jwt.claims', null, true);

  -- 1+2. cotação com frete de R$10 (mesma cidade, sem acréscimo)
  select * into v_quote from public.shipping_quote(
    'frete-on', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2)),
    null, '79330000');
  v_quoted := v_quote.total_cents;
  if v_quote.shipping_cents <> 1000 then
    raise exception 'FAIL: cotacao inicial de frete % (esperado 1000)', v_quote.shipping_cents;
  end if;

  -- 3. lojista sobe para R$30
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.frete_on_uid'))::text, true);
  perform public.shipping_settings_upsert(v_store, true, '79330000', 'Corumbá', 'MS',
    3000, 2000, 3500, 0, false, null);
  perform set_config('request.jwt.claims', null, true);

  -- 4. cliente tenta fechar com o total antigo -> RECUSADO
  begin
    perform public.create_order(
      p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
      p_customer_name => 'Cliente TOCTOU', p_customer_phone => '11999998888',
      p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
      p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2)),
      p_coupon_code => null,
      p_shipping_postal_code => '79330000', p_shipping_street => 'Rua A', p_shipping_number => '1',
      p_shipping_complement => null, p_shipping_neighborhood => 'Centro',
      p_expected_total_cents => v_quoted);
  exception when others then
    if sqlerrm <> 'total_changed' then raise; end if;
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL: pedido fechou com o total antigo apos o lojista mudar o frete';
  end if;

  -- F) e mandar um total MENOR também não cobra menos: recusa igual.
  v_refused := false;
  begin
    perform public.create_order(
      p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
      p_customer_name => 'Cliente TOCTOU', p_customer_phone => '11999998888',
      p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
      p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2)),
      p_coupon_code => null,
      p_shipping_postal_code => '79330000', p_shipping_street => 'Rua A', p_shipping_number => '1',
      p_shipping_complement => null, p_shipping_neighborhood => 'Centro',
      p_expected_total_cents => 1);
  exception when others then
    if sqlerrm <> 'total_changed' then raise; end if;
    v_refused := true;
  end;
  if not v_refused then raise exception 'FAIL: total de 1 centavo foi aceito'; end if;

  -- 5. recotizando, o pedido fecha — com o valor NOVO, não com o antigo.
  select * into v_quote from public.shipping_quote(
    'frete-on', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2)),
    null, '79330000');
  select * into v_order from public.create_order(
    p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Cliente TOCTOU', p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2)),
    p_coupon_code => null,
    p_shipping_postal_code => '79330000', p_shipping_street => 'Rua A', p_shipping_number => '1',
    p_shipping_complement => null, p_shipping_neighborhood => 'Centro',
    p_expected_total_cents => v_quote.total_cents);

  if v_order.shipping_amount_cents <> 3000 then
    raise exception 'FAIL: pedido gravou frete % (esperado 3000, o valor NOVO)', v_order.shipping_amount_cents;
  end if;

  -- E sem a trava, o pedido também sai — pelo valor novo. Omitir o
  -- parâmetro não é um jeito de pagar o preço antigo.
  select * into v_order from public.create_order(
    p_store_slug => 'frete-on', p_idempotency_key => gen_random_uuid(),
    p_customer_name => 'Cliente Sem Trava', p_customer_phone => '11999998888',
    p_fulfillment_method => 'delivery', p_delivery_address => null, p_customer_notes => null,
    p_items => jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2)),
    p_coupon_code => null,
    p_shipping_postal_code => '79330000', p_shipping_street => 'Rua A', p_shipping_number => '1',
    p_shipping_complement => null, p_shipping_neighborhood => 'Centro');
  if v_order.shipping_amount_cents <> 3000 then
    raise exception 'FAIL: sem a trava o pedido pagou % (esperado 3000)', v_order.shipping_amount_cents;
  end if;

  raise notice 'PASS - TOCTOU: cotacao antiga recusa (total_changed); recotizando paga o valor NOVO';
end;
$t$;

-- ============================================================
-- Caso 20 — o cache de CEP não é escrevível pelo comprador
-- ============================================================
--
-- Toda a defesa de cidade/UF se apoia em uma coisa: só `service_role`
-- escreve em shipping_postal_codes. Se anon pudesse gravar, bastaria
-- plantar "01310100 fica em Corumbá/MS" e o ataque voltaria por outra
-- porta.
do $t$
declare v_count integer;
begin
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'shipping_postal_codes'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'SELECT', 'TRUNCATE');
  if v_count <> 0 then
    raise exception 'FAIL: anon/authenticated tem % privilegios em shipping_postal_codes', v_count;
  end if;

  select count(*) into v_count
  from information_schema.role_routine_grants
  where routine_schema = 'public' and routine_name = 'shipping_postal_code_upsert'
    and grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_count <> 0 then
    raise exception 'FAIL: shipping_postal_code_upsert executavel por anon/authenticated';
  end if;

  if not exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'shipping_postal_code_upsert'
      and grantee = 'service_role'
  ) then
    raise exception 'FAIL: service_role nao consegue registrar CEP resolvido';
  end if;

  raise notice 'PASS - shipping_postal_codes: escrita so por service_role; comprador nao planta destino';
end;
$t$;

rollback;
