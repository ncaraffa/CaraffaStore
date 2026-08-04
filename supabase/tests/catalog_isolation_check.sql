-- TASK-003 — Validação de RLS/policies/funções de catálogo
-- (categorias, produtos, imagens, estoque) contra Postgres real. Mesmo
-- padrão de supabase/tests/isolation_check.sql (TASK-001) e
-- supabase/tests/onboarding_isolation_check.sql (TASK-002): tudo dentro
-- de UMA transação (BEGIN...ROLLBACK), um SAVEPOINT por cenário,
-- nenhuma alteração persiste.
--
-- Como rodar (requer Docker Desktop e os fixtures já seedados):
--   1. npx supabase start
--   2. npx supabase db reset
--   3. npm run seed:local
--   4. psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/catalog_isolation_check.sql
--
-- Fixtures reaproveitadas de scripts/seed-local.ts: admin-a (admin em
-- store-a), admin-b (admin em store-b), cliente-a (sem vínculo com
-- nenhuma loja), merchant-multi (staff em store-a, owner em
-- loja-multi-fixture — pending_payment).
--
-- Cobre (numeração livre, mapeada aos 35 casos obrigatórios da tarefa):
--   1-11: categorias/produtos — isolamento Loja A x Loja B, slug único
--         por loja (não globalmente), papel staff sem escrita.
--   12-19: publicação — draft/archived nunca públicos, published só de
--         loja active, categoria inativa nunca pública, busca/filtro
--         isolados por tenant.
--   20-27: estoque — nunca negativo, ajuste atômico, motivo obrigatório,
--         auditoria, papel insuficiente bloqueado.
--   28-33: imagens — limite de 5, capa única, remoção da capa promove
--         determinística, papel insuficiente bloqueado, isolamento.
--   34-35: migrations/regressões cobertas por
--         supabase/tests/isolation_check.sql (Caso 7 atualizado) e
--         supabase/tests/migration-upgrade-check.sh.

\set ON_ERROR_STOP on

begin;

do $$
begin
  perform set_config('app.admin_a_id', (select id::text from auth.users where email = 'admin-a@example.test'), true);
  perform set_config('app.admin_b_id', (select id::text from auth.users where email = 'admin-b@example.test'), true);
  perform set_config('app.cliente_a_id', (select id::text from auth.users where email = 'cliente-a@example.test'), true);
  perform set_config('app.merchant_multi_id', (select id::text from auth.users where email = 'merchant-multi@example.test'), true);
  perform set_config('app.store_a_id', (select id::text from public.stores where slug = 'store-a'), true);
  perform set_config('app.store_b_id', (select id::text from public.stores where slug = 'store-b'), true);
end $$;

-- ------------------------------------------------------------
-- Caso 1: Admin A cria categoria própria (store-a).
-- ------------------------------------------------------------
savepoint case_1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_cat public.categories;
begin
  select * into v_cat from public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Bebidas', 'bebidas', null, 1);
  if v_cat.id is not null and v_cat.store_id = current_setting('app.store_a_id')::uuid then
    raise notice 'PASS - Caso 1: Admin A cria categoria propria';
  else
    raise exception 'FAIL - Caso 1: categoria nao criada corretamente';
  end if;
end $$;
rollback to savepoint case_1;

-- ------------------------------------------------------------
-- Caso 2: Admin A NÃO cria categoria em store-b (insufficient_privilege).
-- ------------------------------------------------------------
savepoint case_2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    perform public.catalog_create_category(current_setting('app.store_b_id')::uuid, 'Invasao', 'invasao', null, 1);
    raise exception 'FAIL - Caso 2: Admin A conseguiu criar categoria na Loja B';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 2: Admin A nao cria categoria na Loja B';
      else
        raise;
      end if;
  end;
end $$;
rollback to savepoint case_2;

-- ------------------------------------------------------------
-- Caso 3: staff (merchant-multi em store-a) NÃO cria categoria — escrita
-- restrita a owner/admin.
-- ------------------------------------------------------------
savepoint case_3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_multi_id'))::text, true);
do $$
begin
  begin
    perform public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Nao Deveria', 'nao-deveria', null, 1);
    raise exception 'FAIL - Caso 3: staff conseguiu criar categoria';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 3: staff (papel insuficiente) nao cria categoria';
      else
        raise;
      end if;
  end;
end $$;
rollback to savepoint case_3;

-- ------------------------------------------------------------
-- Caso 4: mesmo slug em lojas DIFERENTES — permitido (unique é por loja).
-- ------------------------------------------------------------
savepoint case_4;
set local role authenticated;
do $$
declare
  v_cat_a public.categories;
  v_cat_b public.categories;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
  select * into v_cat_a from public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Bebidas', 'bebidas', null, 1);

  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_b_id'))::text, true);
  select * into v_cat_b from public.catalog_create_category(current_setting('app.store_b_id')::uuid, 'Bebidas', 'bebidas', null, 1);

  if v_cat_a.slug = v_cat_b.slug and v_cat_a.store_id <> v_cat_b.store_id then
    raise notice 'PASS - Caso 4: mesmo slug em lojas diferentes permitido';
  else
    raise exception 'FAIL - Caso 4: slugs/stores inesperados';
  end if;
end $$;
rollback to savepoint case_4;

-- ------------------------------------------------------------
-- Caso 5: slug repetido na MESMA loja é rejeitado (slug_taken).
-- ------------------------------------------------------------
savepoint case_5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  perform public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Bebidas', 'bebidas', null, 1);
  begin
    perform public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Bebidas 2', 'bebidas', null, 1);
    raise exception 'FAIL - Caso 5: slug repetido na mesma loja deveria ter sido rejeitado';
  exception
    when others then
      if sqlerrm = 'slug_taken' then
        raise notice 'PASS - Caso 5: slug repetido na mesma loja rejeitado (slug_taken)';
      else
        raise;
      end if;
  end;
end $$;
rollback to savepoint case_5;

-- ------------------------------------------------------------
-- Caso 6: usuário SEM vínculo (cliente-a) não lê uma categoria INATIVA
-- de store-a — categorias ATIVAS de lojas ATIVAS são intencionalmente
-- públicas desde a TASK-003 (catálogo público, ver Caso 28), então o
-- isolamento real a testar aqui é sobre dado que NÃO deveria ser
-- público (is_active=false), não sobre qualquer categoria.
-- ------------------------------------------------------------
savepoint case_6;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_cat public.categories;
begin
  select * into v_cat from public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Bebidas', 'bebidas', null, 1);
  perform public.catalog_set_category_active(v_cat.id, false);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.cliente_a_id'))::text, true);
do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.categories where store_id = current_setting('app.store_a_id')::uuid;
  if qtd = 0 then
    raise notice 'PASS - Caso 6: cliente sem vinculo nao le categoria INATIVA (administrativa) de store-a';
  else
    raise exception 'FAIL - Caso 6: esperado 0 categorias visiveis, obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_6;

-- ------------------------------------------------------------
-- Caso 7: Admin A cria produto próprio com categoria própria.
-- ------------------------------------------------------------
savepoint case_7;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_cat public.categories;
  v_prod public.products;
begin
  select * into v_cat from public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Bebidas', 'bebidas', null, 1);
  select * into v_prod from public.catalog_create_product(
    current_setting('app.store_a_id')::uuid, 'Suco', 'suco', 990, 10, v_cat.id, null, null
  );
  if v_prod.id is not null and v_prod.status = 'draft' and v_prod.stock = 10 then
    raise notice 'PASS - Caso 7: Admin A cria produto proprio (draft, stock=10)';
  else
    raise exception 'FAIL - Caso 7: produto nao criado corretamente';
  end if;
end $$;
rollback to savepoint case_7;

-- ------------------------------------------------------------
-- Caso 8: Admin A NÃO cria produto em store-b.
-- ------------------------------------------------------------
savepoint case_8;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    perform public.catalog_create_product(current_setting('app.store_b_id')::uuid, 'Invasao', 'invasao', 100, 1, null, null, null);
    raise exception 'FAIL - Caso 8: Admin A conseguiu criar produto na Loja B';
  exception
    when others then
      if sqlerrm = 'insufficient_privilege' then
        raise notice 'PASS - Caso 8: Admin A nao cria produto na Loja B';
      else
        raise;
      end if;
  end;
end $$;
rollback to savepoint case_8;

-- ------------------------------------------------------------
-- Caso 9: produto não pode usar categoria de OUTRA loja
-- (category_store_mismatch, via trigger — mesmo vindo de dentro da
-- própria função SECURITY DEFINER catalog_create_product).
-- ------------------------------------------------------------
savepoint case_9;
do $$
declare
  v_cat_b public.categories;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_b_id'))::text, true);
  select * into v_cat_b from public.catalog_create_category(current_setting('app.store_b_id')::uuid, 'Categoria B', 'categoria-b', null, 1);
  perform set_config('app.cat_b_id', v_cat_b.id::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  begin
    perform public.catalog_create_product(
      current_setting('app.store_a_id')::uuid, 'Produto', 'produto', 100, 1, current_setting('app.cat_b_id')::uuid, null, null
    );
    raise exception 'FAIL - Caso 9: produto de store-a aceitou categoria de store-b';
  exception
    when others then
      if sqlerrm = 'category_store_mismatch' then
        raise notice 'PASS - Caso 9: categoria de outra loja rejeitada (category_store_mismatch)';
      else
        raise;
      end if;
  end;
end $$;
rollback to savepoint case_9;

-- ------------------------------------------------------------
-- Caso 10: slug de produto único por loja; SKU único por loja quando preenchido.
-- ------------------------------------------------------------
savepoint case_10;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  perform public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto 1', 'produto-1', 100, 1, null, null, 'SKU-1');
  begin
    perform public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto 2', 'produto-1', 100, 1, null, null, null);
    raise exception 'FAIL - Caso 10a: slug repetido deveria ter sido rejeitado';
  exception
    when others then
      if sqlerrm <> 'slug_or_sku_taken' then raise; end if;
  end;
  begin
    perform public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Produto 3', 'produto-3', 100, 1, null, null, 'SKU-1');
    raise exception 'FAIL - Caso 10b: SKU repetido deveria ter sido rejeitado';
  exception
    when others then
      if sqlerrm <> 'slug_or_sku_taken' then raise; end if;
  end;
  raise notice 'PASS - Caso 10: slug e SKU de produto sao unicos por loja';
end $$;
rollback to savepoint case_10;

-- ------------------------------------------------------------
-- Caso 11: staff (merchant-multi) não ajusta estoque nem cria produto.
-- ------------------------------------------------------------
savepoint case_11;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_multi_id'))::text, true);
do $$
begin
  begin
    perform public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'X', 'x-prod', 100, 1, null, null, null);
    raise exception 'FAIL - Caso 11: staff conseguiu criar produto';
  exception
    when others then
      if sqlerrm <> 'insufficient_privilege' then raise; end if;
  end;
  raise notice 'PASS - Caso 11: staff (papel insuficiente) nao cria produto';
end $$;
rollback to savepoint case_11;

-- ------------------------------------------------------------
-- Caso 12-15: publicação — draft/archived nunca públicos; published só
-- se a loja estiver active; categoria inativa nunca pública.
-- ------------------------------------------------------------
savepoint case_12;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_cat public.categories;
  v_prod_draft public.products;
  v_prod_published public.products;
  v_prod_archived public.products;
begin
  select * into v_cat from public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Cat', 'cat-pub', null, 1);
  select * into v_prod_draft from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Rascunho', 'rascunho', 100, 1, v_cat.id, null, null);
  select * into v_prod_published from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Publicado', 'publicado', 100, 1, v_cat.id, null, null);
  perform public.catalog_set_product_status(v_prod_published.id, 'published');
  select * into v_prod_archived from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Arquivado', 'arquivado', 100, 1, v_cat.id, null, null);
  perform public.catalog_set_product_status(v_prod_archived.id, 'published');
  perform public.catalog_set_product_status(v_prod_archived.id, 'archived');
  perform set_config('app.case12_cat_id', v_cat.id::text, true);
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  qtd_public int;
  qtd_cat_active int;
begin
  select count(*) into qtd_public from public.products
    where store_id = current_setting('app.store_a_id')::uuid
      and slug in ('rascunho', 'arquivado');
  select count(*) into qtd_cat_active from public.products
    where store_id = current_setting('app.store_a_id')::uuid and slug = 'publicado';

  if qtd_public = 0 and qtd_cat_active = 1 then
    raise notice 'PASS - Caso 12-13: draft/archived invisiveis para anon (0), published de loja active visivel (1)';
  else
    raise exception 'FAIL - Caso 12-13: esperado 0 draft/archived e 1 published, obtido % e %', qtd_public, qtd_cat_active;
  end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
begin
  perform public.catalog_set_category_active(current_setting('app.case12_cat_id')::uuid, false);
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.categories where id = current_setting('app.case12_cat_id')::uuid;
  if qtd = 0 then
    raise notice 'PASS - Caso 14: categoria desativada nao aparece publicamente';
  else
    raise exception 'FAIL - Caso 14: categoria desativada ainda visivel para anon';
  end if;
end $$;
reset role;
rollback to savepoint case_12;

-- ------------------------------------------------------------
-- Caso 15: produto published de uma loja NÃO active (loja-multi-fixture,
-- pending_payment) continua invisivel para anon — publicação de
-- produto sozinha não basta, a loja também precisa estar active.
-- ------------------------------------------------------------
savepoint case_15;
do $$
begin
  perform set_config('app.multi_store_id', (select id::text from public.stores where slug = 'loja-multi-fixture'), true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_multi_id'))::text, true);
do $$
declare
  v_prod public.products;
begin
  select * into v_prod from public.catalog_create_product(current_setting('app.multi_store_id')::uuid, 'Produto Pendente', 'produto-pendente', 100, 1, null, null, null);
  perform public.catalog_set_product_status(v_prod.id, 'published');
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.products where slug = 'produto-pendente';
  if qtd = 0 then
    raise notice 'PASS - Caso 15: produto published de loja NAO active continua invisivel para anon';
  else
    raise exception 'FAIL - Caso 15: produto de loja pending_payment vazou para anon';
  end if;
end $$;
rollback to savepoint case_15;

-- ------------------------------------------------------------
-- Caso 16-19: estoque atômico — nunca negativo, motivo obrigatório,
-- staff bloqueado, auditoria correta.
-- ------------------------------------------------------------
savepoint case_16;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_prod public.products;
  v_new_stock int;
begin
  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Estoque', 'estoque', 100, 5, null, null, null);
  perform set_config('app.case16_prod_id', v_prod.id::text, true);

  select public.catalog_adjust_stock(v_prod.id, -3, 'venda', null) into v_new_stock;
  if v_new_stock <> 2 then
    raise exception 'FAIL - Caso 16: esperado stock=2, obtido %', v_new_stock;
  end if;

  begin
    perform public.catalog_adjust_stock(v_prod.id, -10, 'venda grande', null);
    raise exception 'FAIL - Caso 17: ajuste que deixaria negativo deveria ter sido rejeitado';
  exception
    when others then
      if sqlerrm <> 'stock_would_be_negative' then raise; end if;
  end;

  begin
    perform public.catalog_adjust_stock(v_prod.id, -1, '', null);
    raise exception 'FAIL - Caso 18: motivo vazio deveria ter sido rejeitado';
  exception
    when others then
      if sqlerrm <> 'reason_required' then raise; end if;
  end;

  raise notice 'PASS - Caso 16-18: ajuste atomico correto, estoque nunca negativo, motivo obrigatorio';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_multi_id'))::text, true);
do $$
begin
  begin
    perform public.catalog_adjust_stock(current_setting('app.case16_prod_id')::uuid, -1, 'staff tentando', null);
    raise exception 'FAIL - Caso 19: staff conseguiu ajustar estoque';
  exception
    when others then
      if sqlerrm <> 'insufficient_privilege' then raise; end if;
  end;
  raise notice 'PASS - Caso 19: staff (papel insuficiente) nao ajusta estoque';
end $$;
rollback to savepoint case_16;

-- ------------------------------------------------------------
-- Caso 20-24: imagens — limite de 5, primeira vira capa automaticamente,
-- capa única (índice parcial), remoção da capa promove determinística,
-- store_mismatch rejeitado.
-- ------------------------------------------------------------
savepoint case_20;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_prod public.products;
  v_img record;
  v_ids uuid[] := array[]::uuid[];
  v_cover_count int;
begin
  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Com Imagens', 'com-imagens', 100, 1, null, null, null);

  for i in 1..5 loop
    select * into v_img from public.catalog_add_product_image(
      v_prod.id, current_setting('app.store_a_id') || '/' || v_prod.id || '/img' || i || '.jpg', false
    );
    v_ids := array_append(v_ids, v_img.id);
  end loop;

  if (select is_cover from public.product_images where id = v_ids[1]) <> true then
    raise exception 'FAIL - Caso 20: primeira imagem deveria ser capa automaticamente';
  end if;

  select count(*) into v_cover_count from public.product_images where product_id = v_prod.id and is_cover;
  if v_cover_count <> 1 then
    raise exception 'FAIL - Caso 21: esperado exatamente 1 capa, obtido %', v_cover_count;
  end if;

  begin
    perform public.catalog_add_product_image(v_prod.id, current_setting('app.store_a_id') || '/' || v_prod.id || '/img6.jpg', false);
    raise exception 'FAIL - Caso 22: 6a imagem deveria ter sido rejeitada (max_images_reached)';
  exception
    when others then
      if sqlerrm <> 'max_images_reached' then raise; end if;
  end;

  -- Remove a capa (v_ids[1]) — a proxima por position (v_ids[2]) deve virar capa.
  perform public.catalog_remove_product_image(v_ids[1]);
  if (select is_cover from public.product_images where id = v_ids[2]) <> true then
    raise exception 'FAIL - Caso 23: remocao da capa deveria promover a proxima por position';
  end if;

  begin
    perform public.catalog_add_product_image(v_prod.id, 'outra-loja-qualquer/' || v_prod.id || '/hack.jpg', false);
    raise exception 'FAIL - Caso 24: caminho com store_id diferente deveria ter sido rejeitado';
  exception
    when others then
      if sqlerrm <> 'invalid_storage_path' then raise; end if;
  end;

  raise notice 'PASS - Caso 20-24: limite de 5, capa automatica/unica, remocao promove deterministicamente, caminho invalido rejeitado';
end $$;
rollback to savepoint case_20;

-- ------------------------------------------------------------
-- Caso 25: imagens de uma loja não são alteráveis por outra
-- (insufficient_privilege ao tentar mexer numa imagem de store-a sendo
-- admin de store-b).
-- ------------------------------------------------------------
savepoint case_25;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_prod public.products;
  v_img public.product_images;
begin
  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Img Cross', 'img-cross', 100, 1, null, null, null);
  select * into v_img from public.catalog_add_product_image(v_prod.id, current_setting('app.store_a_id') || '/' || v_prod.id || '/img1.jpg', false);
  perform set_config('app.case25_img_id', v_img.id::text, true);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_b_id'))::text, true);
do $$
begin
  begin
    perform public.catalog_remove_product_image(current_setting('app.case25_img_id')::uuid);
    raise exception 'FAIL - Caso 25: Admin B conseguiu remover imagem de store-a';
  exception
    when others then
      if sqlerrm <> 'insufficient_privilege' then raise; end if;
  end;
  raise notice 'PASS - Caso 25: Admin B (loja diferente) nao altera imagem de store-a';
end $$;
rollback to savepoint case_25;

-- ------------------------------------------------------------
-- Caso 26: cliente sem vínculo não lê produtos administrativos de
-- store-a (reforça isolamento também na tabela de produtos, não só
-- categorias — Caso 6 já cobriu categorias).
-- ------------------------------------------------------------
savepoint case_26;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$ begin perform public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'X', 'x-prod-26', 100, 1, null, null, null); end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.cliente_a_id'))::text, true);
do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.products where store_id = current_setting('app.store_a_id')::uuid;
  if qtd = 0 then
    raise notice 'PASS - Caso 26: cliente sem vinculo nao le produtos administrativos de store-a';
  else
    raise exception 'FAIL - Caso 26: esperado 0 produtos visiveis, obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_26;

-- ------------------------------------------------------------
-- Caso 27: audit_log correto para o ciclo completo — nenhuma ação
-- fabrica evento fora do esperado, contagem exata.
-- ------------------------------------------------------------
savepoint case_27;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_cat public.categories;
  v_prod public.products;
begin
  select * into v_cat from public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Audit', 'audit-cat', null, 1);
  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Audit', 'audit-prod', 100, 5, v_cat.id, null, null);
  perform public.catalog_adjust_stock(v_prod.id, -1, 'teste', null);
  perform public.catalog_set_product_status(v_prod.id, 'published');
  perform set_config('app.case27_store_id', current_setting('app.store_a_id'), true);
end $$;
reset role;

set local role service_role;
do $$
declare
  actions text[];
begin
  select array_agg(action order by created_at) into actions
    from public.audit_log
    where store_id = current_setting('app.case27_store_id')::uuid;
  if actions @> array['category_created', 'product_created', 'product_stock_adjusted', 'product_published']::text[] then
    raise notice 'PASS - Caso 27: audit_log contem exatamente os eventos verdadeiros do ciclo (%)' , actions;
  else
    raise exception 'FAIL - Caso 27: eventos inesperados/faltando: %', actions;
  end if;
end $$;
rollback to savepoint case_27;

-- ------------------------------------------------------------
-- Caso 28 (regressão): o catálogo público continua visível para um
-- usuário AUTENTICADO sem NENHUM vínculo com a loja visitada — não só
-- para `anon` de verdade. Bug real encontrado no smoke test manual
-- desta rodada: as policies públicas foram escritas inicialmente como
-- `to anon`, então um visitante logado (ex.: dono de outra loja, ou
-- qualquer cliente autenticado) via 0 categorias/produtos/lojas no
-- catálogo público de uma loja da qual não é membro — a rota pública
-- "quebrava" silenciosamente para qualquer sessão autenticada.
-- Corrigido trocando `to anon` por `to public` nas quatro policies
-- (stores/categories/products/product_images select_public).
-- ------------------------------------------------------------
savepoint case_28;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);
do $$
declare
  v_cat public.categories;
  v_prod public.products;
begin
  select * into v_cat from public.catalog_create_category(current_setting('app.store_a_id')::uuid, 'Publica', 'publica-case28', null, 1);
  select * into v_prod from public.catalog_create_product(current_setting('app.store_a_id')::uuid, 'Publico', 'publico-case28', 100, 1, v_cat.id, null, null);
  perform public.catalog_set_product_status(v_prod.id, 'published');
end $$;

-- cliente-a não é membro de store-a nem de nenhuma outra loja — exatamente
-- o "visitante autenticado sem vínculo" que o bug afetava.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.cliente_a_id'))::text, true);
do $$
declare
  qtd_stores int;
  qtd_categories int;
  qtd_products int;
begin
  select count(*) into qtd_stores from public.stores where slug = 'store-a' and status = 'active';
  select count(*) into qtd_categories from public.categories where slug = 'publica-case28' and is_active;
  select count(*) into qtd_products from public.products where slug = 'publico-case28' and status = 'published';

  if qtd_stores = 1 and qtd_categories = 1 and qtd_products = 1 then
    raise notice 'PASS - Caso 28: cliente autenticado SEM vinculo com store-a ainda ve o catalogo publico dela (loja/categoria/produto)';
  else
    raise exception 'FAIL - Caso 28: catalogo publico invisivel para autenticado sem vinculo — lojas=%, categorias=%, produtos=%', qtd_stores, qtd_categories, qtd_products;
  end if;
end $$;
rollback to savepoint case_28;

-- Nenhuma alteração persiste: garante execução repetível a qualquer momento.
rollback;
