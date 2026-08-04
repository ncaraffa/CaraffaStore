-- TASK-002 — Autenticação e onboarding inicial do comerciante
--
-- ESTADO: proposta técnica de Claude Code, destinada apenas a ambiente
-- local/dev (via `supabase start`). Não aplicar a ambiente compartilhado
-- ou produção sem revisão explícita de Caraffa (docs/SECURITY.md).
--
-- Mesmo princípio da 0001: negação por padrão. Nenhuma tabela nova tem
-- policy de INSERT/UPDATE para `authenticated` — toda escrita passa por
-- função SECURITY DEFINER que valida etapa, dono da linha (auth.uid()) e
-- rejeita qualquer campo que definiria owner_id/store_id/role/status/
-- plano fora do controle do servidor. O cliente nunca envia esses campos;
-- as funções abaixo nem os aceitam como parâmetro.

-- ============================================================
-- stores: novas colunas (estado do onboarding/pagamento)
-- ============================================================

alter table public.stores
  add column if not exists status text not null default 'onboarding'
    check (status in ('onboarding', 'pending_payment', 'active', 'suspended')),
  add column if not exists whatsapp text;

comment on column public.stores.status is
  'onboarding = incompleta; pending_payment = onboarding concluído, aguardando cobrança futura; active/suspended = reservados para fluxos futuros de pagamento/suspensão. O fluxo público desta tarefa nunca grava active/suspended — só onboarding_complete() (para pending_payment) ou seeds/testes.';

-- ============================================================
-- Tabelas novas
-- ============================================================

create table if not exists public.merchant_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.merchant_profiles is
  'Perfil mínimo do comerciante (nome), persistido na conclusão do onboarding a partir de onboarding_progress.merchant_name.';

create table if not exists public.onboarding_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  step text not null default 'profile'
    check (step in ('profile', 'store_name', 'slug', 'plan', 'review', 'completed')),
  merchant_name text,
  whatsapp text,
  store_name text,
  slug text,
  plan_code integer check (plan_code in (30, 50, 80)),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.onboarding_progress is
  'Progresso do onboarding, uma linha por usuário, vinculada a auth.uid(). Nenhuma policy de insert/update — toda escrita passa pelas funções onboarding_*, que validam etapa e dono da linha no servidor. "step" é o marcador de retomada (furthest reached); o bloqueio real de salto de etapa vem de cada função exigir que os campos da etapa anterior já estejam preenchidos.';

create table if not exists public.store_plans (
  store_id uuid primary key references public.stores (id) on delete cascade,
  plan_code integer not null check (plan_code in (30, 50, 80)),
  selected_at timestamptz not null default now()
);

comment on table public.store_plans is
  'Registro da seleção inicial de plano (R$30/50/80), sem cobrança, assinatura, entitlement ou benefício associado nesta tarefa.';

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  store_id uuid references public.stores (id) on delete set null,
  action text not null check (action in (
    'signup_completed',
    'email_verification_completed',
    'password_recovery_requested',
    'password_recovery_completed',
    'store_created',
    'owner_assigned',
    'plan_selected',
    'onboarding_completed',
    'access_denied'
  )),
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Auditoria mínima append-only. metadata nunca deve conter senha, token, cookie, chave ou URL completa de recuperação — só identificadores mínimos (ids, slugs, planos). Sem policy de select/insert/update/delete para anon/authenticated: só as funções SECURITY DEFINER escrevem; leitura fica restrita a service_role (ferramentas administrativas/QA), fora do escopo de UI desta tarefa.';

-- ============================================================
-- Helpers de slug (puros, sem acesso a tabela — normalização e
-- validação de formato). Fonte de verdade fica no banco, não só na UI.
-- ============================================================

create or replace function public.normalize_slug(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(trim(raw)), '[\s_]+', '-', 'g'),
          '[^a-z0-9-]', '', 'g'
        ),
        '-{2,}', '-', 'g'
      ),
      '^-+|-+$', '', 'g'
    ),
    ''
  );
$$;

comment on function public.normalize_slug(text) is
  'Normalização determinística de slug: minúsculas, espaços/underscore viram hífen, caracteres fora de [a-z0-9-] removidos, hífens repetidos/nas pontas colapsados. Retorna null se o resultado ficar vazio.';

create or replace function public.is_reserved_slug(candidate text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select candidate = any (array[
    'admin', 'api', 'app', 'www', 'static', 'assets', 'auth',
    'login', 'logout', 'signup', 'signin', 'onboarding', 'painel',
    'dashboard', 'select-store', 'pending-payment', 'suspended',
    'verify', 'reset-password', 'forgot-password', 'supabase',
    'root', 'null', 'undefined', 'loja', 'store', 'stores',
    'public', 'system', 'support', 'help'
  ]);
$$;

create or replace function public.onboarding_step_rank(s text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case s
    when 'profile' then 1
    when 'store_name' then 2
    when 'slug' then 3
    when 'plan' then 4
    when 'review' then 5
    when 'completed' then 6
    else 0
  end;
$$;

create or replace function public.onboarding_advance_step(current_step text, target_step text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when public.onboarding_step_rank(target_step) > public.onboarding_step_rank(current_step)
    then target_step
    else current_step
  end;
$$;

revoke all on function public.normalize_slug(text) from public;
revoke all on function public.is_reserved_slug(text) from public;
revoke all on function public.onboarding_step_rank(text) from public;
revoke all on function public.onboarding_advance_step(text, text) from public;
-- Sem grant para authenticated/anon: usadas apenas internamente pelas
-- funções SECURITY DEFINER abaixo (o dono da função sempre pode
-- executar funções que possui, independente de GRANT/REVOKE).

-- ============================================================
-- Funções de onboarding (SECURITY DEFINER — únicas gravadoras de
-- onboarding_progress/stores/store_members/store_plans/merchant_profiles/
-- audit_log nesta tarefa). Nenhuma recebe owner_id, store_id, role,
-- status ou plano "pronto" do cliente sem revalidar tudo no servidor;
-- onboarding_complete() não recebe NENHUM parâmetro de negócio — lê só o
-- que já foi salvo e validado etapa a etapa.
-- ============================================================

create or replace function public.onboarding_ensure_progress()
returns public.onboarding_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email_confirmed boolean;
  v_has_store boolean;
  v_row public.onboarding_progress;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select (email_confirmed_at is not null) into v_email_confirmed
  from auth.users
  where id = v_uid;

  if coalesce(v_email_confirmed, false) is not true then
    raise exception 'email_not_verified' using errcode = '28000';
  end if;

  select exists (
    select 1 from public.store_members
    where user_id = v_uid and role = 'owner'
  ) into v_has_store;

  if v_has_store then
    raise exception 'already_has_store' using errcode = '42710';
  end if;

  insert into public.onboarding_progress (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select * into v_row from public.onboarding_progress where user_id = v_uid;
  return v_row;
end;
$$;

create or replace function public.onboarding_save_profile(p_merchant_name text, p_whatsapp text)
returns public.onboarding_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(p_merchant_name), '');
  v_whatsapp text := nullif(trim(p_whatsapp), '');
  v_row public.onboarding_progress;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_merchant_name' using errcode = '22023';
  end if;

  if v_whatsapp is null or char_length(v_whatsapp) < 8 or char_length(v_whatsapp) > 20 then
    raise exception 'invalid_whatsapp' using errcode = '22023';
  end if;

  select * into v_row from public.onboarding_progress where user_id = v_uid for update;
  if not found then
    raise exception 'onboarding_not_started' using errcode = '42883';
  end if;
  if v_row.completed_at is not null then
    raise exception 'onboarding_already_completed' using errcode = '42710';
  end if;

  update public.onboarding_progress
  set merchant_name = v_name,
      whatsapp = v_whatsapp,
      step = public.onboarding_advance_step(step, 'store_name'),
      updated_at = now()
  where user_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.onboarding_save_store_name(p_store_name text)
returns public.onboarding_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(p_store_name), '');
  v_row public.onboarding_progress;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_store_name' using errcode = '22023';
  end if;

  select * into v_row from public.onboarding_progress where user_id = v_uid for update;
  if not found then
    raise exception 'onboarding_not_started' using errcode = '42883';
  end if;
  if v_row.completed_at is not null then
    raise exception 'onboarding_already_completed' using errcode = '42710';
  end if;
  if v_row.merchant_name is null or v_row.whatsapp is null then
    raise exception 'profile_required' using errcode = '42883';
  end if;

  update public.onboarding_progress
  set store_name = v_name,
      step = public.onboarding_advance_step(step, 'slug'),
      updated_at = now()
  where user_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.onboarding_save_slug(p_slug text)
returns public.onboarding_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := public.normalize_slug(p_slug);
  v_row public.onboarding_progress;
  v_taken boolean;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if v_slug is null or char_length(v_slug) < 3 or char_length(v_slug) > 63 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  if public.is_reserved_slug(v_slug) then
    raise exception 'reserved_slug' using errcode = '22023';
  end if;

  select * into v_row from public.onboarding_progress where user_id = v_uid for update;
  if not found then
    raise exception 'onboarding_not_started' using errcode = '42883';
  end if;
  if v_row.completed_at is not null then
    raise exception 'onboarding_already_completed' using errcode = '42710';
  end if;
  if v_row.store_name is null then
    raise exception 'store_name_required' using errcode = '42883';
  end if;

  -- Checagem de conveniência para feedback imediato na UI. Não é a
  -- barreira real contra concorrência: duas pessoas podem passar aqui
  -- para o mesmo slug ao mesmo tempo. A barreira real é a constraint
  -- unique em stores.slug, revalidada dentro de onboarding_complete().
  select exists (select 1 from public.stores where slug = v_slug) into v_taken;
  if v_taken then
    raise exception 'slug_taken' using errcode = '23505';
  end if;

  update public.onboarding_progress
  set slug = v_slug,
      step = public.onboarding_advance_step(step, 'plan'),
      updated_at = now()
  where user_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.onboarding_save_plan(p_plan_code integer)
returns public.onboarding_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.onboarding_progress;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if p_plan_code is null or p_plan_code not in (30, 50, 80) then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  select * into v_row from public.onboarding_progress where user_id = v_uid for update;
  if not found then
    raise exception 'onboarding_not_started' using errcode = '42883';
  end if;
  if v_row.completed_at is not null then
    raise exception 'onboarding_already_completed' using errcode = '42710';
  end if;
  if v_row.slug is null then
    raise exception 'slug_required' using errcode = '42883';
  end if;

  update public.onboarding_progress
  set plan_code = p_plan_code,
      step = public.onboarding_advance_step(step, 'review'),
      updated_at = now()
  where user_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.onboarding_complete()
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_progress public.onboarding_progress;
  v_existing_store_id uuid;
  v_store public.stores;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  -- Trava por usuário: impede duas chamadas concorrentes da mesma pessoa
  -- (duplo clique, retry de rede) de criarem duas lojas em paralelo.
  -- Liberada automaticamente ao fim da transação (xact).
  perform pg_advisory_xact_lock(hashtext('onboarding_complete:' || v_uid::text));

  -- Idempotência: se o usuário já é owner de alguma loja — inclusive por
  -- uma chamada anterior bem-sucedida desta mesma função —, devolve a
  -- loja existente em vez de tentar criar outra. Retry não duplica nada.
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

  begin
    insert into public.stores (slug, name, whatsapp, status)
    values (v_progress.slug, v_progress.store_name, v_progress.whatsapp, 'pending_payment')
    returning * into v_store;
  exception
    when unique_violation then
      -- Concorrência real: outro usuário terminou com o mesmo slug
      -- primeiro. Toda a função aborta (nenhuma linha parcial fica
      -- gravada) e o cliente deve voltar para a etapa de slug.
      raise exception 'slug_taken' using errcode = '23505';
  end;

  insert into public.store_members (store_id, user_id, role)
  values (v_store.id, v_uid, 'owner');

  insert into public.store_plans (store_id, plan_code)
  values (v_store.id, v_progress.plan_code);

  insert into public.merchant_profiles (user_id, display_name)
  values (v_uid, v_progress.merchant_name)
  on conflict (user_id) do update
    set display_name = excluded.display_name, updated_at = now();

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values
    (v_uid, v_store.id, 'store_created', 'store', v_store.id::text, jsonb_build_object('slug', v_store.slug)),
    (v_uid, v_store.id, 'owner_assigned', 'store_members', v_store.id::text, '{}'::jsonb),
    (v_uid, v_store.id, 'plan_selected', 'store_plans', v_store.id::text, jsonb_build_object('plan_code', v_progress.plan_code)),
    (v_uid, v_store.id, 'onboarding_completed', 'onboarding_progress', v_uid::text, '{}'::jsonb);

  update public.onboarding_progress
  set step = 'completed', completed_at = now(), updated_at = now()
  where user_id = v_uid;

  return v_store;
end;
$$;

create or replace function public.is_slug_available(p_slug text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select case
    when public.normalize_slug(p_slug) is null then false
    when char_length(public.normalize_slug(p_slug)) < 3
      or char_length(public.normalize_slug(p_slug)) > 63 then false
    when public.is_reserved_slug(public.normalize_slug(p_slug)) then false
    else not exists (
      select 1 from public.stores where slug = public.normalize_slug(p_slug)
    )
  end;
$$;

revoke all on function public.onboarding_ensure_progress() from public;
revoke all on function public.onboarding_save_profile(text, text) from public;
revoke all on function public.onboarding_save_store_name(text) from public;
revoke all on function public.onboarding_save_slug(text) from public;
revoke all on function public.onboarding_save_plan(integer) from public;
revoke all on function public.onboarding_complete() from public;
revoke all on function public.is_slug_available(text) from public;

grant execute on function public.onboarding_ensure_progress() to authenticated;
grant execute on function public.onboarding_save_profile(text, text) to authenticated;
grant execute on function public.onboarding_save_store_name(text) to authenticated;
grant execute on function public.onboarding_save_slug(text) to authenticated;
grant execute on function public.onboarding_save_plan(integer) to authenticated;
grant execute on function public.onboarding_complete() to authenticated;
grant execute on function public.is_slug_available(text) to authenticated;

-- ============================================================
-- RLS — negação por padrão, mesma convenção da 0001
-- ============================================================

alter table public.merchant_profiles enable row level security;
alter table public.onboarding_progress enable row level security;
alter table public.store_plans enable row level security;
alter table public.audit_log enable row level security;

create policy merchant_profiles_select_self
  on public.merchant_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

create policy onboarding_progress_select_self
  on public.onboarding_progress
  for select
  to authenticated
  using (user_id = auth.uid());

create policy store_plans_select_member
  on public.store_plans
  for select
  to authenticated
  using (public.is_store_member(store_id));

-- audit_log: propositalmente sem nenhuma policy de select/insert/update/
-- delete para anon/authenticated — RLS habilitada + zero policy = negado
-- por padrão. Nenhuma UI desta tarefa lê auditoria; escrita só pelas
-- funções SECURITY DEFINER acima (executam como dono da tabela, que
-- ignora RLS, igual ao padrão já usado por is_store_member/is_store_admin
-- na 0001 para consultar store_members sem recursão de policy).

-- ============================================================
-- Privilégios SQL mínimos — mesmo raciocínio da 0001 (RETEST-BUG-001):
-- RLS decide quais linhas; GRANT decide se a operação pode ao menos ser
-- tentada. Revoga tudo primeiro, concede de volta o mínimo por papel.
-- ============================================================

revoke all on public.merchant_profiles, public.onboarding_progress,
  public.store_plans, public.audit_log
  from public, anon, authenticated, service_role;

-- anon: nenhum GRANT em nenhuma tabela nova.

-- authenticated: apenas SELECT, e só nas três tabelas com policy de
-- leitura acima. Nenhum INSERT/UPDATE/DELETE — toda escrita passa pelas
-- funções SECURITY DEFINER. audit_log não recebe grant nenhum.
grant select on public.merchant_profiles to authenticated;
grant select on public.onboarding_progress to authenticated;
grant select on public.store_plans to authenticated;

-- service_role: uso administrativo/local (seed, QA, scripts), nunca a
-- partir de requisição de usuário — mesmo padrão da 0001.
grant select, insert, update, delete
  on public.merchant_profiles, public.onboarding_progress,
     public.store_plans, public.audit_log
  to service_role;
