-- TASK-012 commit 2 — Enforcement de quota (produtos, imagens, lojas)
-- contra Postgres real. Mesmo padrão dos demais arquivos de
-- supabase/tests/: tudo dentro de UMA transação, nada persiste.
--
-- Como rodar:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/quota_enforcement_check.sql
--
-- Fixtures próprias (não depende de seed-local): um workspace por plano,
-- cada um com dono, assinatura ATIVA e uma loja active.
--
-- Cobre:
--   1-3  produtos: limite exato por plano (75/350/1000) e o N+1 recusado
--   4    draft ocupa quota (não dá para acumular rascunho)
--   5    archived não ocupa, mas DESARQUIVAR revalida (fecha o bypass)
--   6-8  imagens: 1/5/10 permitidas, a seguinte recusada
--   9-11 lojas: Profissional 2ª e 3ª OK, 4ª recusada; Essencial 2ª recusada
--   12-16 bypass: tenant alheio, DML direto, plano forjado, quota alheia

\set ON_ERROR_STOP on
begin;

-- ============================================================
-- Fixtures
-- ============================================================
do $setup$
declare
  v_plan text;
  v_uid uuid;
  v_ws uuid;
  v_store uuid;
begin
  foreach v_plan in array array['essential','growth','professional'] loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
              v_plan || '@quota.test','x',now(),now(),now());

    insert into public.workspaces (owner_user_id, name) values (v_uid, 'WS ' || v_plan) returning id into v_ws;
    insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
      values (v_ws, v_plan, 'active', now());

    insert into public.stores (slug, name, status, workspace_id)
      values ('loja-' || v_plan, 'Loja ' || v_plan, 'active', v_ws) returning id into v_store;
    insert into public.store_members (store_id, user_id, role) values (v_store, v_uid, 'owner');
    insert into public.store_plans (store_id, plan_code, plan_key)
      select v_store, legacy_plan_code, v_plan from public.platform_plans where plan_key = v_plan;

    perform set_config('app.' || v_plan || '_uid', v_uid::text, true);
    perform set_config('app.' || v_plan || '_ws', v_ws::text, true);
    perform set_config('app.' || v_plan || '_store', v_store::text, true);
  end loop;
end;
$setup$;

-- ============================================================
-- Casos 1-3: limite exato de produtos por plano
-- ============================================================
do $t$
declare
  v_plan text;
  v_limit integer;
  v_store uuid;
  v_row public.products;
  v_ok boolean;
begin
  foreach v_plan in array array['essential','growth','professional'] loop
    v_store := current_setting('app.' || v_plan || '_store')::uuid;
    select max_products into v_limit from public.store_entitlements(v_store);

    -- Preenche até limite-1 direto (rápido); a fronteira é testada pela RPC.
    insert into public.products (store_id, name, slug, price_cents, stock, status)
      select v_store, 'p' || g, 'p' || g, 100, 1, 'draft'
      from generate_series(1, v_limit - 1) g;

    if public.store_product_quota_count(v_store) <> v_limit - 1 then
      raise exception 'FAIL: contagem inicial errada para %', v_plan;
    end if;

    -- O produto de número `limit` deve passar.
    perform set_config('request.jwt.claims',
      json_build_object('sub', current_setting('app.' || v_plan || '_uid'))::text, true);
    select * into v_row from public.catalog_create_product(v_store, 'ultimo', 'ultimo', 100, 1);
    if v_row.id is null then raise exception 'FAIL: % nao criou o produto %', v_plan, v_limit; end if;

    -- O de número limit+1 deve ser RECUSADO.
    v_ok := false;
    begin
      perform public.catalog_create_product(v_store, 'excedente', 'excedente', 100, 1);
    exception when others then
      if sqlerrm <> 'max_products_reached' then raise; end if;
      v_ok := true;
    end;
    if not v_ok then
      raise exception 'FAIL: % permitiu o produto % (limite %)', v_plan, v_limit + 1, v_limit;
    end if;

    raise notice 'PASS - produtos %: % permitidos, %o recusado', v_plan, v_limit, v_limit + 1;
  end loop;
end;
$t$;

-- ============================================================
-- Caso 4: draft ocupa quota (não é possível acumular rascunho)
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.essential_store')::uuid;
  v_count integer;
begin
  select count(*) into v_count from public.products where store_id = v_store and status = 'draft';
  if v_count <> 75 then raise exception 'FAIL: esperava 75 drafts, got %', v_count; end if;
  if public.store_product_quota_count(v_store) <> 75 then
    raise exception 'FAIL: drafts nao estao ocupando quota';
  end if;
  raise notice 'PASS - draft ocupa quota (75 rascunhos = 75/75, nao ha acumulo livre)';
end;
$t$;

-- ============================================================
-- Caso 5: archived nao ocupa, mas DESARQUIVAR revalida a quota
-- ============================================================
do $t$
declare
  v_store uuid := current_setting('app.essential_store')::uuid;
  v_victim uuid;
  v_ok boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.essential_uid'))::text, true);

  select id into v_victim from public.products where store_id = v_store and status = 'draft' limit 1;

  -- Arquivar libera vaga...
  perform public.catalog_set_product_status(v_victim, 'archived');
  if public.store_product_quota_count(v_store) <> 74 then
    raise exception 'FAIL: arquivar nao liberou vaga';
  end if;

  -- ...e a vaga liberada pode ser reocupada por um produto novo.
  perform public.catalog_create_product(v_store, 'novo-pos-arquivo', 'novo-pos-arquivo', 100, 1);
  if public.store_product_quota_count(v_store) <> 75 then
    raise exception 'FAIL: quota deveria estar cheia de novo';
  end if;

  -- Agora o bypass: tentar DESARQUIVAR com a quota cheia deve falhar.
  v_ok := false;
  begin
    perform public.catalog_set_product_status(v_victim, 'published');
  exception when others then
    if sqlerrm <> 'max_products_reached' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: desarquivou acima do limite (bypass arquivar/recriar/reativar)';
  end if;
  raise notice 'PASS - archived nao ocupa, mas desarquivar acima do limite e recusado';
end;
$t$;

-- ============================================================
-- Casos 6-8: imagens por produto (1 / 5 / 10)
-- ============================================================
do $t$
declare
  v_plan text;
  v_store uuid;
  v_prod uuid;
  v_limit integer;
  v_ok boolean;
  i integer;
begin
  foreach v_plan in array array['essential','growth','professional'] loop
    v_store := current_setting('app.' || v_plan || '_store')::uuid;
    select max_images_per_product into v_limit from public.store_entitlements(v_store);

    insert into public.products (store_id, name, slug, price_cents, stock, status)
      values (v_store, 'img-host', 'img-host', 100, 1, 'draft') returning id into v_prod;

    perform set_config('request.jwt.claims',
      json_build_object('sub', current_setting('app.' || v_plan || '_uid'))::text, true);

    for i in 1..v_limit loop
      perform public.catalog_add_product_image(v_prod, v_store::text || '/' || v_prod::text || '/' || i || '.jpg');
    end loop;

    v_ok := false;
    begin
      perform public.catalog_add_product_image(v_prod, v_store::text || '/' || v_prod::text || '/excedente.jpg');
    exception when others then
      if sqlerrm <> 'max_images_reached' then raise; end if;
      v_ok := true;
    end;
    if not v_ok then raise exception 'FAIL: % permitiu a imagem %', v_plan, v_limit + 1; end if;

    raise notice 'PASS - imagens %: % permitidas, %a recusada', v_plan, v_limit, v_limit + 1;
  end loop;
end;
$t$;

-- ============================================================
-- Casos 9-11: lojas por workspace
-- ============================================================
do $t$
declare
  v_ok boolean;
  v_count integer;
begin
  -- Profissional: 2a e 3a permitidas, 4a recusada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.professional_uid'))::text, true);
  perform public.workspace_create_store('Loja Pro 2', 'loja-pro-2');
  perform public.workspace_create_store('Loja Pro 3', 'loja-pro-3');

  select count(*) into v_count from public.stores
    where workspace_id = current_setting('app.professional_ws')::uuid;
  if v_count <> 3 then raise exception 'FAIL: esperava 3 lojas, got %', v_count; end if;

  v_ok := false;
  begin
    perform public.workspace_create_store('Loja Pro 4', 'loja-pro-4');
  exception when others then
    if sqlerrm <> 'max_stores_reached' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: Profissional criou a 4a loja'; end if;
  raise notice 'PASS - lojas professional: 1,2,3 OK / 4a recusada';

  -- Essencial e Crescimento: 2a recusada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.essential_uid'))::text, true);
  v_ok := false;
  begin
    perform public.workspace_create_store('Loja Ess 2', 'loja-ess-2');
  exception when others then
    if sqlerrm <> 'max_stores_reached' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: Essencial criou a 2a loja'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.growth_uid'))::text, true);
  v_ok := false;
  begin
    perform public.workspace_create_store('Loja Gro 2', 'loja-gro-2');
  exception when others then
    if sqlerrm <> 'max_stores_reached' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: Crescimento criou a 2a loja'; end if;
  raise notice 'PASS - lojas essential/growth: 2a recusada';
end;
$t$;

-- ============================================================
-- Casos 12-16: tentativas deliberadas de bypass
-- ============================================================
do $t$
declare
  v_ok boolean;
  v_other_store uuid := current_setting('app.growth_store')::uuid;
  v_prod uuid;
begin
  -- 12. Essencial tenta criar produto na loja do Crescimento.
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.essential_uid'))::text, true);
  v_ok := false;
  begin
    perform public.catalog_create_product(v_other_store, 'invasor', 'invasor', 100, 1);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: criou produto em loja de outro tenant'; end if;

  -- 13. Essencial tenta ler a quota da loja alheia.
  v_ok := false;
  begin
    perform * from public.store_quota_usage(v_other_store);
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: leu quota de outro tenant'; end if;

  -- 14. Essencial tenta adicionar imagem em produto alheio.
  select id into v_prod from public.products where store_id = v_other_store limit 1;
  v_ok := false;
  begin
    perform public.catalog_add_product_image(v_prod, v_other_store::text || '/' || v_prod::text || '/x.jpg');
  exception when others then
    if sqlerrm <> 'insufficient_privilege' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: adicionou imagem em produto de outro tenant'; end if;

  raise notice 'PASS - bypass cross-tenant recusado (produto, quota, imagem)';
end;
$t$;

-- 15. DML direto em products como authenticated — a quota nao pode ser
--     contornada escrevendo na tabela sem passar pela RPC.
savepoint bypass_dml;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('app.essential_uid'))::text, true);
do $t$
declare v_ok boolean := false;
begin
  begin
    insert into public.products (store_id, name, slug, price_cents, stock, status)
      values (current_setting('app.essential_store')::uuid, 'dml-direto', 'dml-direto', 100, 1, 'draft');
  exception when insufficient_privilege or others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: INSERT direto em products passou (bypass de quota)'; end if;
  raise notice 'PASS - INSERT direto em products recusado (RLS/grant)';
end;
$t$;
rollback to savepoint bypass_dml;

-- 16. plan_key forjado: workspace_create_store nao aceita workspace nem
--     plano por parametro — deriva tudo de auth.uid(). Provado pela
--     assinatura da funcao (3 argumentos, nenhum de plano/workspace).
do $t$
declare v_args text;
begin
  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'workspace_create_store';
  if v_args ~* 'workspace|plan|limit|quota' then
    raise exception 'FAIL: workspace_create_store aceita parametro sensivel (%)', v_args;
  end if;
  raise notice 'PASS - workspace_create_store nao aceita workspace/plano por parametro (%)', v_args;
end;
$t$;

do $t$ begin raise notice 'OK: TODOS os casos de quota passaram'; end; $t$;

rollback;
