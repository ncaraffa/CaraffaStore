-- TASK-011 — Área de assinatura no painel do lojista: renovação por
-- iniciativa dele, com troca de plano (subir/descer/manter).
--
-- Três mudanças, todas no mesmo princípio: **dinheiro primeiro, plano
-- depois**.
--
--   1) billing_charge_upsert_creating passa a aceitar p_plan_code. O
--      plano escolhido fica gravado NA COBRANÇA (billing_charges.plan_code,
--      coluna que já existia), nunca em store_plans na hora do clique —
--      senão bastaria clicar em "Profissional" e nunca pagar para usar o
--      plano de R$70 de graça. store_plans continua sendo o plano
--      VIGENTE (pago), não o desejado.
--   2) billing_charge_apply_provider_state aplica a troca em store_plans
--      só no ramo `approved`, na mesma transação que já registra o
--      período pago — é o único ponto do sistema onde um plano novo
--      passa a valer.
--   3) billing_get_subscription — leitura sanitizada para a tela
--      /dashboard/assinatura (desde quando assina, período atual,
--      vencimento). Mesmo padrão de billing_get_current_charge: nunca
--      devolve provider_payment_id/idempotency_key/payer_*.
--
-- Nada aqui toca no ciclo da TASK-010 (suspensão por atraso/reativação):
-- renovar continua sendo exatamente "uma cobrança aprovada", e todos os
-- ramos de ativação/reativação/renovação de 0010 seguem intactos.

-- ============================================================
-- 1. billing_charge_upsert_creating — ganha p_plan_code
-- ============================================================
--
-- DROP explícito antes: acrescentar um parâmetro (mesmo com DEFAULT) cria
-- uma SOBRECARGA em vez de substituir a função, e duas versões coexistindo
-- deixariam a chamada de 5 argumentos ambígua/silenciosamente presa na
-- versão antiga (sem suporte a troca de plano). Ver a mesma lição em
-- 0010_billing_overdue_suspension.sql (platform_admin_store_overview).
drop function if exists public.billing_charge_upsert_creating(uuid, text, text, text, text);

create or replace function public.billing_charge_upsert_creating(
  p_store_id uuid,
  p_provider_idempotency_key text,
  p_payer_email text,
  p_payer_doc_type text,
  p_payer_doc_last4 text,
  p_plan_code integer default null
)
returns public.billing_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
  v_current_plan_code integer;
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
  -- TASK-010: pending_payment/active sempre; suspended só quando o motivo
  -- é billing_overdue (pagar é justamente o que tira dessa suspensão).
  -- Suspensa por platform_admin continua barrada.
  if v_store.status not in ('pending_payment', 'active')
    and not (v_store.status = 'suspended' and v_store.suspension_reason = 'billing_overdue') then
    raise exception 'store_not_billable' using errcode = '42501';
  end if;

  select plan_code into v_current_plan_code from public.store_plans where store_id = p_store_id;

  -- TASK-011: p_plan_code é o plano ESCOLHIDO para esta cobrança
  -- (renovação com upgrade/downgrade). Ausente = mantém o plano vigente.
  -- O preço NUNCA vem do cliente: mesmo com p_plan_code, o valor sai de
  -- platform_plan_price_cents no banco, e o código é validado contra a
  -- mesma lista fechada (30/50/80) — um plan_code forjado vira
  -- invalid_plan_code, nunca uma cobrança de valor arbitrário.
  v_plan_code := coalesce(p_plan_code, v_current_plan_code);
  if v_plan_code is null then
    raise exception 'plan_not_selected' using errcode = '42883';
  end if;

  v_amount_cents := public.platform_plan_price_cents(v_plan_code);
  if v_amount_cents is null then
    raise exception 'invalid_plan_code' using errcode = '22023';
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

  select * into v_existing from public.billing_charges
    where store_id = p_store_id and status in ('creating', 'pending')
    order by created_at desc
    limit 1
    for update;

  if v_existing.id is not null then
    -- TASK-011: reaproveitar a cobrança em aberto só faz sentido quando é
    -- do MESMO plano. Se o lojista voltou e escolheu outro plano antes de
    -- pagar, a cobrança antiga (valor do plano anterior) não serve — seria
    -- entregue um QR de R$30 para quem escolheu R$70. Nesse caso ela é
    -- encerrada aqui e uma nova é criada logo abaixo, na MESMA transação.
    -- Se o lojista pagar o QR antigo mesmo assim (janela estreita, já
    -- tinha o código copiado), billing_charge_apply_provider_state trata
    -- como conflito terminal e manda para manual_review em vez de decidir
    -- sozinho — nunca ativa nem perde o pagamento silenciosamente.
    if v_existing.plan_code = v_plan_code
      and (v_existing.status = 'creating' or v_existing.expires_at is null or v_existing.expires_at > now()) then
      return v_existing;
    end if;

    update public.billing_charges
      set status = case when v_existing.plan_code = v_plan_code then 'expired' else 'cancelled' end,
          cancelled_at = now(), updated_at = now()
      where id = v_existing.id;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, p_store_id,
      case when v_existing.plan_code = v_plan_code then 'billing_charge_expired' else 'billing_charge_cancelled' end,
      'billing_charge', v_existing.id::text,
      jsonb_build_object('reason', case when v_existing.plan_code = v_plan_code then 'expired' else 'plan_changed_before_payment' end,
        'previous_plan_code', v_existing.plan_code, 'new_plan_code', v_plan_code));
  end if;

  select period_end into v_last_period_end
    from public.billing_charges
    where store_id = p_store_id and status = 'approved'
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
      id, store_id, plan_code, amount_cents, currency, provider, provider_idempotency_key, external_reference,
      status, payer_email, payer_doc_type, payer_doc_last4, period_start, period_end
    ) values (
      v_new_id, p_store_id, v_plan_code, v_amount_cents, 'BRL', 'mercado_pago', p_provider_idempotency_key, v_new_id::text,
      'creating', p_payer_email, p_payer_doc_type, p_payer_doc_last4, v_period_start, v_period_end
    )
    returning * into v_charge;
  exception
    when unique_violation then
      select * into v_charge from public.billing_charges
        where store_id = p_store_id and status in ('creating', 'pending')
        order by created_at desc
        limit 1;
      return v_charge;
  end;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, p_store_id, 'billing_charge_creation_started', 'billing_charge', v_charge.id::text,
    jsonb_build_object('plan_code', v_plan_code, 'amount_cents', v_amount_cents,
      'plan_change', v_current_plan_code is not null and v_current_plan_code <> v_plan_code));

  return v_charge;
end;
$$;

comment on function public.billing_charge_upsert_creating(uuid, text, text, text, text, integer) is
  'Primeiro passo da orquestração (lib/billing/orchestration.ts) — o preço NUNCA vem do cliente: deriva de platform_plan_price_cents no banco. TASK-011: p_plan_code permite renovar trocando de plano; o plano escolhido fica só na cobrança (billing_charges.plan_code) e só passa a valer em store_plans quando o pagamento é aprovado (billing_charge_apply_provider_state). Cobrança em aberto de OUTRO plano é cancelada e recriada; do mesmo plano é reaproveitada (idempotente por índice único parcial). TASK-010: billável também quando suspended por billing_overdue.';

revoke all on function public.billing_charge_upsert_creating(uuid, text, text, text, text, integer) from public;
grant execute on function public.billing_charge_upsert_creating(uuid, text, text, text, text, integer) to service_role;

-- ============================================================
-- 2. billing_charge_apply_provider_state — aplica a troca de plano
-- ============================================================
--
-- Corpo idêntico ao de 0010_billing_overdue_suspension.sql; a única
-- mudança é o bloco marcado TASK-011 dentro do ramo `approved`, logo
-- depois do audit de billing_charge_approved e ANTES dos três ramos de
-- efeito em `stores` (que retornam cedo) — assim a troca de plano vale
-- igualmente para primeira ativação, reativação e renovação em dia.

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
as $$
declare
  v_charge public.billing_charges;
  v_previous_status text;
  v_terminal_paid boolean;
  v_terminal_unpaid boolean;
  v_previous_plan_code integer;
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
    -- QA-010-001: trava a linha da LOJA antes de qualquer efeito, mesmo
    -- quando o ramo aplicável não muda `stores` (renovação simples) — é o
    -- que serializa esta transação com billing_suspend_overdue_stores().
    perform 1 from public.stores where id = v_charge.store_id for update;

    update public.billing_charges
    set status = 'approved', approved_at = now(), provider_status = p_provider_status,
        provider_status_detail = p_provider_status_detail, provider_payment_id = p_provider_payment_id,
        last_webhook_at = now(), updated_at = now()
    where id = p_charge_id
    returning * into v_charge;

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_charge_approved', 'billing_charge', v_charge.id::text,
      jsonb_build_object('plan_code', v_charge.plan_code, 'period_start', v_charge.period_start, 'period_end', v_charge.period_end));

    -- TASK-011 — a troca de plano vira realidade AQUI e em nenhum outro
    -- lugar: o plano escolhido viajou na cobrança (billing_charges.plan_code,
    -- com preço já derivado no banco na criação) e só agora, com o
    -- pagamento aprovado, passa a valer em store_plans. Fica antes dos
    -- três ramos de status abaixo (que retornam cedo) de propósito —
    -- vale igual para primeira ativação, reativação e renovação em dia.
    -- Upsert em vez de update puro: cobre o caso extremo de uma loja sem
    -- linha em store_plans sem falhar silenciosamente.
    select plan_code into v_previous_plan_code from public.store_plans where store_id = v_charge.store_id;
    if v_previous_plan_code is distinct from v_charge.plan_code then
      insert into public.store_plans (store_id, plan_code, selected_at)
      values (v_charge.store_id, v_charge.plan_code, now())
      on conflict (store_id) do update set plan_code = excluded.plan_code, selected_at = excluded.selected_at;

      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'plan_changed_by_billing', 'store', v_charge.store_id::text,
        jsonb_build_object('charge_id', v_charge.id, 'previous_plan_code', v_previous_plan_code, 'new_plan_code', v_charge.plan_code));
    end if;

    -- Ativação atômica: primeira cobrança da loja (pending_payment->active).
    update public.stores set status = 'active'
      where id = v_charge.store_id and status = 'pending_payment';
    if found then
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'store_activated_by_billing', 'store', v_charge.store_id::text,
        jsonb_build_object('charge_id', v_charge.id));
      return v_charge;
    end if;

    -- TASK-010 — reativação atômica: loja suspensa por atraso que pagou
    -- volta a active, restaurando exatamente o estado anterior. Nunca
    -- reativa suspensão por platform_admin.
    update public.stores set status = 'active', pre_suspension_status = null, suspension_reason = null
      where id = v_charge.store_id and status = 'suspended' and suspension_reason = 'billing_overdue';
    if found then
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'store_reactivated_by_billing', 'store', v_charge.store_id::text,
        jsonb_build_object('charge_id', v_charge.id, 'period_end', v_charge.period_end));
      return v_charge;
    end if;

    -- Renovação de loja já active: só o período muda (já gravado acima),
    -- nenhum efeito colateral em stores — a loja continua exatamente como
    -- estava (catálogo, pedidos, configurações, tudo intacto).
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_subscription_renewed', 'store', v_charge.store_id::text,
      jsonb_build_object('charge_id', v_charge.id, 'period_end', v_charge.period_end));

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
$$;

comment on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) is
  'Único caminho para aplicar o estado REAL da cobrança (sempre consultado no Mercado Pago, nunca confiado do corpo do webhook) — usado pelo webhook e pela reconciliação. approved ativa (primeira cobrança), reativa (suspended por billing_overdue) ou renova (já active), sempre idempotente. TASK-011: é também o ÚNICO ponto onde uma troca de plano passa a valer em store_plans — nunca no clique do lojista, só com pagamento aprovado.';

revoke all on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) from public;
grant execute on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) to service_role;

-- ============================================================
-- 3. billing_get_subscription — leitura sanitizada (authenticated)
-- ============================================================

create or replace function public.billing_get_subscription(p_store_id uuid)
returns table (
  current_plan_code integer,
  subscribed_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_approved_plan_code integer,
  last_approved_amount_cents integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
    select
      sp.plan_code,
      first_charge.approved_at,
      last_charge.period_start,
      last_charge.period_end,
      last_charge.plan_code,
      last_charge.amount_cents
    from (select 1) dummy
    left join public.store_plans sp on sp.store_id = p_store_id
    -- Primeira cobrança aprovada = "assina desde". approved_at, não
    -- created_at: o que importa é quando o pagamento entrou, não quando o
    -- Pix foi gerado (uma cobrança gerada e nunca paga não inicia nada).
    left join lateral (
      select bc.approved_at
      from public.billing_charges bc
      where bc.store_id = p_store_id and bc.status = 'approved'
      order by bc.approved_at asc
      limit 1
    ) first_charge on true
    -- Período VIGENTE = cobrança aprovada de maior period_end, exatamente
    -- a mesma regra que billing_charge_upsert_creating usa para calcular a
    -- próxima renovação e que billing_suspend_overdue_stores usa para
    -- decidir atraso. Três lugares, uma única definição de "até quando
    -- está pago".
    left join lateral (
      select bc.period_start, bc.period_end, bc.plan_code, bc.amount_cents
      from public.billing_charges bc
      where bc.store_id = p_store_id and bc.status = 'approved'
      order by bc.period_end desc
      limit 1
    ) last_charge on true;
end;
$$;

comment on function public.billing_get_subscription(uuid) is
  'Resumo da assinatura da loja para /dashboard/assinatura — desde quando assina (primeira cobrança aprovada), período pago vigente (cobrança aprovada de maior period_end) e plano atual. Mesma sanitização de billing_get_current_charge: nunca devolve provider_payment_id/provider_idempotency_key/payer_email/payer_doc_*. Qualquer membro da loja pode ler (is_store_member).';

revoke all on function public.billing_get_subscription(uuid) from public;
grant execute on function public.billing_get_subscription(uuid) to authenticated;

-- ============================================================
-- 4. audit_log_action_check — só ALARGA
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
    'store_reactivated_by_platform_admin',
    'store_suspended_by_billing_overdue',
    'store_reactivated_by_billing',
    'plan_changed_by_billing'
  ));

comment on constraint audit_log_action_check on public.audit_log is
  'Conjunto de actions só CRESCE entre migrations (nunca estreitar — bloqueador histórico BUG-RT2-006, qa/reports/TASK-002-RETEST.md). TASK-011 adiciona plan_changed_by_billing (troca de plano efetivada por pagamento aprovado) — todos os valores anteriores permanecem intactos.';
