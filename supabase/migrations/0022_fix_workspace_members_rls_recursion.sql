-- TASK-012 — QA final: corrige recursão infinita na RLS de
-- workspace_members.
--
-- O BUG
--
-- A policy criada em 0015 consultava a PRÓPRIA tabela:
--
--   create policy workspace_members_select_own on public.workspace_members
--     using ( user_id = auth.uid()
--             or exists (select 1 from public.workspace_members me
--                        where me.workspace_id = workspace_members.workspace_id
--                          and me.user_id = auth.uid()) );
--
-- Avaliar a policy exige ler workspace_members, o que exige avaliar a
-- policy, o que exige ler workspace_members... Postgres detecta e aborta
-- com "infinite recursion detected in policy for relation".
--
-- IMPACTO REAL (medido, não teórico)
--
--   select workspace_id from public.workspace_members where user_id = <eu>
--     -> ERROR: infinite recursion detected in policy
--
-- É exatamente a consulta de app/sessao-ativa/actions.ts, ou seja: o
-- botão "Encerrar outra sessão e entrar aqui" do plano Essencial estava
-- QUEBRADO. A policy de workspace_invitations também consulta
-- workspace_members, então a lista de convites pendentes de
-- Configurações -> Equipe caía junto.
--
-- Os testes SQL não pegaram porque rodam como `postgres`, que ignora
-- RLS. Só apareceu ao testar como `authenticated` de verdade.
--
-- A CORREÇÃO
--
-- O mesmo padrão que 0001 já usava para store_members: um helper
-- SECURITY DEFINER, que roda como dono e portanto NÃO reentra na policy.
-- O comentário de is_store_member em 0001 diz isso com todas as letras
-- ("SECURITY DEFINER para evitar recursão de RLS") — eu simplesmente não
-- segui o padrão ao criar a tabela nova.

-- ============================================================
-- 1. Helper sem recursão
-- ============================================================

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $fn$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$fn$;

comment on function public.is_workspace_member(uuid) is
  'A pessoa autenticada pertence a este workspace? SECURITY DEFINER de propósito: chamado de DENTRO das policies de workspace_members e workspace_invitations, precisa ler a tabela sem reentrar na própria policy — mesma razão de is_store_member (0001). Não concede nada: só responde sim/não sobre o auth.uid() atual.';

revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;

-- ============================================================
-- 2. workspace_members — policy sem auto-referência
-- ============================================================

drop policy if exists workspace_members_select_own on public.workspace_members;

create policy workspace_members_select_own on public.workspace_members
  for select to authenticated
  using (
    -- A própria linha: resolvido sem consultar a tabela.
    user_id = (select auth.uid())
    -- Colegas de workspace: via helper SECURITY DEFINER, que não reentra.
    or public.is_workspace_member(workspace_id)
  );

-- ============================================================
-- 3. workspace_invitations — mesma correção
-- ============================================================
--
-- A policy antiga fazia `exists (select 1 from workspace_members ...)`,
-- o que disparava a RLS de workspace_members e portanto a recursão.

drop policy if exists workspace_invitations_select_member on public.workspace_invitations;

create policy workspace_invitations_select_member on public.workspace_invitations
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ============================================================
-- 4. workspace_subscriptions e workspaces — simplificadas também
-- ============================================================
--
-- Não recursavam (consultam stores/store_members, não a si mesmas), mas
-- passam a usar o mesmo helper: uma regra só de "pertencer ao
-- workspace", em vez de três variações de EXISTS que precisariam ser
-- mantidas em sincronia.

drop policy if exists workspace_subscriptions_select_member on public.workspace_subscriptions;

create policy workspace_subscriptions_select_member on public.workspace_subscriptions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists workspaces_select_member on public.workspaces;

create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or public.is_workspace_member(id)
  );
