-- TASK-009 — Painel exclusivo do dono da plataforma
--
-- Visão de todas as lojas cadastradas (nunca alcançável por um membro de
-- loja comum, mesmo owner) + suspensão/reativação. Mesmo princípio de
-- negação por padrão das migrations anteriores: platform_admins é uma
-- tabela deny-by-default sem NENHUMA policy (só service_role grava), e
-- toda leitura/mutação passa por função SECURITY DEFINER que valida
-- is_platform_admin() no servidor — nunca um campo/role que o cliente
-- possa afirmar.

-- ============================================================
-- 1. platform_admins — allowlist mínima, gravação só via service_role
-- ============================================================

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Contas com acesso ao painel exclusivo do dono da plataforma (visão de todas as lojas, suspensão/reativação). Sem função pública de auto-concessão — só service_role grava, mesmo padrão de billing_charges/audit_log.';

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.platform_admins to service_role;

-- ============================================================
-- 2. stores.pre_suspension_status — pra reativação nunca "promover"
--    uma loja indevidamente (ex.: suspender uma pending_payment e
--    reativar não pode virar active sem ter pago).
-- ============================================================

alter table public.stores
  add column if not exists pre_suspension_status text
    check (pre_suspension_status in ('onboarding', 'pending_payment', 'active'));

comment on column public.stores.pre_suspension_status is
  'Status que a loja tinha antes de ser suspensa pelo dono da plataforma — platform_admin_set_store_status(''reactivate'') restaura exatamente este valor, nunca força active (uma loja pending_payment suspensa não pode "ganhar" ativação só por ser reativada).';

-- ============================================================
-- 3. is_platform_admin — checagem pura, usada por toda função abaixo
--    e reaproveitável em RLS futura se necessário.
-- ============================================================

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

comment on function public.is_platform_admin() is
  'true só para o(s) user_id em platform_admins — nunca deriva de claim de JWT nem de qualquer coisa que o cliente afirme.';

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- ============================================================
-- 4. platform_admin_store_overview — única leitura cross-tenant da
--    plataforma. Retorno inclui contato do dono (email/whatsapp/nome) —
--    dado sensível, por isso a função é o único caminho (nunca SELECT
--    bruto liberado pra authenticated).
-- ============================================================

create or replace function public.platform_admin_store_overview()
returns table (
  store_id uuid,
  slug text,
  name text,
  status text,
  pre_suspension_status text,
  whatsapp text,
  plan_code integer,
  store_created_at timestamptz,
  owner_user_id uuid,
  owner_email text,
  owner_display_name text,
  latest_charge_status text,
  latest_charge_amount_cents integer,
  latest_charge_approved_at timestamptz,
  latest_charge_period_end timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
    select
      s.id, s.slug, s.name, s.status, s.pre_suspension_status, s.whatsapp,
      sp.plan_code, s.created_at,
      owner.user_id, u.email::text, mp.display_name,
      lc.status, lc.amount_cents, lc.approved_at, lc.period_end
    from public.stores s
    left join public.store_plans sp on sp.store_id = s.id
    left join lateral (
      select om.user_id, om.created_at
      from public.store_members om
      where om.store_id = s.id and om.role = 'owner'
      order by om.created_at asc
      limit 1
    ) owner on true
    left join auth.users u on u.id = owner.user_id
    left join public.merchant_profiles mp on mp.user_id = owner.user_id
    left join lateral (
      select bc.status, bc.amount_cents, bc.approved_at, bc.period_end
      from public.billing_charges bc
      where bc.store_id = s.id
      order by bc.created_at desc
      limit 1
    ) lc on true
    order by s.created_at desc;
end;
$$;

comment on function public.platform_admin_store_overview() is
  'Única leitura cross-tenant da plataforma (nunca respeita RLS por linha — is_platform_admin() é o próprio portão). Uma linha por loja: dados da loja, dono (email/nome/whatsapp) e a cobrança de assinatura mais recente.';

revoke all on function public.platform_admin_store_overview() from public;
grant execute on function public.platform_admin_store_overview() to authenticated;

-- ============================================================
-- 5. platform_admin_set_store_status — suspender/reativar. 'reactivate'
--    restaura pre_suspension_status, nunca força 'active'.
-- ============================================================

create or replace function public.platform_admin_set_store_status(
  p_store_id uuid,
  p_action text
)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
begin
  if not public.is_platform_admin() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_action not in ('suspend', 'reactivate') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  select * into v_store from public.stores where id = p_store_id for update;
  if v_store.id is null then
    raise exception 'store_not_found' using errcode = '02000';
  end if;

  if p_action = 'suspend' then
    if v_store.status = 'suspended' then
      return v_store; -- idempotente
    end if;
    update public.stores
      set status = 'suspended', pre_suspension_status = v_store.status
      where id = p_store_id
      returning * into v_store;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (auth.uid(), v_store.id, 'store_suspended_by_platform_admin', 'store', v_store.id::text,
      jsonb_build_object('previous_status', v_store.pre_suspension_status));
  else
    if v_store.status <> 'suspended' then
      raise exception 'store_not_suspended' using errcode = '22023';
    end if;
    update public.stores
      set status = coalesce(v_store.pre_suspension_status, 'active'), pre_suspension_status = null
      where id = p_store_id
      returning * into v_store;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (auth.uid(), v_store.id, 'store_reactivated_by_platform_admin', 'store', v_store.id::text,
      jsonb_build_object('restored_status', v_store.status));
  end if;

  return v_store;
end;
$$;

comment on function public.platform_admin_set_store_status(uuid, text) is
  'suspend: guarda o status atual em pre_suspension_status antes de suspender (idempotente se já suspensa). reactivate: restaura exatamente esse status — nunca ativa uma loja que estava pending_payment/onboarding só porque foi suspensa e reativada.';

revoke all on function public.platform_admin_set_store_status(uuid, text) from public;
grant execute on function public.platform_admin_set_store_status(uuid, text) to authenticated;

-- ============================================================
-- 6. audit_log_action_check — só ALARGA
-- ============================================================

alter table public.audit_log
  drop constraint audit_log_action_check,
  add constraint audit_log_action_check check (action in (
    'signup_completed',
    'email_verification_completed',
    'password_recovery_requested',
    'password_recovery_grant_issued',
    'password_recovery_authorization_claimed',
    'password_recovery_completed',
    'password_recovery_revoked',
    'store_created',
    'owner_assigned',
    'plan_selected',
    'onboarding_completed',
    'access_denied',
    'category_created',
    'category_updated',
    'category_archived',
    'product_created',
    'product_updated',
    'product_published',
    'product_unpublished',
    'product_archived',
    'product_stock_adjusted',
    'product_image_added',
    'product_image_removed',
    'product_cover_changed',
    'order_created',
    'order_status_changed',
    'order_cancelled',
    'order_stock_reserved',
    'order_stock_restored',
    'payment_settings_configured',
    'payment_settings_disabled',
    'pix_payment_creation_started',
    'pix_payment_created',
    'pix_payment_approved',
    'pix_payment_rejected',
    'pix_payment_cancelled',
    'pix_payment_expired',
    'pix_payment_reconciliation_failed',
    'order_confirmed_by_payment',
    'order_cancelled_by_payment_failure',
    'payment_manual_review_required',
    'billing_charge_creation_started',
    'billing_charge_created',
    'billing_charge_approved',
    'billing_charge_rejected',
    'billing_charge_cancelled',
    'billing_charge_expired',
    'billing_manual_review_required',
    'store_activated_by_billing',
    'billing_subscription_renewed',
    'store_suspended_by_platform_admin',
    'store_reactivated_by_platform_admin'
  ));

comment on constraint audit_log_action_check on public.audit_log is
  'Conjunto de actions só CRESCE entre migrations (nunca estreitar — bloqueador histórico BUG-RT2-006, qa/reports/TASK-002-RETEST.md). TASK-009 adiciona os 2 eventos de suspensão/reativação pelo painel do dono da plataforma.';

-- ============================================================
-- 7. Seed do primeiro (e, por ora, único) admin da plataforma — no-op
--    silencioso se a conta ainda não existir neste ambiente; precisa
--    ser reaplicado/gravado manualmente depois que a conta for criada.
-- ============================================================

insert into public.platform_admins (user_id)
select id from auth.users where email = 'caraffastore@gmail.com'
on conflict (user_id) do nothing;
