-- TASK-001 — Fundação do projeto e arquitetura multi-tenant
--
-- ESTADO: proposta técnica de Claude Code, destinada apenas a ambiente
-- local/dev (via `supabase start`). Não aplicar a ambiente compartilhado
-- ou produção sem revisão explícita de Caraffa (docs/SECURITY.md).
--
-- Princípio: negação por padrão. RLS é habilitada em toda tabela
-- multi-tenant e NENHUMA policy libera acesso a partir de um valor
-- fornecido pelo cliente (ex.: store_id em query/body). Toda autorização
-- deriva de auth.uid() cruzado com store_members no próprio banco.

create extension if not exists pgcrypto;

-- ============================================================
-- Tabelas
-- ============================================================

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.stores is
  'Uma loja (tenant). slug é usado apenas para roteamento público, nunca como prova de autorização.';

create table if not exists public.store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  unique (store_id, user_id)
);

comment on table public.store_members is
  'Vínculo autorizado entre usuário autenticado e loja. Única fonte de verdade para autorização de tenant. Papéis mínimos propostos: owner, admin, staff — sujeitos a revisão.';

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  stock integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

comment on table public.products is
  'Recurso de negócio mínimo usado para provar isolamento entre tenants. Catálogo completo está fora do escopo da TASK-001.';

create index if not exists store_members_user_id_idx on public.store_members (user_id);
create index if not exists products_store_id_idx on public.products (store_id);

-- ============================================================
-- Helpers de autorização (SECURITY DEFINER para evitar recursão de RLS
-- em store_members ao serem chamados a partir de outras tabelas)
-- ============================================================

create or replace function public.is_store_member(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.store_members sm
    where sm.store_id = target_store_id
      and sm.user_id = auth.uid()
  );
$$;

create or replace function public.is_store_admin(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.store_members sm
    where sm.store_id = target_store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_store_member(uuid) from public;
revoke all on function public.is_store_admin(uuid) from public;
grant execute on function public.is_store_member(uuid) to authenticated;
grant execute on function public.is_store_admin(uuid) to authenticated;

-- ============================================================
-- RLS — negação por padrão (RLS habilitada + nenhuma policy = negado)
-- ============================================================

alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.products enable row level security;

-- stores: um membro só enxerga as lojas das quais participa.
-- Criação/edição de loja fica fora do escopo desta tarefa (fluxo de
-- onboarding/superadmin futuro) — por isso não há policy de insert/update.
create policy stores_select_member
  on public.stores
  for select
  to authenticated
  using (public.is_store_member(id));

-- store_members: um usuário só enxerga os próprios vínculos (necessário
-- para o app resolver a que lojas ele pertence). Gestão de membros
-- (convite/remoção) fica fora do escopo desta tarefa.
create policy store_members_select_self
  on public.store_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- products: leitura para qualquer membro da loja; escrita restrita a
-- owner/admin. Nenhuma policy confia em store_id vindo do cliente — o
-- valor é sempre revalidado contra store_members no próprio predicate.
create policy products_select_member
  on public.products
  for select
  to authenticated
  using (public.is_store_member(store_id));

create policy products_insert_admin
  on public.products
  for insert
  to authenticated
  with check (public.is_store_admin(store_id));

create policy products_update_admin
  on public.products
  for update
  to authenticated
  using (public.is_store_admin(store_id))
  with check (public.is_store_admin(store_id));

create policy products_delete_admin
  on public.products
  for delete
  to authenticated
  using (public.is_store_admin(store_id));

-- Anônimo: nenhuma policy concede acesso a `anon` em nenhuma das três
-- tabelas acima — RLS habilitada + ausência de policy = negado por padrão.

-- ============================================================
-- Privilégios SQL mínimos (RETEST-BUG-001)
--
-- RLS decide QUAIS LINHAS uma consulta pode ver/alterar; o GRANT de
-- tabela decide SE a operação pode ao menos ser tentada. Sem o GRANT,
-- o Postgres nega antes de a policy ser avaliada ("permission denied
-- for table ..."), mesmo que a policy fosse permitir. Os dois
-- mecanismos são independentes e ambos necessários — daí os GRANTs
-- explícitos abaixo, no menor conjunto possível por papel.
--
-- Não presume privilégios implícitos concedidos pela plataforma
-- Supabase: o reteste em Postgres real (qa/reports/TASK-001-RETEST.md)
-- encontrou REFERENCES/TRIGGER/TRUNCATE já concedidos a anon,
-- authenticated e service_role nestas tabelas — via
-- `ALTER DEFAULT PRIVILEGES` da própria plataforma para toda tabela
-- nova, não algo desta migração —, nenhum deles suficiente para a
-- aplicação funcionar, e TRUNCATE em especial é perigoso: ignora RLS por
-- completo e apagaria a tabela inteira de uma vez, para qualquer usuário
-- autenticado. Por isso a primeira ação é revogar TUDO de PUBLIC e dos
-- três papéis nestas tabelas e conceder de volta apenas o necessário.
--
-- Sequences: não há colunas serial/identity nesta migração (todas as
-- chaves primárias são uuid + gen_random_uuid()), portanto não há
-- sequence para conceder privilégio.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

revoke all on public.stores, public.store_members, public.products
  from public, anon, authenticated, service_role;

-- anon: nenhum GRANT nestas tabelas. Não há storefront público nesta
-- fundação (TASK-001) — todo dado em stores/store_members/products é
-- privado ao painel administrativo. Se um catálogo público for
-- implementado em tarefa futura, a decisão de conceder SELECT a `anon`
-- (e as policies correspondentes) deve ser proposta e aprovada
-- separadamente, não assumida aqui.

-- authenticated: exatamente as operações com policy de RLS
-- correspondente acima — sem policy de escrita em stores/store_members,
-- não há motivo para conceder INSERT/UPDATE/DELETE nelas.
grant select on public.stores to authenticated;
grant select on public.store_members to authenticated;
grant select, insert, update, delete on public.products to authenticated;

-- service_role: uso administrativo/local (scripts/seed-local.ts),
-- nunca a partir de uma requisição de usuário — ver lib/supabase/admin.ts
-- e lib/supabase/env.ts. Tem BYPASSRLS na plataforma Supabase; ainda
-- assim precisa do GRANT de tabela para poder operar.
grant select, insert, update, delete
  on public.stores, public.store_members, public.products
  to service_role;
