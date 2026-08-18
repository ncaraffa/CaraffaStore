-- TASK-012 — Fase MIGRATE: a assinatura passa a pertencer ao workspace.
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- 0012 criou workspaces e um `workspaces.plan_key`, mas deixou a
-- fundação ambígua em dois pontos concretos — ambos verificados no
-- código, não suposições:
--
--   1) O plano que COBRA continuava vindo da loja.
--      billing_charge_upsert_creating (0011:73) fazia
--        select plan_code from store_plans where store_id = p_store_id
--      e billing_charge_apply_provider_state (0011:337) gravava o plano
--      aprovado de volta em store_plans. Ou seja: store_plans era a
--      fonte de verdade real da assinatura, e `workspaces.plan_key` era
--      só um espelho sem autoridade.
--
--   2) A cobrança era única POR LOJA, não por assinatura.
--      O índice billing_charges_one_active_per_store (0008:111) é
--      keyed em (store_id). Num workspace Profissional com 3 lojas
--      isso permitiria TRÊS cobranças abertas simultâneas — R$210/mês
--      por uma assinatura de R$70. Exatamente a cobrança múltipla que
--      o modelo comercial novo proíbe.
--
-- O QUE MUDA AQUI
--
--   workspace_subscriptions (workspace_id UNIQUE) passa a ser a ÚNICA
--   fonte de verdade da assinatura. `workspaces.plan_key` é REMOVIDO
--   para que não exista um segundo lugar plausível de onde ler plano —
--   ambiguidade eliminada por construção, não por convenção.
--
--   billing_charges ganha workspace_id e o índice de "cobrança em
--   aberto" passa a ser por WORKSPACE. É esta linha que prova
--   1 workspace + N lojas = 1 assinatura = 1 cobrança.
--
--   billing_charges.store_id PERMANECE, como contexto histórico de qual
--   loja originou o Pix. Isso não é o mesmo que dizer que o plano
--   pertence à loja — nenhuma leitura de autorização usa mais store_id
--   para derivar plano. Nenhuma linha financeira é apagada ou reescrita.
--
-- STATUS DO LEGADO (contrato explícito, seção 1 do pedido)
--
--   fonte de verdade NOVA .... workspace_subscriptions.plan_key
--   compat legada ............ store_plans.plan_code/plan_key
--   store_plans ainda existe . porque 0009/0010 (platform_admin_store_overview)
--                              e a UI de admin leem dela; é mantida como
--                              ESPELHO, escrito por um único ponto
--                              (workspace_sync_store_plans), nunca lido
--                              para decidir preço nem permissão.
--   sai da autorização ....... AGORA. A partir desta migration nenhuma
--                              função de billing ou de entitlement lê
--                              store_plans. Ela só sobrevive como
--                              projeção para telas legadas.
--   removível em ............. fase CONTRACT, junto com plan_code, quando
--                              platform_admin_store_overview for migrada.

-- ============================================================
-- 1. workspace_subscriptions — a assinatura, com dono explícito
-- ============================================================

create table public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- UNIQUE: uma assinatura por workspace. É a garantia estrutural de
  -- que não existe "uma assinatura por loja" escondida no modelo.
  workspace_id uuid not null unique references public.workspaces (id) on delete restrict,
  plan_key text not null references public.platform_plans (plan_key),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'past_due', 'cancelled')),
  entitlement_version integer not null default 1 check (entitlement_version > 0),
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspace_subscriptions is
  'A assinatura CaraffaStore do comerciante — ÚNICA fonte de verdade do plano. workspace_id é UNIQUE: uma assinatura governa TODAS as lojas do workspace (Profissional = 1x R$70 para até 3 lojas, nunca 3x R$70). Entitlements derivam daqui via workspace_entitlements(); nenhuma autorização lê store_plans nem preço.';

comment on column public.workspace_subscriptions.plan_key is
  'Plano VIGENTE (pago). Só muda em billing_charge_apply_provider_state, ramo approved — princípio "dinheiro primeiro, plano depois" herdado da TASK-011: escolher um plano na tela nunca concede entitlement, só o pagamento aprovado concede.';

comment on column public.workspace_subscriptions.status is
  'Ciclo de vida da assinatura. NÃO é o gate de acesso — quem bloqueia loja continua sendo stores.status (suspended/billing_overdue, TASK-010). Existe para tornar a assinatura uma entidade legível e auditável em vez de uma coluna solta.';

-- Período pago NÃO é duplicado aqui de propósito: "até quando está
-- pago" já tem UMA definição no sistema — a cobrança approved de maior
-- period_end (billing_charge_upsert_creating, billing_get_subscription e
-- billing_suspend_overdue_stores usam essa mesma regra). Copiar o período
-- para cá criaria um segundo lugar capaz de divergir.

create index workspace_subscriptions_status_idx on public.workspace_subscriptions (status);

alter table public.workspace_subscriptions enable row level security;

create policy workspace_subscriptions_select_member on public.workspace_subscriptions
  for select to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_subscriptions.workspace_id
        and w.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.stores s
      join public.store_members sm on sm.store_id = s.id
      where s.workspace_id = workspace_subscriptions.workspace_id
        and sm.user_id = (select auth.uid())
    )
  );

-- Sem policy de insert/update/delete: escrita só por SECURITY DEFINER.
grant select on public.workspace_subscriptions to authenticated;

-- ============================================================
-- 2. Backfill da assinatura a partir do estado vigente
-- ============================================================
--
-- Plano vem de store_plans (a fonte de verdade ATÉ esta migration), via
-- a loja do workspace. Como o backfill de 0012 é 1:1 (um workspace por
-- loja), não há ambiguidade sobre "qual loja manda": há exatamente uma.
-- status deriva do estado real da loja, não é inventado.

insert into public.workspace_subscriptions (workspace_id, plan_key, status, entitlement_version, started_at)
select
  w.id,
  coalesce(sp.plan_key, 'essential'),
  case
    when s.status = 'active' then 'active'
    when s.status = 'suspended' and s.suspension_reason = 'billing_overdue' then 'past_due'
    else 'pending_payment'
  end,
  1,
  (select min(bc.approved_at) from public.billing_charges bc
     where bc.store_id = s.id and bc.status = 'approved')
from public.workspaces w
join public.stores s on s.workspace_id = w.id
left join public.store_plans sp on sp.store_id = s.id;

-- ============================================================
-- 3. Elimina a segunda fonte plausível de plano
-- ============================================================
--
-- workspace_entitlements depende de workspaces.plan_key, então cai
-- primeiro e é recriada na seção 5 lendo a assinatura.

drop function if exists public.workspace_entitlements(uuid);

alter table public.workspaces drop column plan_key;
alter table public.workspaces drop column entitlement_version;

comment on table public.workspaces is
  'Conta do comerciante: identidade e dono. NÃO carrega plano — termos comerciais vivem em workspace_subscriptions, para que exista um único lugar de onde ler assinatura. Dona das lojas (stores.workspace_id) e, a partir do commit de equipe, dos assentos de membro.';

-- ============================================================
-- 4. billing_charges passa a ser da assinatura, não da loja
-- ============================================================

alter table public.billing_charges add column workspace_id uuid references public.workspaces (id) on delete restrict;

update public.billing_charges bc
  set workspace_id = s.workspace_id
  from public.stores s
  where s.id = bc.store_id and bc.workspace_id is null;

alter table public.billing_charges alter column workspace_id set not null;

create index billing_charges_workspace_period_idx
  on public.billing_charges (workspace_id, period_end desc) where status = 'approved';

comment on column public.billing_charges.workspace_id is
  'Assinatura que esta cobrança paga. É a chave de negócio. store_id continua preenchido como CONTEXTO HISTÓRICO (qual loja originou o Pix) e para os audit_log já existentes — mas nunca mais é usado para derivar plano, preço ou permissão.';

comment on column public.billing_charges.store_id is
  'Loja que originou a cobrança — contexto histórico e chave dos audit_log. NÃO significa que o plano pertence à loja: desde TASK-012 a assinatura é do workspace (workspace_id).';

-- A TROCA QUE PROVA A COBRANÇA ÚNICA: uma cobrança em aberto por
-- ASSINATURA. Com 3 lojas no mesmo workspace, a segunda tentativa de
-- abrir Pix colide aqui, no banco — não em memória, não na aplicação.
drop index public.billing_charges_one_active_per_store;

create unique index billing_charges_one_active_per_workspace
  on public.billing_charges (workspace_id)
  where status in ('creating', 'pending');

-- ============================================================
-- 5. workspace_entitlements — agora derivada da ASSINATURA
-- ============================================================

create or replace function public.workspace_entitlements(p_workspace_id uuid)
returns public.platform_plans
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.*
  from public.workspace_subscriptions ws
  join public.platform_plans p on p.plan_key = ws.plan_key
  where ws.workspace_id = p_workspace_id;
$fn$;

comment on function public.workspace_entitlements(uuid) is
  'Entitlements efetivos do workspace, derivados da ASSINATURA (workspace_subscriptions), nunca da loja e nunca de preço. Todas as lojas do mesmo workspace recebem exatamente estes limites — é o que faz "1 assinatura Profissional = até 3 lojas" ser verdade estrutural e não convenção.';

revoke all on function public.workspace_entitlements(uuid) from public;
grant execute on function public.workspace_entitlements(uuid) to authenticated, service_role;

-- Entitlements a partir de uma loja: resolve loja -> workspace ->
-- assinatura. É o atalho que o enforcement de produtos/imagens/cupons
-- usa, já que essas operações naturalmente partem de um store_id.
create or replace function public.store_entitlements(p_store_id uuid)
returns public.platform_plans
language sql
stable
security definer
set search_path = ''
as $fn$
  select (public.workspace_entitlements(s.workspace_id)).*
  from public.stores s
  where s.id = p_store_id;
$fn$;

comment on function public.store_entitlements(uuid) is
  'Entitlements aplicáveis a uma loja = os da assinatura do workspace dela. Existe para que o enforcement nunca precise saber que workspace existe; o caminho loja -> workspace -> assinatura -> plano é sempre percorrido no servidor.';

revoke all on function public.store_entitlements(uuid) from public;
grant execute on function public.store_entitlements(uuid) to authenticated, service_role;

-- ============================================================
-- 6. store_plans vira ESPELHO, com um único escritor
-- ============================================================

create or replace function public.workspace_sync_store_plans(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_plan_key text;
  v_plan_code integer;
begin
  select ws.plan_key, p.legacy_plan_code
    into v_plan_key, v_plan_code
    from public.workspace_subscriptions ws
    join public.platform_plans p on p.plan_key = ws.plan_key
    where ws.workspace_id = p_workspace_id;

  if v_plan_key is null then
    return;
  end if;

  -- TODAS as lojas do workspace recebem o mesmo plano — é a projeção
  -- fiel de "uma assinatura governa N lojas".
  insert into public.store_plans (store_id, plan_code, plan_key, selected_at)
  select s.id, v_plan_code, v_plan_key, now()
    from public.stores s
    where s.workspace_id = p_workspace_id
  on conflict (store_id) do update
    set plan_code = excluded.plan_code,
        plan_key = excluded.plan_key,
        selected_at = excluded.selected_at;
end;
$fn$;

comment on function public.workspace_sync_store_plans(uuid) is
  'ÚNICO escritor de store_plans a partir da TASK-012. Projeta o plano da assinatura sobre todas as lojas do workspace, mantendo vivas as telas legadas (platform_admin_store_overview, 0009/0010) sem que store_plans volte a ser fonte de verdade. Remover na fase contract junto com store_plans.';

revoke all on function public.workspace_sync_store_plans(uuid) from public;
grant execute on function public.workspace_sync_store_plans(uuid) to service_role;

comment on table public.store_plans is
  'LEGADO/ESPELHO desde TASK-012. NÃO é mais fonte de verdade do plano nem participa de autorização — a assinatura vive em workspace_subscriptions. Mantida apenas porque platform_admin_store_overview (0009/0010) ainda lê daqui; escrita exclusivamente por workspace_sync_store_plans. Remover na fase contract.';

-- ============================================================
-- 7. billing_charge_upsert_creating — agora por assinatura
-- ============================================================
--
-- Corpo derivado do de 0011; as mudanças são: (a) resolve a loja para o
-- workspace e trava a ASSINATURA, (b) plano vigente vem de
-- workspace_subscriptions e não de store_plans, (c) plano é plan_key e
-- não plan_code, (d) cobrança em aberto e período são procurados por
-- workspace_id. Todo o resto — validação de payer, reaproveitamento
-- idempotente, cancelamento de cobrança de outro plano, cálculo de
-- período sem lacuna — é preservado.
--
-- DROP explícito: a assinatura da função muda (p_plan_code integer ->
-- p_plan_key text). Sem o drop, a versão antiga sobreviveria como
-- sobrecarga e a orquestração poderia ficar presa nela — mesma lição
-- registrada em 0010/0011.
drop function if exists public.billing_charge_upsert_creating(uuid, text, text, text, text, integer);

create or replace function public.billing_charge_upsert_creating(
  p_store_id uuid,
  p_provider_idempotency_key text,
  p_payer_email text,
  p_payer_doc_type text,
  p_payer_doc_last4 text,
  p_plan_key text default null
)
returns public.billing_charges
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store public.stores;
  v_workspace_id uuid;
  v_subscription public.workspace_subscriptions;
  v_current_plan_key text;
  v_plan_key text;
  v_plan_code integer;
  v_amount_cents integer;
  v_existing public.billing_charges;
  v_new_id uuid;
  v_charge public.billing_charges;
  v_last_period_end timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  select * into v_store from public.stores where id = p_store_id for update;
  if v_store.id is null then
    raise exception 'store_not_found' using errcode = '02000';
  end if;
  if v_store.status not in ('pending_payment', 'active')
    and not (v_store.status = 'suspended' and v_store.suspension_reason = 'billing_overdue') then
    raise exception 'store_not_billable' using errcode = '42501';
  end if;

  v_workspace_id := v_store.workspace_id;

  -- Trava a ASSINATURA: é ela que serializa duas lojas do mesmo
  -- workspace tentando abrir Pix ao mesmo tempo. Sem isto, o índice
  -- único ainda barraria a segunda, mas com erro bruto em vez de
  -- reaproveitamento idempotente.
  select * into v_subscription from public.workspace_subscriptions
    where workspace_id = v_workspace_id for update;
  if v_subscription.id is null then
    raise exception 'subscription_not_found' using errcode = '02000';
  end if;

  v_current_plan_key := v_subscription.plan_key;

  -- O plano escolhido nunca vira entitlement aqui: viaja só na cobrança.
  -- Um plan_key forjado não vira preço arbitrário — ou casa com o
  -- catálogo, ou vira invalid_plan.
  v_plan_key := coalesce(p_plan_key, v_current_plan_key);
  if v_plan_key is null then
    raise exception 'plan_not_selected' using errcode = '42883';
  end if;

  select price_cents, legacy_plan_code into v_amount_cents, v_plan_code
    from public.platform_plans where plan_key = v_plan_key;
  if v_amount_cents is null then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  if p_payer_doc_type not in ('CPF', 'CNPJ') then
    raise exception 'invalid_payer_document' using errcode = '22023';
  end if;
  if p_payer_doc_last4 !~ '^[0-9]{4}$' then
    raise exception 'invalid_payer_document' using errcode = '22023';
  end if;
  if p_payer_email is null or p_payer_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_payer_email' using errcode = '22023';
  end if;

  -- Por WORKSPACE: uma loja irmã já com Pix aberto impede o segundo.
  select * into v_existing from public.billing_charges
    where workspace_id = v_workspace_id and status in ('creating', 'pending')
    order by created_at desc
    limit 1
    for update;

  if v_existing.id is not null then
    if v_existing.plan_key = v_plan_key
      and (v_existing.status = 'creating' or v_existing.expires_at is null or v_existing.expires_at > now()) then
      return v_existing;
    end if;

    update public.billing_charges
      set status = case when v_existing.plan_key = v_plan_key then 'expired' else 'cancelled' end,
          cancelled_at = now(), updated_at = now()
      where id = v_existing.id;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_existing.store_id,
      case when v_existing.plan_key = v_plan_key then 'billing_charge_expired' else 'billing_charge_cancelled' end,
      'billing_charge', v_existing.id::text,
      jsonb_build_object('reason', case when v_existing.plan_key = v_plan_key then 'expired' else 'plan_changed_before_payment' end,
        'previous_plan_key', v_existing.plan_key, 'new_plan_key', v_plan_key));
  end if;

  select period_end into v_last_period_end
    from public.billing_charges
    where workspace_id = v_workspace_id and status = 'approved'
    order by period_end desc
    limit 1;

  if v_last_period_end is not null and v_last_period_end > now() then
    v_period_start := v_last_period_end;
  else
    v_period_start := now();
  end if;
  v_period_end := v_period_start + interval '30 days';

  v_new_id := gen_random_uuid();

  begin
    insert into public.billing_charges (
      id, store_id, workspace_id, plan_code, plan_key, amount_cents, currency, provider,
      provider_idempotency_key, external_reference,
      status, payer_email, payer_doc_type, payer_doc_last4, period_start, period_end
    ) values (
      v_new_id, p_store_id, v_workspace_id, v_plan_code, v_plan_key, v_amount_cents, 'BRL', 'mercado_pago',
      p_provider_idempotency_key, v_new_id::text,
      'creating', p_payer_email, p_payer_doc_type, p_payer_doc_last4, v_period_start, v_period_end
    )
    returning * into v_charge;
  exception
    when unique_violation then
      select * into v_charge from public.billing_charges
        where workspace_id = v_workspace_id and status in ('creating', 'pending')
        order by created_at desc
        limit 1;
      return v_charge;
  end;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, p_store_id, 'billing_charge_creation_started', 'billing_charge', v_charge.id::text,
    jsonb_build_object('plan_key', v_plan_key, 'amount_cents', v_amount_cents,
      'plan_change', v_current_plan_key is not null and v_current_plan_key <> v_plan_key));

  return v_charge;
end;
$fn$;

comment on function public.billing_charge_upsert_creating(uuid, text, text, text, text, text) is
  'Primeiro passo da orquestração — preço NUNCA vem do cliente, deriva de platform_plans no banco. TASK-012: a cobrança é da ASSINATURA (workspace), não da loja: o plano vigente é lido de workspace_subscriptions e a idempotência é o índice único parcial (workspace_id) WHERE status IN (creating,pending) — com 3 lojas no mesmo workspace continua existindo no máximo UMA cobrança aberta, logo uma única mensalidade. p_plan_key permite renovar trocando de plano; o plano escolhido viaja só na cobrança e só passa a valer quando aprovado.';

revoke all on function public.billing_charge_upsert_creating(uuid, text, text, text, text, text) from public;
grant execute on function public.billing_charge_upsert_creating(uuid, text, text, text, text, text) to service_role;

-- ============================================================
-- 8. billing_charge_apply_provider_state — aplica na ASSINATURA
-- ============================================================
--
-- Corpo de 0011 preservado integralmente; muda apenas o bloco de troca
-- de plano dentro do ramo `approved`, que agora escreve em
-- workspace_subscriptions (fonte de verdade) e projeta em store_plans
-- via workspace_sync_store_plans. Ativação/reativação passam a valer
-- para TODAS as lojas do workspace — é a consequência direta de a
-- assinatura ser do workspace.

create or replace function public.billing_charge_apply_provider_state(
  p_charge_id uuid,
  p_provider_payment_id text,
  p_internal_status text,
  p_provider_status text,
  p_provider_status_detail text,
  p_amount_cents integer,
  p_currency text,
  p_external_reference text,
  p_qr_code text,
  p_qr_code_base64 text,
  p_ticket_url text,
  p_expires_at timestamptz
)
returns public.billing_charges
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_charge public.billing_charges;
  v_previous_status text;
  v_terminal_paid boolean;
  v_terminal_unpaid boolean;
  v_previous_plan_key text;
  v_store record;
  v_activated boolean := false;
  v_reactivated boolean := false;
begin
  if p_internal_status not in ('pending', 'approved', 'rejected', 'cancelled', 'expired') then
    raise exception 'invalid_provider_status' using errcode = '22023';
  end if;

  select * into v_charge from public.billing_charges where id = p_charge_id for update;
  if v_charge.id is null then
    raise exception 'billing_charge_not_found' using errcode = '02000';
  end if;

  if v_charge.provider_payment_id is not null and v_charge.provider_payment_id <> p_provider_payment_id then
    raise exception 'provider_payment_id_mismatch' using errcode = '23514';
  end if;

  if v_charge.status = 'manual_review' then
    return v_charge;
  end if;

  v_previous_status := v_charge.status;
  v_terminal_paid := v_previous_status = 'approved';
  v_terminal_unpaid := v_previous_status in ('rejected', 'cancelled', 'expired');

  if v_charge.external_reference is distinct from p_external_reference
    or v_charge.amount_cents is distinct from p_amount_cents
    or v_charge.currency is distinct from p_currency then

    if v_terminal_paid then
      update public.billing_charges
      set provider_status = p_provider_status, provider_status_detail = p_provider_status_detail,
          last_webhook_at = now(), updated_at = now()
      where id = p_charge_id
      returning * into v_charge;
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'billing_manual_review_required', 'billing_charge', v_charge.id::text,
        jsonb_build_object(
          'reason', 'integrity_mismatch_after_approval',
          'previous_status', v_previous_status,
          'provider_payment_id', p_provider_payment_id,
          'external_reference_mismatch', v_charge.external_reference is distinct from p_external_reference,
          'amount_mismatch', v_charge.amount_cents is distinct from p_amount_cents,
          'currency_mismatch', v_charge.currency is distinct from p_currency,
          'note', 'approved status preserved — período pago não foi afetado'));
      return v_charge;
    end if;

    update public.billing_charges set status = 'manual_review', updated_at = now()
      where id = p_charge_id returning * into v_charge;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_manual_review_required', 'billing_charge', v_charge.id::text,
      jsonb_build_object('reason', 'external_reference_or_amount_mismatch', 'provider_payment_id', p_provider_payment_id));
    return v_charge;
  end if;

  if v_terminal_paid and p_internal_status <> 'approved' then
    update public.billing_charges
    set provider_status = p_provider_status, provider_status_detail = p_provider_status_detail,
        last_webhook_at = now(), updated_at = now()
    where id = p_charge_id
    returning * into v_charge;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_manual_review_required', 'billing_charge', v_charge.id::text,
      jsonb_build_object('reason', 'terminal_state_conflict_after_approval', 'previous_status', v_previous_status, 'incoming_status', p_internal_status, 'provider_payment_id', p_provider_payment_id, 'note', 'approved status preserved — period pago não foi afetado'));
    return v_charge;
  end if;

  if v_terminal_unpaid and p_internal_status = 'approved' then
    update public.billing_charges set status = 'manual_review', updated_at = now()
      where id = p_charge_id returning * into v_charge;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_manual_review_required', 'billing_charge', v_charge.id::text,
      jsonb_build_object('reason', 'terminal_state_conflict', 'previous_status', v_previous_status, 'incoming_status', p_internal_status, 'provider_payment_id', p_provider_payment_id));
    return v_charge;
  end if;

  if v_terminal_paid or v_terminal_unpaid then
    update public.billing_charges
    set provider_status = p_provider_status, provider_status_detail = p_provider_status_detail,
        last_webhook_at = now(), updated_at = now()
    where id = p_charge_id
    returning * into v_charge;
    return v_charge;
  end if;

  if p_internal_status = 'pending' then
    update public.billing_charges
    set provider_status = p_provider_status, provider_status_detail = p_provider_status_detail,
        qr_code = coalesce(p_qr_code, qr_code), qr_code_base64 = coalesce(p_qr_code_base64, qr_code_base64),
        ticket_url = coalesce(p_ticket_url, ticket_url), expires_at = coalesce(p_expires_at, expires_at),
        provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
        last_webhook_at = now(), updated_at = now()
    where id = p_charge_id
    returning * into v_charge;
    return v_charge;
  end if;

  if p_internal_status = 'approved' then
    -- QA-010-001: trava TODAS as lojas do workspace antes de qualquer
    -- efeito, em ordem determinística de id para não deadlockar com
    -- outra transação que percorra as mesmas linhas. Mesmo raciocínio de
    -- 0010 (serializar com billing_suspend_overdue_stores), agora
    -- estendido ao conjunto de lojas que a assinatura governa.
    perform 1 from public.stores
      where workspace_id = v_charge.workspace_id
      order by id
      for update;

    update public.billing_charges
    set status = 'approved', approved_at = now(), provider_status = p_provider_status,
        provider_status_detail = p_provider_status_detail, provider_payment_id = p_provider_payment_id,
        last_webhook_at = now(), updated_at = now()
    where id = p_charge_id
    returning * into v_charge;

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_charge_approved', 'billing_charge', v_charge.id::text,
      jsonb_build_object('plan_key', v_charge.plan_key, 'workspace_id', v_charge.workspace_id,
        'period_start', v_charge.period_start, 'period_end', v_charge.period_end));

    -- TASK-012 — a troca de plano vira realidade AQUI, na ASSINATURA, e
    -- em nenhum outro lugar. O plano viajou na cobrança (com preço já
    -- derivado no banco) e só agora, com pagamento aprovado, passa a
    -- valer para TODAS as lojas do workspace.
    select plan_key into v_previous_plan_key from public.workspace_subscriptions
      where workspace_id = v_charge.workspace_id;

    update public.workspace_subscriptions
      set plan_key = v_charge.plan_key,
          status = 'active',
          started_at = coalesce(started_at, now()),
          updated_at = now()
      where workspace_id = v_charge.workspace_id;

    perform public.workspace_sync_store_plans(v_charge.workspace_id);

    if v_previous_plan_key is distinct from v_charge.plan_key then
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'plan_changed_by_billing', 'store', v_charge.store_id::text,
        jsonb_build_object('charge_id', v_charge.id, 'workspace_id', v_charge.workspace_id,
          'previous_plan_key', v_previous_plan_key, 'new_plan_key', v_charge.plan_key));
    end if;

    -- Ativação/reativação valem para todas as lojas da assinatura.
    for v_store in
      select id, status, suspension_reason from public.stores
        where workspace_id = v_charge.workspace_id order by id
    loop
      update public.stores set status = 'active'
        where id = v_store.id and status = 'pending_payment';
      if found then
        v_activated := true;
        insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
        values (null, v_store.id, 'store_activated_by_billing', 'store', v_store.id::text,
          jsonb_build_object('charge_id', v_charge.id));
        continue;
      end if;

      update public.stores set status = 'active', pre_suspension_status = null, suspension_reason = null
        where id = v_store.id and status = 'suspended' and suspension_reason = 'billing_overdue';
      if found then
        v_reactivated := true;
        insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
        values (null, v_store.id, 'store_reactivated_by_billing', 'store', v_store.id::text,
          jsonb_build_object('charge_id', v_charge.id, 'period_end', v_charge.period_end));
      end if;
    end loop;

    if not v_activated and not v_reactivated then
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'billing_subscription_renewed', 'store', v_charge.store_id::text,
        jsonb_build_object('charge_id', v_charge.id, 'period_end', v_charge.period_end));
    end if;

    return v_charge;
  end if;

  update public.billing_charges
  set status = p_internal_status,
      failed_at = case when p_internal_status = 'rejected' then now() else failed_at end,
      cancelled_at = case when p_internal_status in ('cancelled', 'expired') then now() else cancelled_at end,
      provider_status = p_provider_status, provider_status_detail = p_provider_status_detail,
      provider_payment_id = p_provider_payment_id, last_webhook_at = now(), updated_at = now()
  where id = p_charge_id
  returning * into v_charge;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, v_charge.store_id,
    case p_internal_status
      when 'rejected' then 'billing_charge_rejected'
      when 'cancelled' then 'billing_charge_cancelled'
      else 'billing_charge_expired'
    end,
    'billing_charge', v_charge.id::text,
    jsonb_build_object('provider_payment_id', p_provider_payment_id));

  return v_charge;
end;
$fn$;

comment on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) is
  'Único caminho para aplicar o estado REAL da cobrança (sempre consultado no Mercado Pago, nunca confiado do corpo do webhook). TASK-012: approved é o ÚNICO ponto onde um plano novo passa a valer, e ele agora escreve em workspace_subscriptions — a assinatura do workspace —, projetando em store_plans só como espelho legado. Ativação/reativação alcançam todas as lojas da assinatura. Idempotente e imune a replay: estado terminal já aplicado nunca é reaplicado.';

revoke all on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) from public;
grant execute on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) to service_role;

-- ============================================================
-- 9. billing_get_subscription — leitura por assinatura
-- ============================================================

drop function if exists public.billing_get_subscription(uuid);

create or replace function public.billing_get_subscription(p_store_id uuid)
returns table (
  current_plan_key text,
  current_plan_code integer,
  status text,
  subscribed_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_approved_plan_key text,
  last_approved_amount_cents integer,
  store_count integer,
  max_stores integer
)
language plpgsql
security definer
set search_path = ''
stable
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
      ws.plan_key,
      p.legacy_plan_code,
      ws.status,
      first_charge.approved_at,
      last_charge.period_start,
      last_charge.period_end,
      last_charge.plan_key,
      last_charge.amount_cents,
      (select count(*)::integer from public.stores s where s.workspace_id = v_workspace_id),
      p.max_stores
    from public.workspace_subscriptions ws
    join public.platform_plans p on p.plan_key = ws.plan_key
    left join lateral (
      select bc.approved_at
      from public.billing_charges bc
      where bc.workspace_id = v_workspace_id and bc.status = 'approved'
      order by bc.approved_at asc
      limit 1
    ) first_charge on true
    left join lateral (
      select bc.period_start, bc.period_end, bc.plan_key, bc.amount_cents
      from public.billing_charges bc
      where bc.workspace_id = v_workspace_id and bc.status = 'approved'
      order by bc.period_end desc
      limit 1
    ) last_charge on true
    where ws.workspace_id = v_workspace_id;
end;
$fn$;

comment on function public.billing_get_subscription(uuid) is
  'Resumo da ASSINATURA do workspace ao qual a loja pertence — plano vigente, status, desde quando assina, período pago e uso de lojas (store_count/max_stores) para os indicadores do painel. Período continua definido pela cobrança approved de maior period_end, a mesma regra usada na renovação e na suspensão. Sanitizada: nunca devolve provider_payment_id/idempotency_key/payer_*. Qualquer membro da loja pode ler.';

revoke all on function public.billing_get_subscription(uuid) from public;
grant execute on function public.billing_get_subscription(uuid) to authenticated;

-- ============================================================
-- 10. billing_suspend_overdue_stores — vencimento é da assinatura
-- ============================================================
--
-- Antes: cada loja tinha o próprio vencimento. Agora quem vence é a
-- assinatura; quando ela vence, todas as lojas do workspace caem juntas
-- — coerente com elas serem pagas por uma mensalidade só.

create or replace function public.billing_suspend_overdue_stores()
returns setof public.stores
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_candidate record;
  v_store public.stores;
  v_period_end timestamptz;
begin
  for v_candidate in
    select s2.id, s2.workspace_id from public.stores s2 where s2.status = 'active'
  loop
    select * into v_store from public.stores where id = v_candidate.id for update;
    if v_store.status <> 'active' then
      continue;
    end if;

    -- Leitura FRESCA depois do lock (QA-010-001), agora por assinatura.
    select period_end into v_period_end
      from public.billing_charges
      where workspace_id = v_store.workspace_id and status = 'approved'
      order by period_end desc
      limit 1;

    if v_period_end is null or v_period_end >= now() - interval '7 days' then
      continue;
    end if;

    update public.stores
      set status = 'suspended', pre_suspension_status = 'active', suspension_reason = 'billing_overdue'
      where id = v_store.id
      returning * into v_store;

    update public.workspace_subscriptions
      set status = 'past_due', updated_at = now()
      where workspace_id = v_store.workspace_id and status <> 'past_due';

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_store.id, 'store_suspended_by_billing_overdue', 'store', v_store.id::text,
      jsonb_build_object('grace_days', 7, 'workspace_id', v_store.workspace_id));
    return next v_store;
  end loop;
  return;
end;
$fn$;

comment on function public.billing_suspend_overdue_stores() is
  'Suspende toda loja active cuja ASSINATURA (workspace) está vencida há mais de 7 dias — chamada pelo Vercel Cron diário, nunca pelo cliente. TASK-012: o vencimento passou a ser da assinatura, então todas as lojas do workspace caem juntas, coerente com pagarem uma mensalidade só. Trava cada loja e relê o período depois do lock antes de decidir (QA-010-001). Idempotente.';

revoke all on function public.billing_suspend_overdue_stores() from public;
grant execute on function public.billing_suspend_overdue_stores() to service_role;
