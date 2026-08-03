-- Validação manual das políticas de RLS contra Postgres real.
--
-- Executado e validado por Claude Code contra Supabase/Postgres local real
-- (Docker) em 2026-08-02, duas vezes seguidas, 7/7 PASS em ambas — ver
-- docs/HANDOFF.md para o log completo. Antes disso, o script tinha dois
-- problemas encontrados por QA em rodadas anteriores, ambos corrigidos:
--
--   * BUG-002 (qa/reports/TASK-001.md): `SET LOCAL ROLE` fora de
--     transação explícita era revertido a cada statement em modo
--     autocommit — as consultas rodavam como `postgres` (superusuário,
--     ignora RLS) em vez de `authenticated`/`anon`. Corrigido com
--     BEGIN/SAVEPOINT/ROLLBACK TO SAVEPOINT (ver estrutura abaixo).
--   * RETEST-BUG-001 (qa/reports/TASK-001-RETEST.md): mesmo com a
--     transação corrigida, o Caso 1 falhava com
--     "permission denied for table products" — a migração criava RLS e
--     policies mas nunca concedia os GRANTs de tabela (SELECT/INSERT/
--     UPDATE/DELETE) a `authenticated`/`service_role`. RLS só filtra
--     LINHAS; sem o GRANT, o Postgres nega a operação inteira antes de
--     chegar a avaliar qualquer policy. Corrigido em
--     supabase/migrations/0001_init.sql (seção "Privilégios SQL
--     mínimos").
--
-- Como rodar (requer Docker Desktop instalado e em execução):
--   1. npx supabase start
--   2. npx supabase db reset   (aplica supabase/migrations/0001_init.sql)
--   3. npm run seed:local      (cria Loja A, Loja B e usuários de teste)
--   4. psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/isolation_check.sql
--
-- O script simula cada usuário definindo request.jwt.claims (é assim que
-- auth.uid() resolve o usuário autenticado dentro do Postgres do Supabase).
-- Substitua os UUIDs abaixo pelos IDs reais gerados pelo seed
-- (`npm run seed:local` imprime os IDs de admin-a, admin-b e cliente-a
-- no final).
--
-- Estrutura:
--
--   * Todo o script roda dentro de UMA transação (BEGIN ... ROLLBACK no
--     final), então nenhuma alteração (incluindo as tentativas de insert
--     forjado dos Casos 3 e 5) persiste no banco, em nenhuma hipótese —
--     script repetível a qualquer momento, sem estado residual.
--   * Cada cenário usa um SAVEPOINT próprio. `SET LOCAL ROLE` e
--     `set_config(..., true)` são transacionais e revertem no
--     `ROLLBACK TO SAVEPOINT` seguinte — o papel/JWT de um cenário nunca
--     vaza para o próximo.
--   * Cada cenário imprime `current_user`/`auth.uid()` antes das
--     consultas (confirma que o papel realmente foi aplicado) e um
--     PASS/FAIL explícito via `RAISE NOTICE`/`RAISE EXCEPTION`.
--   * Com `-v ON_ERROR_STOP=1` (ou `\set ON_ERROR_STOP on`, já incluso
--     abaixo), qualquer FAIL interrompe o script imediatamente com saída
--     não-zero.
--
-- 7 cenários: (1) leitura própria loja, (2) leitura cross-tenant A→B
-- negada, (3) escrita cross-tenant A→B negada (store_id forjado),
-- (4) leitura cross-tenant B→A negada, (5) escrita cross-tenant B→A
-- negada (store_id forjado, simetria do 3), (6) autenticado sem vínculo
-- de staff negado, (7) anônimo negado.

\set ON_ERROR_STOP on

\set admin_a_id 'SUBSTITUA_PELO_ID_ADMIN_A'
\set admin_b_id 'SUBSTITUA_PELO_ID_ADMIN_B'
\set cliente_a_id 'SUBSTITUA_PELO_ID_CLIENTE_A'

begin;

-- ------------------------------------------------------------
-- Caso 1: Admin A lê produto da Loja A -> deve retornar 1 linha
-- ------------------------------------------------------------
savepoint case_1;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_a_id')::text, true);
select current_user as papel_ativo, auth.uid() as uid_resolvido;

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.products p
    join public.stores s on s.id = p.store_id
    where s.slug = 'store-a';

  if qtd = 1 then
    raise notice 'PASS - Caso 1: Admin A le produto(s) da propria loja (esperado 1, obtido %)', qtd;
  else
    raise exception 'FAIL - Caso 1: esperado 1 produto em store-a, obtido %', qtd;
  end if;
end $$;

rollback to savepoint case_1;

-- ------------------------------------------------------------
-- Caso 2: Admin A tenta ler produto da Loja B -> deve retornar 0 linhas
-- ------------------------------------------------------------
savepoint case_2;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_a_id')::text, true);
select current_user as papel_ativo, auth.uid() as uid_resolvido;

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.products p
    join public.stores s on s.id = p.store_id
    where s.slug = 'store-b';

  if qtd = 0 then
    raise notice 'PASS - Caso 2: Admin A nao le produtos da Loja B (esperado 0, obtido %)', qtd;
  else
    raise exception 'FAIL - Caso 2: esperado 0 produtos visiveis de store-b para Admin A, obtido %', qtd;
  end if;
end $$;

rollback to savepoint case_2;

-- ------------------------------------------------------------
-- Caso 3: Admin A tenta inserir produto na Loja B (store_id forjado)
-- -> deve ser bloqueado pela policy de RLS (insufficient_privilege)
-- ------------------------------------------------------------
savepoint case_3;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_a_id')::text, true);
select current_user as papel_ativo, auth.uid() as uid_resolvido;

do $$
declare
  target_store uuid;
begin
  select id into target_store from public.stores where slug = 'store-b';

  begin
    insert into public.products (store_id, name, stock)
      values (target_store, 'Produto Forjado', 1);

    raise exception 'FAIL - Caso 3: insercao de Admin A na Loja B deveria ter sido bloqueada por RLS, mas foi aceita';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 3: RLS bloqueou insercao de Admin A na Loja B com store_id forjado';
  end;
end $$;

rollback to savepoint case_3;

-- ------------------------------------------------------------
-- Caso 4: Admin B tenta ler produto da Loja A -> deve retornar 0 linhas
-- (simetria do Caso 2, prova que o isolamento não é de mão única)
-- ------------------------------------------------------------
savepoint case_4;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_b_id')::text, true);
select current_user as papel_ativo, auth.uid() as uid_resolvido;

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.products p
    join public.stores s on s.id = p.store_id
    where s.slug = 'store-a';

  if qtd = 0 then
    raise notice 'PASS - Caso 4: Admin B nao le produtos da Loja A (esperado 0, obtido %)', qtd;
  else
    raise exception 'FAIL - Caso 4: esperado 0 produtos visiveis de store-a para Admin B, obtido %', qtd;
  end if;
end $$;

rollback to savepoint case_4;

-- ------------------------------------------------------------
-- Caso 5: Admin B tenta inserir produto na Loja A (store_id forjado)
-- -> deve ser bloqueado pela policy de RLS (simetria do Caso 3: prova
-- que o bloqueio de escrita cross-tenant não é de mão única)
-- ------------------------------------------------------------
savepoint case_5;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_b_id')::text, true);
select current_user as papel_ativo, auth.uid() as uid_resolvido;

do $$
declare
  target_store uuid;
begin
  select id into target_store from public.stores where slug = 'store-a';

  begin
    insert into public.products (store_id, name, stock)
      values (target_store, 'Produto Forjado B em A', 1);

    raise exception 'FAIL - Caso 5: insercao de Admin B na Loja A deveria ter sido bloqueada por RLS, mas foi aceita';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 5: RLS bloqueou insercao de Admin B na Loja A com store_id forjado';
  end;
end $$;

rollback to savepoint case_5;

-- ------------------------------------------------------------
-- Caso 6: usuário autenticado SEM vínculo de staff (cliente-a) não lê
-- produtos de Loja A -> prova que RLS exige membership real em
-- store_members, não apenas uma sessão autenticada válida
-- ------------------------------------------------------------
savepoint case_6;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'cliente_a_id')::text, true);
select current_user as papel_ativo, auth.uid() as uid_resolvido;

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.products p
    join public.stores s on s.id = p.store_id
    where s.slug = 'store-a';

  if qtd = 0 then
    raise notice 'PASS - Caso 6: cliente autenticado sem vinculo nao le produtos da Loja A (esperado 0, obtido %)', qtd;
  else
    raise exception 'FAIL - Caso 6: esperado 0 produtos visiveis de store-a para usuario sem vinculo, obtido %', qtd;
  end if;
end $$;

rollback to savepoint case_6;

-- ------------------------------------------------------------
-- Caso 7: Anônimo (sem claims) não acessa nenhuma tabela
-- Trata tanto bloqueio por ausência de GRANT quanto bloqueio por RLS
-- como PASS — em ambos os casos o resultado é "nenhum dado visível".
-- ------------------------------------------------------------
savepoint case_7;

set local role anon;
select set_config('request.jwt.claims', '', true);
select current_user as papel_ativo;

do $$
declare
  qtd_products int;
  qtd_stores int;
begin
  begin
    select count(*) into qtd_products from public.products;
  exception when insufficient_privilege then
    qtd_products := 0;
  end;

  begin
    select count(*) into qtd_stores from public.stores;
  exception when insufficient_privilege then
    qtd_stores := 0;
  end;

  if qtd_products = 0 and qtd_stores = 0 then
    raise notice 'PASS - Caso 7: anonimo nao ve produtos nem lojas (0 e 0)';
  else
    raise exception 'FAIL - Caso 7: anonimo deveria ver 0 produtos e 0 lojas, obteve % produtos e % lojas', qtd_products, qtd_stores;
  end if;
end $$;

rollback to savepoint case_7;

-- Nenhuma alteração persiste: garante execução repetível a qualquer momento.
rollback;
