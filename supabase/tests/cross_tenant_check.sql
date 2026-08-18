-- TASK-012 — Isolamento entre tenants nas tabelas novas.
--
-- Merchant A e Merchant B são workspaces completamente separados. A não
-- pode LER nem AGIR sobre nada de B. Cada caso testa com o cliente do
-- próprio usuário (RLS ativa), nunca como postgres.
--
-- Uso:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/cross_tenant_check.sql

\set ON_ERROR_STOP on
begin;

do $setup$
declare
  v_tenant text; v_uid uuid; v_ws uuid; v_store uuid; v_prod uuid; v_coupon uuid; v_order uuid;
begin
  foreach v_tenant in array array['a','b'] loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
              'xt-' || v_tenant || '@test.local','x',now(),now(),now());
    insert into public.workspaces (owner_user_id, name) values (v_uid,'WS ' || v_tenant) returning id into v_ws;
    insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
      values (v_ws,'professional','active',now());
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid,'owner');
    insert into public.stores (slug,name,status,workspace_id)
      values ('xt-' || v_tenant,'Loja ' || v_tenant,'active',v_ws) returning id into v_store;
    insert into public.store_members (store_id,user_id,role) values (v_store,v_uid,'owner');
    insert into public.products (store_id,name,slug,price_cents,stock,status)
      values (v_store,'P','p-' || v_tenant,10000,100,'published') returning id into v_prod;
    -- Rascunho: é ELE que marca a fronteira de tenant. O publicado é
    -- catálogo público de propósito.
    insert into public.products (store_id,name,slug,price_cents,stock,status)
      values (v_store,'Rascunho','rascunho-' || v_tenant,10000,100,'draft');
    -- MESMO código nos dois tenants, de propósito.
    insert into public.coupons (store_id, code, normalized_code, discount_type, discount_value)
      values (v_store,'NATAL10','NATAL10','percentage',1000) returning id into v_coupon;
    insert into public.workspace_invitations (workspace_id, email, token_hash, expires_at)
      values (v_ws,'convidado-' || v_tenant || '@test.local', repeat(v_tenant,64), now() + interval '7 days');
    insert into public.app_sessions (workspace_id, user_id, supabase_session_hash, expires_at)
      values (v_ws, v_uid, 'hash-' || v_tenant, now() + interval '30 days');
    insert into public.orders (store_id, public_code, idempotency_key, request_fingerprint,
      customer_name, customer_phone, fulfillment_method, status, subtotal_cents, discount_cents, total_cents)
      values (v_store,'XT' || upper(v_tenant) || '0001', gen_random_uuid(), 'fp-' || v_tenant,
              'Cliente','11999990000','pickup','pending',10000,1000,9000) returning id into v_order;
    insert into public.coupon_redemptions (coupon_id, store_id, order_id, status, discount_cents)
      values (v_coupon, v_store, v_order,'reserved',1000);

    perform set_config('app.' || v_tenant || '_uid', v_uid::text, true);
    perform set_config('app.' || v_tenant || '_ws', v_ws::text, true);
    perform set_config('app.' || v_tenant || '_store', v_store::text, true);
    perform set_config('app.' || v_tenant || '_coupon', v_coupon::text, true);
  end loop;
end;
$setup$;

-- ============================================================
-- LEITURA: A não enxerga nada de B
-- ============================================================
savepoint leitura;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.a_uid'))::text, true);

do $t$
declare v integer; v_ws_b uuid := current_setting('app.b_ws')::uuid;
begin
  select count(*) into v from public.workspaces where id = v_ws_b;
  if v <> 0 then raise exception 'FAIL: A leu o workspace de B'; end if;

  select count(*) into v from public.workspace_subscriptions where workspace_id = v_ws_b;
  if v <> 0 then raise exception 'FAIL: A leu a assinatura de B'; end if;

  select count(*) into v from public.workspace_members where workspace_id = v_ws_b;
  if v <> 0 then raise exception 'FAIL: A leu a equipe de B'; end if;

  select count(*) into v from public.workspace_invitations where workspace_id = v_ws_b;
  if v <> 0 then raise exception 'FAIL: A leu os convites de B'; end if;

  select count(*) into v from public.app_sessions where workspace_id = v_ws_b;
  if v <> 0 then raise exception 'FAIL: A leu as sessoes de B'; end if;

  select count(*) into v from public.coupons where store_id = current_setting('app.b_store')::uuid;
  if v <> 0 then raise exception 'FAIL: A leu os cupons de B'; end if;

  select count(*) into v from public.coupon_redemptions where store_id = current_setting('app.b_store')::uuid;
  if v <> 0 then raise exception 'FAIL: A leu os resgates de B'; end if;

  select count(*) into v from public.orders where store_id = current_setting('app.b_store')::uuid;
  if v <> 0 then raise exception 'FAIL: A leu os pedidos de B'; end if;

  -- ATENÇÃO: produto PUBLICADO de loja ATIVA é público de propósito —
  -- é o catálogo do storefront, legível inclusive por anon
  -- (products_select_public). O limite de tenant aqui é o produto NÃO
  -- publicado, que só o pessoal da loja pode ver.
  select count(*) into v from public.products
    where store_id = current_setting('app.b_store')::uuid and status = 'draft';
  if v <> 0 then raise exception 'FAIL: A leu produto NAO publicado de B'; end if;

  -- controle positivo do outro lado: o publicado de B É visível, porque
  -- o storefront é público. Se isto parar de valer, o catálogo quebrou.
  select count(*) into v from public.products
    where store_id = current_setting('app.b_store')::uuid and status = 'published';
  if v <> 1 then raise exception 'FAIL: catalogo publico de B deixou de ser legivel (%)', v; end if;

  -- controle positivo: A enxerga o que é dele
  select count(*) into v from public.coupons where store_id = current_setting('app.a_store')::uuid;
  if v <> 1 then raise exception 'FAIL: A nao enxerga o proprio cupom (%)', v; end if;

  raise notice 'PASS - leitura isolada: A nao ve workspace/assinatura/equipe/convites/sessoes/cupons/resgates/pedidos nem produto nao-publicado de B';
end;
$t$;
rollback to savepoint leitura;

-- ============================================================
-- AÇÃO: A não age sobre B
-- ============================================================
do $t$
declare v_ok boolean; v_b_store uuid := current_setting('app.b_store')::uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.a_uid'))::text, true);

  -- criar cupom na loja de B
  v_ok := false;
  begin
    perform public.coupon_upsert(v_b_store, null, 'INVASOR', 'percentage', 5000);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: A criou cupom na loja de B'; end if;

  -- editar o cupom de B passando o id dele
  v_ok := false;
  begin
    perform public.coupon_upsert(v_b_store, current_setting('app.b_coupon')::uuid, 'NATAL10', 'percentage', 9900);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: A editou o cupom de B'; end if;

  -- listar cupons de B
  v_ok := false;
  begin
    perform * from public.coupon_list(v_b_store);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: A listou cupons de B'; end if;

  -- ler equipe de B
  v_ok := false;
  begin
    perform * from public.workspace_team(v_b_store);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: A leu a equipe de B'; end if;

  -- ler quota de B
  v_ok := false;
  begin
    perform * from public.store_quota_usage(v_b_store);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: A leu a quota de B'; end if;

  -- criar produto na loja de B
  v_ok := false;
  begin
    perform public.catalog_create_product(v_b_store, 'X', 'x-invasor', 100, 1);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: A criou produto na loja de B'; end if;

  -- remover membro de B
  v_ok := false;
  begin
    perform public.workspace_remove_member(current_setting('app.b_uid')::uuid);
  exception when others then
    v_ok := true;  -- member_not_found ou insufficient_privilege: os dois recusam
  end;
  if not v_ok then raise exception 'FAIL: A removeu membro de B'; end if;

  raise notice 'PASS - acao isolada: A nao cria/edita/lista cupom, equipe, quota, produto nem remove membro de B';
end;
$t$;

-- ============================================================
-- CUPOM: mesmo código, cupons diferentes
-- ============================================================
do $t$
declare r_a record; r_b record;
begin
  select * into r_a from public.coupon_validate(current_setting('app.a_store')::uuid, 'NATAL10', 20000);
  select * into r_b from public.coupon_validate(current_setting('app.b_store')::uuid, 'NATAL10', 20000);

  if not r_a.valid or not r_b.valid then raise exception 'FAIL: NATAL10 deveria valer nas duas lojas'; end if;
  if r_a.coupon_id = r_b.coupon_id then raise exception 'FAIL: as duas lojas compartilham o MESMO cupom'; end if;

  raise notice 'PASS - NATAL10 existe nas duas lojas como cupons independentes (ids distintos)';
end;
$t$;

-- ============================================================
-- SESSÃO: A não revoga sessão de B
-- ============================================================
savepoint sessao;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.a_uid'))::text, true);
do $t$
declare v_ok boolean := false; v integer;
begin
  begin
    update public.app_sessions set revoked_at = now()
      where workspace_id = current_setting('app.b_ws')::uuid;
    -- Sem grant de UPDATE, isto nem chega a avaliar RLS.
    get diagnostics v = row_count;
    if v > 0 then raise exception 'FAIL: A revogou % sessao(oes) de B', v; end if;
    v_ok := true;
  exception
    when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: update em app_sessions de B nao foi barrado'; end if;
  raise notice 'PASS - A nao consegue revogar sessao de B';
end;
$t$;
rollback to savepoint sessao;

-- ============================================================
-- ANON: storefront publico continua publico, resto negado
-- ============================================================
--
-- Contrapeso ao endurecimento de RLS: ao fechar as tabelas novas, o
-- catalogo publico NAO pode ter sido fechado junto. E o comprador anon
-- precisa continuar conseguindo aplicar cupom (coupon_preview e
-- SECURITY DEFINER justamente por isso).
savepoint anon_check;
set local role anon;
select set_config('request.jwt.claims', '', true);

do $t$
declare v integer; t text; v_neg integer := 0;
begin
  -- catalogo publico: o produto publicado de loja ativa E visivel
  select count(*) into v from public.products
    where store_id = current_setting('app.a_store')::uuid and status = 'published';
  if v <> 1 then raise exception 'FAIL: catalogo publico quebrou para anon (%)', v; end if;

  -- rascunho nunca
  select count(*) into v from public.products
    where store_id = current_setting('app.a_store')::uuid and status = 'draft';
  if v <> 0 then raise exception 'FAIL: rascunho visivel para anon'; end if;

  -- catalogo comercial de planos e publico (landing mostra preco)
  select count(*) into v from public.platform_plans;
  if v <> 3 then raise exception 'FAIL: planos invisiveis para anon'; end if;

  -- tabelas privadas: negadas por GRANT (erro) ou por RLS (zero linhas)
  foreach t in array array['coupons','app_sessions','workspace_members','workspace_subscriptions',
                           'workspaces','workspace_invitations','coupon_redemptions'] loop
    begin
      execute format('select count(*) from public.%I', t) into v;
      if v <> 0 then raise exception 'FAIL: anon leu % linha(s) de %', v, t; end if;
      v_neg := v_neg + 1;
    exception when insufficient_privilege then
      v_neg := v_neg + 1;
    end;
  end loop;
  if v_neg <> 7 then raise exception 'FAIL: cobertura anon incompleta (%)', v_neg; end if;

  -- e o comprador ainda aplica cupom
  select count(*) into v from public.coupon_preview('xt-a', 'NATAL10', 20000) p where p.valid;
  if v <> 1 then raise exception 'FAIL: anon nao consegue mais aplicar cupom'; end if;

  raise notice 'PASS - anon: catalogo publico legivel, rascunho negado, 7 tabelas privadas negadas, coupon_preview funcionando';
end;
$t$;
rollback to savepoint anon_check;

do $t$ begin raise notice 'OK: isolamento cross-tenant conferido'; end; $t$;

rollback;
