-- Validação manual das políticas de RLS contra Postgres real.
--
-- Este script NÃO foi executado nesta implementação: o ambiente de build
-- usado pelo Claude Code não tem Docker disponível, e `supabase start`
-- depende de Docker para subir o Postgres local. Os testes automatizados
-- do projeto (`npm test`) cobrem a camada de autorização server-side
-- (TypeScript) com a mesma matriz de casos, mas a validação das policies
-- de RLS em SQL real ainda precisa ser feita pelo QA.
--
-- Como rodar (requer Docker Desktop instalado e em execução):
--   1. npx supabase start
--   2. npx supabase db reset   (aplica supabase/migrations/0001_init.sql)
--   3. npm run seed:local      (cria Loja A, Loja B e usuários de teste)
--   4. psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -f supabase/tests/isolation_check.sql
--
-- O script simula cada usuário definindo request.jwt.claims (é assim que
-- auth.uid() resolve o usuário autenticado dentro do Postgres do Supabase).
-- Substitua os UUIDs abaixo pelos IDs reais gerados pelo seed
-- (`npm run seed:local` imprime os IDs de admin-a e admin-b no final).

\set admin_a_id 'SUBSTITUA_PELO_ID_ADMIN_A'
\set admin_b_id 'SUBSTITUA_PELO_ID_ADMIN_B'

-- ------------------------------------------------------------
-- Caso 1: Admin A lê produto da Loja A -> deve retornar 1 linha
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_a_id')::text, true);
select count(*) as esperado_1 from public.products p
  join public.stores s on s.id = p.store_id
  where s.slug = 'store-a';

-- ------------------------------------------------------------
-- Caso 2: Admin A tenta ler produto da Loja B -> deve retornar 0 linhas
-- ------------------------------------------------------------
select count(*) as esperado_0 from public.products p
  join public.stores s on s.id = p.store_id
  where s.slug = 'store-b';

-- ------------------------------------------------------------
-- Caso 3: Admin A tenta inserir produto na Loja B com store_id forjado
-- -> deve falhar (0 linhas afetadas / erro de RLS)
-- ------------------------------------------------------------
insert into public.products (store_id, name, stock)
  select id, 'Produto Forjado', 1 from public.stores where slug = 'store-b';

-- ------------------------------------------------------------
-- Caso 4: Anônimo (sem claims) não acessa nenhuma tabela
-- ------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select count(*) as esperado_0 from public.products;
select count(*) as esperado_0 from public.stores;

reset role;
