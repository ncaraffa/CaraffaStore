-- TASK-010 — Suspensão automática por atraso de mensalidade (7 dias de
-- carência após o vencimento) + reativação automática ao pagar de novo.
--
-- Antes desta migration, billing_charge_apply_provider_state renovava o
-- período (period_end) a cada Pix aprovado, mas nada olhava period_end
-- depois disso — uma loja `active` continuava `active` para sempre, mesmo
-- anos sem pagar. Este arquivo fecha esse ciclo:
--   1) billing_suspend_overdue_stores() — chamada pelo cron diário
--      (app/api/cron/billing/suspend-overdue/route.ts), suspende toda loja
--      `active` cuja última cobrança `approved` tem period_end há mais de
--      7 dias.
--   2) billing_charge_apply_provider_state — ganha um terceiro ramo no
--      `approved`: além de pending_payment->active (primeira cobrança) e
--      active->active (renovação em dia), agora também
--      suspended(billing_overdue)->active (pagou depois de suspenso).
--   3) billing_charge_upsert_creating — sem isto, uma loja suspensa por
--      atraso nunca conseguiria gerar uma NOVA cobrança pra sair da
--      suspensão (store_not_billable barrava qualquer status fora de
--      pending_payment/active). Abre exceção só para suspended +
--      suspension_reason = 'billing_overdue'.
--
-- Suspensão por atraso NUNCA se confunde com suspensão manual do painel
-- da plataforma (0009_platform_admin.sql): stores.suspension_reason
-- distingue as duas. Pagar a mensalidade em atraso reativa automaticamente
-- só quando o motivo é 'billing_overdue' — uma loja suspensa por
-- platform_admin (fraude, violação de termos etc.) nunca é reativada por
-- um pagamento; só o próprio painel do dono da plataforma pode reverter
-- essa suspensão, exatamente como antes.

-- ============================================================
-- 1. stores.suspension_reason — por que a loja está suspended agora
-- ============================================================

alter table public.stores
  add column if not exists suspension_reason text
    check (suspension_reason in ('platform_admin', 'billing_overdue'));

comment on column public.stores.suspension_reason is
  'Só tem sentido quando status=suspended (nenhuma constraint força isso — mesmo raciocínio de pre_suspension_status). platform_admin = suspensa pelo painel do dono da plataforma (0009_platform_admin.sql), nunca reativada por pagamento. billing_overdue = suspensa por billing_suspend_overdue_stores() (mensalidade vencida há mais de 7 dias), reativada automaticamente pelo próximo Pix aprovado (ver billing_charge_apply_provider_state). NULL quando status<>suspended.';

-- ============================================================
-- 2. billing_suspend_overdue_stores — cron diário (service_role apenas)
-- ============================================================

create or replace function public.billing_suspend_overdue_stores()
returns setof public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_store public.stores;
  v_period_end timestamptz;
begin
  -- QA-010-001 (achado em revisão independente, reproduzido com Postgres
  -- real): uma versão anterior fazia tudo num único UPDATE...FROM,
  -- confiando que o EvalPlanQual do Postgres reavaliaria a condição no
  -- momento do lock. Isso só protege contra uma transação concorrente que
  -- TAMBÉM escreve em `stores` — mas o ramo de renovação simples de
  -- billing_charge_apply_provider_state (loja que já está active e só
  -- estende period_end) nunca toca `stores`, só `billing_charges`. Uma
  -- renovação aprovada bem no meio da janela do cron era invisível pro
  -- UPDATE...FROM (a subquery já tinha sido materializada com o
  -- period_end antigo) e a loja era suspensa mesmo tendo acabado de pagar.
  --
  -- Corrigido com o MESMO padrão já usado em billing_charge_upsert_creating
  -- e billing_charge_apply_provider_state: trava a loja primeiro (`for
  -- update`), só decide depois, com leitura FRESCA de billing_charges feita
  -- depois do lock (cada statement pega snapshot novo em READ COMMITTED).
  -- Isso sozinho não bastaria se a renovação nunca disputasse a mesma trava
  -- — por isso billing_charge_apply_provider_state também passou a travar
  -- `stores` no ramo de renovação simples (ver comentário lá). Com as duas
  -- pontas travando a mesma linha, uma corrida verdadeiramente simultânea
  -- sempre serializa: quem committar primeiro decide o period_end que o
  -- outro lado vai enxergar.
  for v_candidate in
    select s2.id from public.stores s2 where s2.status = 'active'
  loop
    select * into v_store from public.stores where id = v_candidate.id for update;
    if v_store.status <> 'active' then
      continue; -- mudou de status entre a listagem e o lock (ativação/suspensão concorrente)
    end if;

    select period_end into v_period_end
      from public.billing_charges
      where store_id = v_store.id and status = 'approved'
      order by period_end desc
      limit 1;

    if v_period_end is null or v_period_end >= now() - interval '7 days' then
      continue; -- não está (mais) vencida — inclui o caso de ter renovado durante esta varredura
    end if;

    update public.stores
      set status = 'suspended', pre_suspension_status = 'active', suspension_reason = 'billing_overdue'
      where id = v_store.id
      returning * into v_store;

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_store.id, 'store_suspended_by_billing_overdue', 'store', v_store.id::text,
      jsonb_build_object('grace_days', 7));
    return next v_store;
  end loop;
  return;
end;
$$;

comment on function public.billing_suspend_overdue_stores() is
  'Suspende toda loja active cuja última cobrança approved venceu (period_end) há mais de 7 dias — chamada pelo Vercel Cron diário (app/api/cron/billing/suspend-overdue/route.ts), nunca pelo cliente. Trava cada loja candidata (for update) e relê billing_charges depois do lock antes de decidir — nunca suspende com base num period_end pré-lock (QA-010-001). Idempotente: rodar de novo no mesmo dia não redunda (só casa loja ainda active). Devolve as lojas efetivamente suspensas nesta chamada, para o resumo do cron.';

revoke all on function public.billing_suspend_overdue_stores() from public;
grant execute on function public.billing_suspend_overdue_stores() to service_role;

-- ============================================================
-- 3. billing_charge_upsert_creating — reabre para suspended(billing_overdue)
-- ============================================================
--
-- Corpo idêntico ao de 0008_saas_billing.sql, só a guarda de
-- store_not_billable muda (comentada abaixo) — sem isso, uma loja
-- suspensa por atraso nunca teria como gerar um novo Pix pra sair da
-- suspensão.

create or replace function public.billing_charge_upsert_creating(
  p_store_id uuid,
  p_provider_idempotency_key text,
  p_payer_email text,
  p_payer_doc_type text,
  p_payer_doc_last4 text
)
returns public.billing_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores;
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
  -- TASK-010: além de pending_payment/active, também permite quando a
  -- loja está suspended especificamente por billing_overdue — é
  -- exatamente essa cobrança que a tira da suspensão (ver
  -- billing_charge_apply_provider_state). Suspensa por platform_admin
  -- continua barrada aqui: essa suspensão só sai pelo painel do dono.
  if v_store.status not in ('pending_payment', 'active')
    and not (v_store.status = 'suspended' and v_store.suspension_reason = 'billing_overdue') then
    raise exception 'store_not_billable' using errcode = '42501';
  end if;

  select plan_code into v_plan_code from public.store_plans where store_id = p_store_id;
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
    if v_existing.status = 'creating' or v_existing.expires_at is null or v_existing.expires_at > now() then
      return v_existing;
    end if;
    update public.billing_charges set status = 'expired', cancelled_at = now(), updated_at = now()
      where id = v_existing.id;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, p_store_id, 'billing_charge_expired', 'billing_charge', v_existing.id::text, '{}'::jsonb);
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
    jsonb_build_object('plan_code', v_plan_code, 'amount_cents', v_amount_cents));

  return v_charge;
end;
$$;

comment on function public.billing_charge_upsert_creating(uuid, text, text, text, text) is
  'Primeiro passo da orquestração (lib/billing/orchestration.ts) — deriva plan_code/amount_cents do banco (store_plans + platform_plan_price_cents), nunca de parâmetro do cliente. Idempotente por índice único parcial (store_id) WHERE status IN (creating,pending): nunca duas cobranças abertas para a mesma loja, mesmo sob concorrência real. TASK-010: também billável quando suspended por billing_overdue (nunca por platform_admin).';

revoke all on function public.billing_charge_upsert_creating(uuid, text, text, text, text) from public;
grant execute on function public.billing_charge_upsert_creating(uuid, text, text, text, text) to service_role;

-- ============================================================
-- 4. billing_charge_apply_provider_state — ganha o ramo de reativação
-- ============================================================
--
-- Corpo idêntico ao de 0008_saas_billing.sql até o `if p_internal_status
-- = 'approved' then` — só o bloco de efeito colateral em `stores` dentro
-- desse ramo muda (comentado abaixo). O resto (manual_review, conflitos
-- terminais, mismatch de integridade, pending, rejected/cancelled/expired)
-- é reprodução exata, sem nenhuma mudança de comportamento.

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
    -- QA-010-001 (achado em revisão independente): trava a linha da LOJA
    -- também, mesmo antes de saber qual dos três ramos abaixo vai se
    -- aplicar. Sem isto, o ramo de renovação simples (loja já active, só
    -- estende period_end) nunca disputava trava nenhuma com
    -- billing_suspend_overdue_stores() — as duas transações liam/escreviam
    -- sem nunca se serializarem, e uma renovação podia commitar sem que o
    -- cron, rodando ao mesmo tempo, jamais enxergasse. Travando aqui,
    -- qualquer corrida real serializa: quem committar primeiro decide o
    -- period_end/status que o outro lado vai enxergar (o cron relê
    -- billing_charges DEPOIS do próprio lock — ver billing_suspend_overdue_stores).
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

    -- Ativação atômica: primeira cobrança da loja (pending_payment->active).
    update public.stores set status = 'active'
      where id = v_charge.store_id and status = 'pending_payment';
    if found then
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'store_activated_by_billing', 'store', v_charge.store_id::text,
        jsonb_build_object('charge_id', v_charge.id));
      return v_charge;
    end if;

    -- TASK-010 — reativação atômica: loja suspensa por atraso
    -- (billing_overdue) que acabou de pagar volta a active, restaurando
    -- exatamente o estado anterior. pre_suspension_status é sempre
    -- 'active' neste caso (só billing_suspend_overdue_stores grava essa
    -- combinação, e só a partir de uma loja que já estava active) — nada
    -- além do status/flags de suspensão foi tocado enquanto suspensa
    -- (catálogo, pedidos, plano — tudo continua exatamente como estava),
    -- então zerar suspension_reason/pre_suspension_status e voltar pra
    -- active é o "exatamente como estava" completo. Nunca reativa uma
    -- loja suspensa por platform_admin (suspension_reason diferente) —
    -- essa suspensão só sai pelo painel do dono da plataforma
    -- (platform_admin_set_store_status), nunca por um pagamento.
    update public.stores set status = 'active', pre_suspension_status = null, suspension_reason = null
      where id = v_charge.store_id and status = 'suspended' and suspension_reason = 'billing_overdue';
    if found then
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'store_reactivated_by_billing', 'store', v_charge.store_id::text,
        jsonb_build_object('charge_id', v_charge.id, 'period_end', v_charge.period_end));
      return v_charge;
    end if;

    -- Loja já active (nem pending_payment nem suspended billing_overdue):
    -- renovação em dia, só o período muda (já feito acima), sem efeito
    -- colateral em stores.
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
  'Único caminho para aplicar o estado REAL da cobrança (sempre obtido por consulta direta ao Mercado Pago, nunca confiado do corpo do webhook) — usado pelo webhook e pela reconciliação manual, mesma função, mesmo lock. approved ativa a loja (primeira cobrança), reativa (loja suspended por billing_overdue) ou renova o período (loja já active) — nunca duas vezes, mesma proteção idempotente de pix_payment_apply_provider_state. TASK-010 adiciona o ramo de reativação; os demais ramos são idênticos a 0008_saas_billing.sql.';

revoke all on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) from public;
grant execute on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) to service_role;

-- ============================================================
-- 5. platform_admin_set_store_status — passa a gravar/limpar suspension_reason
-- ============================================================
--
-- Corpo idêntico ao de 0009_platform_admin.sql, só grava/zera
-- suspension_reason junto de pre_suspension_status nos dois ramos.

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
      set status = 'suspended', pre_suspension_status = v_store.status, suspension_reason = 'platform_admin'
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
      set status = coalesce(v_store.pre_suspension_status, 'active'), pre_suspension_status = null, suspension_reason = null
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
  'suspend: guarda o status atual em pre_suspension_status e marca suspension_reason=platform_admin antes de suspender (idempotente se já suspensa — não sobrescreve suspension_reason nesse caso, então suspender pelo painel uma loja já suspensa por billing_overdue preserva o motivo original). reactivate: restaura exatamente esse status e limpa suspension_reason — nunca ativa uma loja que estava pending_payment/onboarding só porque foi suspensa e reativada. TASK-010 adiciona suspension_reason; o restante é idêntico a 0009_platform_admin.sql.';

revoke all on function public.platform_admin_set_store_status(uuid, text) from public;
grant execute on function public.platform_admin_set_store_status(uuid, text) to authenticated;

-- ============================================================
-- 6. platform_admin_store_overview — passa a devolver suspension_reason
-- ============================================================
--
-- Corpo idêntico ao de 0009_platform_admin.sql, só acrescenta a coluna
-- nova ao SELECT/retorno — sem isto, o painel do dono da plataforma não
-- tinha como distinguir uma loja suspensa automaticamente por atraso
-- (que se resolve sozinha no próximo Pix aprovado) de uma suspensa
-- manualmente por ele mesmo (achado em revisão independente desta task).
--
-- DROP explícito antes do CREATE OR REPLACE: inserir uma coluna no meio
-- da lista de OUT parameters muda o tipo composto de retorno, e o
-- Postgres recusa CREATE OR REPLACE nesse caso ("cannot change return
-- type of existing function") — só apender no final funcionaria sem
-- DROP, mas manter suspension_reason perto de pre_suspension_status é
-- mais legível. Confirmado testando contra Postgres local antes de
-- aplicar em produção.
drop function if exists public.platform_admin_store_overview();

create or replace function public.platform_admin_store_overview()
returns table (
  store_id uuid,
  slug text,
  name text,
  status text,
  pre_suspension_status text,
  suspension_reason text,
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
      s.id, s.slug, s.name, s.status, s.pre_suspension_status, s.suspension_reason, s.whatsapp,
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
  'Única leitura cross-tenant da plataforma (nunca respeita RLS por linha — is_platform_admin() é o próprio portão). Uma linha por loja: dados da loja, dono (email/nome/whatsapp), cobrança de assinatura mais recente e o motivo da suspensão (TASK-010). suspension_reason só é significativo quando status=suspended.';

revoke all on function public.platform_admin_store_overview() from public;
grant execute on function public.platform_admin_store_overview() to authenticated;

-- ============================================================
-- 7. audit_log_action_check — só ALARGA
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
    'store_reactivated_by_billing'
  ));

comment on constraint audit_log_action_check on public.audit_log is
  'Conjunto de actions só CRESCE entre migrations (nunca estreitar — bloqueador histórico BUG-RT2-006, qa/reports/TASK-002-RETEST.md). TASK-010 adiciona os 2 eventos de suspensão/reativação automática por atraso de mensalidade — todos os valores anteriores permanecem intactos.';
