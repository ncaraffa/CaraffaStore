-- TASK-012 commit 3 (parte 1) — Equipe do workspace.
--
-- POR QUE store_members NÃO PODE SER O ASSENTO
--
-- Auditoria antes de modelar (o mesmo erro de escopo que corrigimos no
-- billing seria fácil de repetir aqui):
--
--   * store_members tem unique (store_id, user_id) — a identidade é
--     (loja, pessoa), não pessoa. Uma pessoa com acesso a 3 lojas são
--     TRÊS linhas.
--   * ela é a espinha dorsal da autorização: is_store_member,
--     is_store_admin e can_manage_store_catalog são referenciadas 58
--     vezes em 14 migrations, além de /select-store e da resolução de
--     tenant na aplicação.
--
-- Logo:
--   count(store_members) <= 10  contaria a MESMA pessoa 3 vezes num
--                               Profissional com 3 lojas;
--   10 por loja                 permitiria 30 pessoas no workspace.
--
-- Nenhum dos dois é o limite comercial. O assento é do WORKSPACE:
--
--   workspace_members  -> LICENÇA (quantas pessoas o plano permite)
--   store_members      -> ACESSO   (projeção: quais lojas a pessoa opera)
--
-- Mantendo store_members como projeção, toda a RLS existente continua
-- valendo sem uma linha alterada — o que é a diferença entre uma
-- mudança segura e reescrever 58 pontos de autorização.
--
-- V1 de acesso (explicitamente pedido): um Member do workspace opera
-- TODAS as lojas do workspace. ACL por loja (Maria só na Loja A) fica
-- para uma feature futura; o modelo aqui já comporta isso sem migração
-- destrutiva, bastando deixar de sincronizar todas as lojas.

-- ============================================================
-- 0. audit_log_action_check — só ALARGA
-- ============================================================
--
-- Mesma disciplina de 0010/0011: a constraint NUNCA remove um valor já
-- aceito (isso quebraria linhas históricas num banco populado — a lição
-- do BUG-RT2-006). Aqui ela só ganha os eventos de equipe.

alter table public.audit_log drop constraint audit_log_action_check;

alter table public.audit_log add constraint audit_log_action_check check (action in (
  'signup_completed', 'email_verification_completed', 'password_recovery_requested',
  'password_recovery_completed', 'store_created', 'owner_assigned', 'plan_selected',
  'onboarding_completed', 'access_denied',
  'category_created', 'category_updated', 'category_activated', 'category_deactivated',
  'product_created', 'product_updated', 'product_published', 'product_unpublished',
  'product_archived', 'product_image_added', 'product_image_removed', 'product_image_reordered',
  'product_cover_changed', 'stock_adjusted',
  'order_created', 'order_status_changed', 'order_cancelled', 'order_stock_reserved',
  'order_stock_restored',
  'payment_settings_configured', 'payment_settings_disabled',
  'pix_payment_creation_started', 'pix_payment_created', 'pix_payment_approved',
  'pix_payment_rejected', 'pix_payment_cancelled', 'pix_payment_expired',
  'pix_payment_reconciliation_failed', 'order_confirmed_by_payment',
  'order_cancelled_by_payment_failure', 'payment_manual_review_required',
  'billing_charge_creation_started', 'billing_charge_created', 'billing_charge_approved',
  'billing_charge_rejected', 'billing_charge_cancelled', 'billing_charge_expired',
  'billing_manual_review_required', 'store_activated_by_billing',
  'billing_subscription_renewed', 'store_suspended_by_platform_admin',
  'store_reactivated_by_platform_admin', 'store_suspended_by_billing_overdue',
  'store_reactivated_by_billing', 'plan_changed_by_billing',
  -- TASK-012 commit 3 — equipe e sessão
  'member_invited', 'member_joined', 'member_removed', 'member_invitation_revoked',
  'session_created', 'session_revoked'
));

comment on constraint audit_log_action_check on public.audit_log is
  'Conjunto fechado de eventos auditáveis. Só ALARGA — remover um valor quebraria linhas históricas de um banco já populado (BUG-RT2-006). TASK-012 acrescenta os eventos de equipe e de sessão.';

-- ============================================================
-- 1. workspace_members — o assento, com identidade de PESSOA
-- ============================================================

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- UMA linha por pessoa por workspace: é isto que faz o assento ser
  -- por pessoa e não por (pessoa, loja).
  unique (workspace_id, user_id)
);

comment on table public.workspace_members is
  'Assento/licença de equipe — a unidade que o plano limita (Essencial 1, Crescimento 3, Profissional 10, SEMPRE incluindo o owner). Identidade é a PESSOA no workspace, nunca (pessoa, loja): um Profissional com 3 lojas continua limitado a 10 pessoas, não 30. store_members permanece como projeção de ACESSO e continua sendo o que a RLS lê.';

comment on column public.workspace_members.role is
  'V1 deliberadamente mínima: owner | member. Um member opera todas as lojas do workspace. Permissão granular por loja é feature futura — o modelo comporta sem migração destrutiva.';

create index workspace_members_user_idx on public.workspace_members (user_id);
create index workspace_members_workspace_idx on public.workspace_members (workspace_id);

-- Exatamente um owner por workspace, garantido pelo banco.
create unique index workspace_members_single_owner
  on public.workspace_members (workspace_id)
  where role = 'owner';

-- Backfill: quem é owner de alguma loja do workspace vira owner do
-- workspace; os demais vínculos viram member. distinct on garante uma
-- linha por pessoa mesmo quando ela já aparece em várias lojas — o
-- exato bug de contagem dupla que esta tabela existe para evitar.
insert into public.workspace_members (workspace_id, user_id, role, joined_at)
select distinct on (s.workspace_id, sm.user_id)
  s.workspace_id,
  sm.user_id,
  case when bool_or(sm.role = 'owner') over (partition by s.workspace_id, sm.user_id)
       then 'owner' else 'member' end,
  min(sm.created_at) over (partition by s.workspace_id, sm.user_id)
from public.store_members sm
join public.stores s on s.id = sm.store_id
order by s.workspace_id, sm.user_id;

alter table public.workspace_members enable row level security;

-- Quem é do workspace enxerga a equipe do workspace. Deny-by-default
-- para escrita: nenhuma policy de insert/update/delete.
create policy workspace_members_select_own on public.workspace_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.workspace_members me
      where me.workspace_id = workspace_members.workspace_id
        and me.user_id = (select auth.uid())
    )
  );

grant select on public.workspace_members to authenticated;

-- ============================================================
-- 2. Helpers de assento
-- ============================================================

create or replace function public.workspace_seat_count(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::integer from public.workspace_members where workspace_id = p_workspace_id;
$fn$;

comment on function public.workspace_seat_count(uuid) is
  'Pessoas distintas com acesso ao workspace, INCLUINDO o owner. É a contagem que o plano limita — nunca count(store_members), que contaria a mesma pessoa uma vez por loja.';

revoke all on function public.workspace_seat_count(uuid) from public;
grant execute on function public.workspace_seat_count(uuid) to authenticated, service_role;

create or replace function public.user_workspace_id(p_user_id uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select workspace_id from public.workspace_members
  where user_id = coalesce(p_user_id, auth.uid())
  limit 1;
$fn$;

revoke all on function public.user_workspace_id(uuid) from public;
grant execute on function public.user_workspace_id(uuid) to authenticated, service_role;

-- ============================================================
-- 3. Projeção de acesso: workspace_members -> store_members
-- ============================================================
--
-- V1: todo member opera todas as lojas do workspace. Um único ponto faz
-- essa projeção, chamado quando entra membro E quando nasce loja nova —
-- assim as duas direções ficam coerentes sem lógica duplicada.

create or replace function public.workspace_sync_store_access(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Toda pessoa do workspace ganha vínculo em toda loja do workspace.
  -- O papel em store_members mapeia o papel do workspace: owner -> owner,
  -- member -> admin (o papel de operação do catálogo já existente).
  insert into public.store_members (store_id, user_id, role)
  select s.id, wm.user_id,
         case when wm.role = 'owner' then 'owner' else 'admin' end
  from public.stores s
  join public.workspace_members wm on wm.workspace_id = s.workspace_id
  where s.workspace_id = p_workspace_id
  on conflict (store_id, user_id) do nothing;

  -- Quem saiu do workspace perde acesso a TODAS as lojas dele, na mesma
  -- transação. É o que faz "remover membro" revogar de verdade.
  delete from public.store_members sm
  using public.stores s
  where sm.store_id = s.id
    and s.workspace_id = p_workspace_id
    and not exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = p_workspace_id and wm.user_id = sm.user_id
    );
end;
$fn$;

comment on function public.workspace_sync_store_access(uuid) is
  'Projeta os assentos do workspace sobre store_members (V1: member opera todas as lojas). Chamada ao entrar/sair membro e ao criar loja. O DELETE é a metade que importa para segurança: sair do workspace remove o acesso a todas as lojas dele na mesma transação, sem depender de a aplicação lembrar.';

revoke all on function public.workspace_sync_store_access(uuid) from public;
grant execute on function public.workspace_sync_store_access(uuid) to service_role;

-- ============================================================
-- 4. Convites
-- ============================================================

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- NUNCA o token em claro: só o SHA-256. Um vazamento desta tabela não
  -- permite aceitar convite nenhum.
  token_hash text not null unique,
  role text not null default 'member' check (role in ('member')),
  invited_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.workspace_invitations is
  'Convite de equipe. O token viaja por e-mail e NUNCA é persistido em claro — só token_hash (SHA-256). Single-use: aceitar move status para accepted e nenhum caminho volta para pending. Consumir um assento acontece na MESMA transação da aceitação, com o workspace travado, para que dois aceites simultâneos não estourem o plano.';

comment on column public.workspace_invitations.role is
  'V1 só convida member — owner não se transfere por convite (exigiria fluxo próprio de transferência de propriedade, fora do escopo desta versão).';

create index workspace_invitations_workspace_idx on public.workspace_invitations (workspace_id, status);

-- Um convite PENDENTE por e-mail por workspace: reconvidar não empilha.
create unique index workspace_invitations_one_pending_per_email
  on public.workspace_invitations (workspace_id, lower(email))
  where status = 'pending';

alter table public.workspace_invitations enable row level security;

-- Só quem já é do workspace enxerga os convites dele. O convidado não
-- lê a tabela: ele chega com o token e a função resolve.
create policy workspace_invitations_select_member on public.workspace_invitations
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_invitations.workspace_id
        and wm.user_id = (select auth.uid())
    )
  );

grant select on public.workspace_invitations to authenticated;

-- ============================================================
-- 5. Convidar
-- ============================================================

create or replace function public.workspace_invite_member(
  p_email text,
  p_token_hash text
)
returns public.workspace_invitations
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace_id uuid;
  v_limit integer;
  v_seats integer;
  v_pending integer;
  v_email text := lower(nullif(trim(p_email), ''));
  v_row public.workspace_invitations;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_token_hash is null or char_length(p_token_hash) <> 64 then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  -- Só o OWNER convida. Workspace derivado de auth.uid(), nunca de
  -- parâmetro — não há como convidar para o workspace alheio.
  select workspace_id into v_workspace_id from public.workspace_members
    where user_id = v_uid and role = 'owner';
  if v_workspace_id is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- Trava o workspace: serializa convites/aceites concorrentes.
  perform 1 from public.workspaces where id = v_workspace_id for update;

  select max_team_members into v_limit from public.workspace_entitlements(v_workspace_id);
  if v_limit is null then
    raise exception 'subscription_not_found' using errcode = '02000';
  end if;

  v_seats := public.workspace_seat_count(v_workspace_id);

  -- Convites pendentes RESERVAM assento. Sem isso, um Crescimento com
  -- 1 owner poderia disparar 10 convites e todos seriam aceitos.
  select count(*)::integer into v_pending from public.workspace_invitations
    where workspace_id = v_workspace_id and status = 'pending' and expires_at > now();

  if v_seats + v_pending >= v_limit then
    raise exception 'max_team_members_reached' using errcode = '23514';
  end if;

  -- Já é membro? Não faz sentido convidar de novo.
  if exists (
    select 1 from public.workspace_members wm
    join auth.users u on u.id = wm.user_id
    where wm.workspace_id = v_workspace_id and lower(u.email) = v_email
  ) then
    raise exception 'already_member' using errcode = '42710';
  end if;

  begin
    insert into public.workspace_invitations (workspace_id, email, token_hash, invited_by, expires_at)
    values (v_workspace_id, v_email, p_token_hash, v_uid, now() + interval '7 days')
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'invitation_already_pending' using errcode = '42710';
  end;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  select v_uid, s.id, 'member_invited', 'workspace_invitation', v_row.id::text,
         jsonb_build_object('workspace_id', v_workspace_id, 'email', v_email)
  from public.stores s where s.workspace_id = v_workspace_id limit 1;

  return v_row;
end;
$fn$;

comment on function public.workspace_invite_member(text, text) is
  'Convida uma pessoa para o workspace. Só o owner convida, e o workspace vem de auth.uid(). Convites PENDENTES reservam assento junto com os membros já existentes — senão bastaria disparar convites em massa e aceitar todos depois. Recebe apenas o HASH do token: o token em claro só existe no e-mail.';

revoke all on function public.workspace_invite_member(text, text) from public;
grant execute on function public.workspace_invite_member(text, text) to authenticated;

-- ============================================================
-- 6. Aceitar — o ponto crítico de concorrência
-- ============================================================

create or replace function public.workspace_accept_invitation(p_token_hash text)
returns public.workspace_members
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.workspace_invitations;
  v_limit integer;
  v_seats integer;
  v_member public.workspace_members;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select lower(email) into v_email from auth.users where id = v_uid;

  -- Trava a LINHA DO CONVITE antes de qualquer decisão: dois aceites
  -- simultâneos do mesmo token serializam aqui, e o segundo já enxerga
  -- status='accepted'.
  select * into v_inv from public.workspace_invitations
    where token_hash = p_token_hash for update;

  if v_inv.id is null then
    raise exception 'invitation_not_found' using errcode = '02000';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invitation_already_used' using errcode = '42710';
  end if;
  if v_inv.expires_at <= now() then
    update public.workspace_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invitation_expired' using errcode = '42710';
  end if;
  -- O convite é para um e-mail específico: outra conta não o usa.
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'invitation_email_mismatch' using errcode = '42501';
  end if;

  -- Trava o WORKSPACE: é isto que serializa dois convites DIFERENTES
  -- sendo aceitos ao mesmo tempo na última vaga. Sem ele, 2/3 + dois
  -- aceites simultâneos terminaria em 4/3.
  perform 1 from public.workspaces where id = v_inv.workspace_id for update;

  select max_team_members into v_limit from public.workspace_entitlements(v_inv.workspace_id);
  v_seats := public.workspace_seat_count(v_inv.workspace_id);

  if v_seats >= v_limit then
    raise exception 'max_team_members_reached' using errcode = '23514';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (v_inv.workspace_id, v_uid, 'member', v_inv.invited_by)
  on conflict (workspace_id, user_id) do update set role = public.workspace_members.role
  returning * into v_member;

  update public.workspace_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = v_uid
    where id = v_inv.id;

  perform public.workspace_sync_store_access(v_inv.workspace_id);

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  select v_uid, s.id, 'member_joined', 'workspace_member', v_member.id::text,
         jsonb_build_object('workspace_id', v_inv.workspace_id)
  from public.stores s where s.workspace_id = v_inv.workspace_id limit 1;

  return v_member;
end;
$fn$;

comment on function public.workspace_accept_invitation(text) is
  'Aceita o convite e consome o assento na MESMA transação. Dois locks: a linha do convite (impede o mesmo token ser usado duas vezes) e a linha do workspace (impede dois convites diferentes estourarem a última vaga — 2/3 + dois aceites simultâneos termina 3/3, nunca 4/3). Convite é single-use e casado com o e-mail.';

revoke all on function public.workspace_accept_invitation(text) from public;
grant execute on function public.workspace_accept_invitation(text) to authenticated;

-- ============================================================
-- 7. Remover membro / revogar convite
-- ============================================================

create or replace function public.workspace_remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace_id uuid;
  v_target_role text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select workspace_id into v_workspace_id from public.workspace_members
    where user_id = v_uid and role = 'owner';
  if v_workspace_id is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  perform 1 from public.workspaces where id = v_workspace_id for update;

  select role into v_target_role from public.workspace_members
    where workspace_id = v_workspace_id and user_id = p_user_id;
  if v_target_role is null then
    raise exception 'member_not_found' using errcode = '02000';
  end if;

  -- O owner não se remove nem deixa o workspace sem dono. Transferir
  -- propriedade exige fluxo próprio, que não existe nesta versão.
  if v_target_role = 'owner' then
    raise exception 'cannot_remove_owner' using errcode = '42501';
  end if;

  delete from public.workspace_members
    where workspace_id = v_workspace_id and user_id = p_user_id;

  -- Perde acesso a TODAS as lojas do workspace, agora.
  perform public.workspace_sync_store_access(v_workspace_id);

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  select v_uid, s.id, 'member_removed', 'workspace_member', p_user_id::text,
         jsonb_build_object('workspace_id', v_workspace_id)
  from public.stores s where s.workspace_id = v_workspace_id limit 1;
end;
$fn$;

comment on function public.workspace_remove_member(uuid) is
  'Remove a pessoa do workspace e, na mesma transação, o acesso dela a todas as lojas (workspace_sync_store_access). O owner nunca é removível por aqui — o workspace nunca fica sem dono. A revogação das SESSÕES do removido é feita pela camada de sessão (0016).';

revoke all on function public.workspace_remove_member(uuid) from public;
grant execute on function public.workspace_remove_member(uuid) to authenticated;

create or replace function public.workspace_revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id from public.workspace_members
    where user_id = v_uid and role = 'owner';
  if v_workspace_id is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update public.workspace_invitations
    set status = 'revoked'
    where id = p_invitation_id and workspace_id = v_workspace_id and status = 'pending';
  if not found then
    raise exception 'invitation_not_found' using errcode = '02000';
  end if;
end;
$fn$;

revoke all on function public.workspace_revoke_invitation(uuid) from public;
grant execute on function public.workspace_revoke_invitation(uuid) to authenticated;

-- ============================================================
-- 8. Listagem da equipe (painel)
-- ============================================================

create or replace function public.workspace_team(p_store_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  joined_at timestamptz,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_workspace_id uuid;
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select workspace_id into v_workspace_id from public.stores where id = p_store_id;

  return query
    select wm.user_id, u.email::text, mp.display_name, wm.role, wm.joined_at,
           wm.user_id = auth.uid()
    from public.workspace_members wm
    join auth.users u on u.id = wm.user_id
    left join public.merchant_profiles mp on mp.user_id = wm.user_id
    where wm.workspace_id = v_workspace_id
    order by (wm.role = 'owner') desc, wm.joined_at asc;
end;
$fn$;

comment on function public.workspace_team(uuid) is
  'Equipe do workspace para a tela Configurações -> Equipe. Autorizada por is_store_member — um membro de outro tenant nunca lê esta lista. Devolve e-mail e nome porque são exatamente o que a tela precisa mostrar; nada de token, hash ou dado de sessão.';

revoke all on function public.workspace_team(uuid) from public;
grant execute on function public.workspace_team(uuid) to authenticated;

-- ============================================================
-- 9. Downgrade só desce se a equipe couber
-- ============================================================

create or replace function public.workspace_can_use_plan(p_workspace_id uuid, p_plan_key text)
returns table (allowed boolean, reason text, current_value integer, target_limit integer)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_plan public.platform_plans;
  v_seats integer;
  v_stores integer;
  v_max_products integer;
begin
  select * into v_plan from public.platform_plans where plan_key = p_plan_key;
  if v_plan.plan_key is null then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  v_seats := public.workspace_seat_count(p_workspace_id);
  if v_seats > v_plan.max_team_members then
    return query select false, 'team'::text, v_seats, v_plan.max_team_members;
    return;
  end if;

  select count(*)::integer into v_stores from public.stores where workspace_id = p_workspace_id;
  if v_stores > v_plan.max_stores then
    return query select false, 'stores'::text, v_stores, v_plan.max_stores;
    return;
  end if;

  -- Produtos são POR LOJA: basta uma loja acima do alvo para barrar.
  select max(public.store_product_quota_count(s.id))::integer into v_max_products
    from public.stores s where s.workspace_id = p_workspace_id;
  if coalesce(v_max_products, 0) > v_plan.max_products then
    return query select false, 'products'::text, v_max_products, v_plan.max_products;
    return;
  end if;

  return query select true, null::text, null::integer, null::integer;
end;
$fn$;

comment on function public.workspace_can_use_plan(uuid, text) is
  'O uso atual cabe no plano alvo? Usado para BLOQUEAR a ativação de um downgrade em vez de apagar dados do lojista (seção 31 do TASK): Profissional com 6 pessoas não desce para Crescimento (3), e Crescimento com membro não desce para Essencial (1). Conta PESSOAS do workspace, nunca linhas de store_members. Cupons de propósito não bloqueiam downgrade — só perdem o direito de uso.';

revoke all on function public.workspace_can_use_plan(uuid, text) from public;
grant execute on function public.workspace_can_use_plan(uuid, text) to authenticated, service_role;

-- ============================================================
-- 10. Loja nova herda a equipe; contagem de equipe corrigida
-- ============================================================

create or replace function public.workspace_create_store(
  p_name text,
  p_slug text,
  p_whatsapp text default null
)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace public.workspaces;
  v_subscription public.workspace_subscriptions;
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
  v_limit integer;
  v_used integer;
  v_store public.stores;
  v_status text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 120 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  select w.* into v_workspace from public.workspaces w
    join public.workspace_members wm on wm.workspace_id = w.id
    where wm.user_id = v_uid and wm.role = 'owner'
    for update of w;
  if v_workspace.id is null then
    raise exception 'workspace_not_found' using errcode = '02000';
  end if;

  select * into v_subscription from public.workspace_subscriptions
    where workspace_id = v_workspace.id;
  if v_subscription.id is null then
    raise exception 'subscription_not_found' using errcode = '02000';
  end if;

  select max_stores into v_limit from public.workspace_entitlements(v_workspace.id);
  select count(*)::integer into v_used from public.stores where workspace_id = v_workspace.id;

  if v_used >= v_limit then
    raise exception 'max_stores_reached' using errcode = '23514';
  end if;

  v_status := case when v_subscription.status = 'active' then 'active' else 'pending_payment' end;

  begin
    insert into public.stores (slug, name, whatsapp, status, workspace_id)
    values (v_slug, v_name, nullif(trim(p_whatsapp), ''), v_status, v_workspace.id)
    returning * into v_store;
  exception
    when unique_violation then
      raise exception 'slug_taken' using errcode = '23505';
  end;

  -- A loja nova herda TODA a equipe do workspace (V1: member opera todas
  -- as lojas) — inclusive o owner. Substitui o insert manual anterior.
  perform public.workspace_sync_store_access(v_workspace.id);
  perform public.workspace_sync_store_plans(v_workspace.id);

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values
    (v_uid, v_store.id, 'store_created', 'store', v_store.id::text,
      jsonb_build_object('slug', v_store.slug, 'workspace_id', v_workspace.id, 'via', 'workspace_create_store')),
    (v_uid, v_store.id, 'owner_assigned', 'store_members', v_store.id::text, '{}'::jsonb);

  return v_store;
end;
$fn$;

comment on function public.workspace_create_store(text, text, text) is
  'Cria a 2ª/3ª loja pelo painel. TASK-012 commit 3: a loja nova herda toda a equipe do workspace via workspace_sync_store_access — um member não fica sem acesso à loja recém-criada. maxStores continua aplicado com o workspace travado; o workspace vem de auth.uid(), nunca de parâmetro.';

revoke all on function public.workspace_create_store(text, text, text) from public;
grant execute on function public.workspace_create_store(text, text, text) to authenticated;

-- onboarding_complete passa a registrar o assento do owner.
create or replace function public.workspace_bootstrap_owner(p_workspace_id uuid, p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, p_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;
$fn$;

revoke all on function public.workspace_bootstrap_owner(uuid, uuid) from public;
grant execute on function public.workspace_bootstrap_owner(uuid, uuid) to service_role;

-- store_quota_usage: a contagem de equipe passa a ser de PESSOAS do
-- workspace. A versão de 0014 contava distinct user_id via store_members
-- — resultado igual hoje, mas conceitualmente a fonte errada.
create or replace function public.store_quota_usage(p_store_id uuid)
returns table (
  plan_key text,
  products_used integer,
  products_limit integer,
  images_per_product_limit integer,
  stores_used integer,
  stores_limit integer,
  team_used integer,
  team_limit integer,
  coupons_enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_workspace_id uuid;
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select workspace_id into v_workspace_id from public.stores where id = p_store_id;

  return query
    select
      e.plan_key,
      public.store_product_quota_count(p_store_id),
      e.max_products,
      e.max_images_per_product,
      (select count(*)::integer from public.stores s where s.workspace_id = v_workspace_id),
      e.max_stores,
      public.workspace_seat_count(v_workspace_id),
      e.max_team_members,
      e.coupons
    from public.workspace_entitlements(v_workspace_id) e;
end;
$fn$;

revoke all on function public.store_quota_usage(uuid) from public;
grant execute on function public.store_quota_usage(uuid) to authenticated;

-- ============================================================
-- 11. onboarding_complete registra o assento do owner
-- ============================================================
--
-- Corpo idêntico ao de 0014; a única mudança é o INSERT em
-- workspace_members marcado abaixo. Sem ele o workspace nasceria com
-- 0 assentos ocupados e um Essencial (limite 1) ainda teria vaga para
-- convidar alguém — o dono não contaria.

create or replace function public.onboarding_complete()
returns public.stores
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_progress public.onboarding_progress;
  v_store public.stores;
  v_existing_store_id uuid;
  v_workspace_id uuid;
  v_plan_key text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select sm.store_id into v_existing_store_id
  from public.store_members sm
  where sm.user_id = v_uid and sm.role = 'owner'
  limit 1;

  if v_existing_store_id is not null then
    select * into v_store from public.stores where id = v_existing_store_id;
    return v_store;
  end if;

  select * into v_progress
  from public.onboarding_progress
  where user_id = v_uid
  for update;

  if not found then
    raise exception 'onboarding_not_started' using errcode = '42883';
  end if;

  if v_progress.merchant_name is null
     or v_progress.whatsapp is null
     or v_progress.store_name is null
     or v_progress.slug is null
     or v_progress.plan_code is null then
    raise exception 'onboarding_incomplete' using errcode = '42883';
  end if;

  -- plan_key é a identidade; plan_code sobrevive só como espelho legado.
  v_plan_key := coalesce(v_progress.plan_key, public.plan_key_from_legacy_code(v_progress.plan_code));
  if v_plan_key is null then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  insert into public.workspaces (owner_user_id, name)
  values (v_uid, v_progress.store_name)
  returning id into v_workspace_id;

  -- Assinatura nasce pending_payment: escolher plano NUNCA concede
  -- entitlement, só o pagamento aprovado concede (mesmo princípio
  -- "dinheiro primeiro, plano depois" da TASK-011/0013).
  insert into public.workspace_subscriptions (workspace_id, plan_key, status, entitlement_version)
  values (v_workspace_id, v_plan_key, 'pending_payment', 1);

  begin
    insert into public.stores (slug, name, whatsapp, status, workspace_id)
    values (v_progress.slug, v_progress.store_name, v_progress.whatsapp, 'pending_payment', v_workspace_id)
    returning * into v_store;
  exception
    when unique_violation then
      raise exception 'slug_taken' using errcode = '23505';
  end;

  insert into public.store_members (store_id, user_id, role)
  values (v_store.id, v_uid, 'owner');

  -- TASK-012 commit 3: o owner também ocupa um ASSENTO do workspace —
  -- é ele que conta no limite de equipe do plano (Essencial = 1 = só o
  -- dono). Sem esta linha o workspace nasceria com 0/1 assentos e um
  -- Essencial poderia convidar alguém.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_uid, 'owner');

  insert into public.store_plans (store_id, plan_code, plan_key)
  values (v_store.id, v_progress.plan_code, v_plan_key);

  insert into public.merchant_profiles (user_id, display_name)
  values (v_uid, v_progress.merchant_name)
  on conflict (user_id) do update
    set display_name = excluded.display_name, updated_at = now();

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values
    (v_uid, v_store.id, 'store_created', 'store', v_store.id::text, jsonb_build_object('slug', v_store.slug, 'workspace_id', v_workspace_id)),
    (v_uid, v_store.id, 'owner_assigned', 'store_members', v_store.id::text, '{}'::jsonb),
    (v_uid, v_store.id, 'plan_selected', 'store_plans', v_store.id::text, jsonb_build_object('plan_key', v_plan_key)),
    (v_uid, v_store.id, 'onboarding_completed', 'onboarding_progress', v_uid::text, '{}'::jsonb);

  update public.onboarding_progress
  set step = 'completed', completed_at = now(), updated_at = now()
  where user_id = v_uid;

  return v_store;
end;
$fn$;

comment on function public.onboarding_complete() is
  'Fecha o onboarding criando, na MESMA transação: workspace -> assinatura (pending_payment) -> assento do owner -> loja -> vínculo de acesso. TASK-012 commit 3: o owner ocupa assento em workspace_members, que é o que o limite de equipe do plano conta (Essencial = 1 = somente o dono). Idempotente.';
