-- TASK-007 — Billing da própria CaraffaStore (assinatura mensal via Pix)
-- + ativação automática de loja.
--
-- Dois contextos completamente separados, nunca misturados:
--   A) esta migration — a CaraffaStore cobra o COMERCIANTE pela
--      assinatura da plataforma;
--   B) 0007_payments.sql (store_payment_settings/order_payments) — a
--      LOJA do comerciante cobra o CLIENTE FINAL pelas compras.
-- As credenciais de pagamento são inteiramente distintas: esta migration
-- nunca lê store_payment_settings, e o billing da plataforma usa
-- credenciais só em variável de ambiente do processo Next.js
-- (PLATFORM_MP_ACCESS_TOKEN/PLATFORM_MP_WEBHOOK_SECRET, nunca no banco,
-- nunca NEXT_PUBLIC_ — ver lib/payments/service-only/platform-credentials.ts).
--
-- Mesmo desenho de autorização/idempotência/concorrência de
-- 0007_payments.sql: funções SECURITY DEFINER dedicadas, service_role
-- para orquestração/webhook, authenticated só para leitura sanitizada,
-- lock de linha antes de decidir efeito de negócio, estado terminal
-- nunca reaplicado, divergência de valor/referência vira manual_review
-- em vez de decidir sozinha.
--
-- Sem tabela de "assinatura" separada: o período pago (period_start/
-- period_end) já vive em cada linha de billing_charges aprovada — a
-- cobrança aprovada MAIS RECENTE é a fonte de verdade do período atual
-- (billing_charge_upsert_creating lê isso para calcular a próxima
-- cobrança/renovação). Menos uma tabela para manter sincronizada.

-- ============================================================
-- 0. Preço comercial por plan_code — única fonte de verdade no banco
-- ============================================================
--
-- Espelha PLATFORM_PLANS (lib/billing/plans.ts) e PLANS
-- (app/onboarding/plan-step.tsx): Essencial R$30, Crescimento R$50,
-- Profissional R$70 — mesmo identificador técnico legado plan_code=80
-- para o Profissional (docs/PLANS-SPEC.md; NÃO renomear para 70 aqui,
-- exigiria migration própria fora do escopo desta tarefa). O cliente
-- NUNCA envia amount_cents — toda cobrança deriva o valor chamando esta
-- função a partir do plan_code já salvo em store_plans, nunca de um
-- parâmetro vindo do navegador.
create or replace function public.platform_plan_price_cents(p_plan_code integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan_code
    when 30 then 3000
    when 50 then 5000
    when 80 then 7000
    else null
  end;
$$;

comment on function public.platform_plan_price_cents(integer) is
  'Preço comercial atual em centavos por plan_code (30->3000, 50->5000, 80->7000 — Profissional R$70 com identificador técnico legado 80). NULL para plan_code desconhecido; billing_charge_upsert_creating trata isso como invalid_plan_code. Mudar preço = trocar só aqui (nova migration) + lib/billing/plans.ts + app/onboarding/plan-step.tsx — os três precisam concordar.';

revoke all on function public.platform_plan_price_cents(integer) from public;
grant execute on function public.platform_plan_price_cents(integer) to authenticated, service_role;

-- ============================================================
-- 1. billing_charges — uma cobrança Pix da assinatura por vez, por loja
-- ============================================================

create table public.billing_charges (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  plan_code integer not null check (plan_code in (30, 50, 80)),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'BRL',
  provider text not null default 'mercado_pago' check (provider in ('mercado_pago')),
  provider_payment_id text,
  provider_idempotency_key text not null check (char_length(provider_idempotency_key) between 1 and 64),
  external_reference text not null unique,
  status text not null default 'creating' check (status in (
    'creating', 'pending', 'approved', 'rejected', 'cancelled', 'expired', 'error', 'manual_review'
  )),
  provider_status text,
  provider_status_detail text,
  payer_email text not null,
  payer_doc_type text not null check (payer_doc_type in ('CPF', 'CNPJ')),
  payer_doc_last4 text not null check (payer_doc_last4 ~ '^[0-9]{4}$'),
  period_start timestamptz not null,
  period_end timestamptz not null,
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  expires_at timestamptz,
  approved_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  last_webhook_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_charges_store_idempotency_unique unique (store_id, provider_idempotency_key),
  constraint billing_charges_provider_payment_id_unique unique (provider, provider_payment_id)
);

comment on table public.billing_charges is
  'Cobrança Pix da assinatura MENSAL da CaraffaStore para o comerciante — nunca confundir com order_payments (loja cobrando cliente final, 0007_payments.sql). amount_cents é sempre snapshot: calculado uma única vez a partir de platform_plan_price_cents(plan_code) no momento da criação, nunca recalculado depois — uma mudança futura de preço não altera cobrança já criada. external_reference = próprio id (gerado pelo banco), enviado ao Mercado Pago e conferido de volta em todo webhook/reconciliação antes de aplicar qualquer transição, exatamente como order_payments.';

comment on column public.billing_charges.period_start is
  'Início do período de 30 dias que esta cobrança paga. Para a primeira cobrança da loja, period_start = momento da criação; para renovação antes do vencimento, period_start = period_end da última cobrança aprovada (continuidade sem lacuna) — ver billing_charge_upsert_creating.';

comment on column public.billing_charges.status is
  'Mesmo vocabulário de order_payments.status. approved ativa a loja (pending_payment->active) ou renova (extende o período) — nunca duas vezes: billing_charge_apply_provider_state trava a linha e trata estado terminal já aplicado como idempotente. rejected/cancelled/expired não têm efeito colateral (loja simplesmente continua pending_payment, sem estoque/pedido envolvido).';

-- Só UMA cobrança "em aberto" por loja a qualquer momento — é isto que
-- impede criação infinita de cobrança a cada refresh/duplo clique/duas
-- abas: uma segunda tentativa de INSERT concorrente colide aqui, nunca
-- em memória/aplicação.
create unique index billing_charges_one_active_per_store
  on public.billing_charges (store_id)
  where status in ('creating', 'pending');

create index billing_charges_store_status_idx on public.billing_charges (store_id, status);
create index billing_charges_store_period_idx on public.billing_charges (store_id, period_end desc) where status = 'approved';

-- QA-FINAL-006 (achado no QA independente): SEM nenhuma policy pra
-- `authenticated` e SEM GRANT de SELECT — mesmo padrão deny-by-default
-- de billing_webhook_events/payment_webhook_events/audit_log. A leitura
-- sanitizada (billing_get_current_charge, mais abaixo) já cobre
-- exatamente o que a tela pending-payment precisa; um GRANT SELECT
-- bruto aqui contornaria a sanitização por completo (qualquer membro
-- autenticado poderia consultar provider_payment_id/
-- provider_idempotency_key/payer_email/payer_doc_* direto da tabela,
-- ignorando o RPC).
alter table public.billing_charges enable row level security;

revoke all on public.billing_charges from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.billing_charges to service_role;

-- ============================================================
-- 2. billing_webhook_events — log append-only (dedup), mesmo padrão de
--    payment_webhook_events
-- ============================================================

create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  charge_id uuid references public.billing_charges (id) on delete set null,
  provider text not null default 'mercado_pago' check (provider in ('mercado_pago')),
  provider_event_id text,
  provider_payment_id text,
  action text,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received' check (processing_status in (
    'received', 'processed', 'ignored', 'rejected', 'error'
  )),
  error_code text,
  constraint billing_webhook_events_dedup_unique unique (store_id, provider_payment_id, payload_hash)
);

comment on table public.billing_webhook_events is
  'Log append-only das notificações do webhook de billing da plataforma (/api/webhooks/platform-billing) — nunca guarda Access Token/Webhook Secret/assinatura completa. payload_hash deduplica entregas repetidas do próprio Mercado Pago sem depender de provider_event_id sempre presente, mesmo raciocínio de payment_webhook_events.';

create index billing_webhook_events_charge_idx on public.billing_webhook_events (charge_id, received_at desc);

alter table public.billing_webhook_events enable row level security;

-- Sem NENHUMA policy (RLS habilitada + zero policy = negado por
-- padrão) — mesmo desenho de payment_webhook_events/audit_log. Nenhuma
-- UI desta tarefa lê o log bruto.
revoke all on public.billing_webhook_events from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.billing_webhook_events to service_role;

-- ============================================================
-- 3. billing_charge_* — orquestração (service_role apenas)
-- ============================================================

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
  -- Trava a loja primeiro: serializa qualquer tentativa concorrente de
  -- criar cobrança para a MESMA loja (duas abas, duplo clique, retry),
  -- mesmo raciocínio de onboarding_complete (pg_advisory_xact_lock) só
  -- que via lock de linha real, já que já precisamos ler a loja mesmo.
  select * into v_store from public.stores where id = p_store_id for update;
  if v_store.id is null then
    raise exception 'store_not_found' using errcode = '02000';
  end if;
  if v_store.status not in ('pending_payment', 'active') then
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

  -- Reaproveita cobrança ainda em aberto (creating ou pending não
  -- expirada) — refresh/duplo clique/duas abas nunca criam uma segunda.
  select * into v_existing from public.billing_charges
    where store_id = p_store_id and status in ('creating', 'pending')
    order by created_at desc
    limit 1
    for update;

  if v_existing.id is not null then
    if v_existing.status = 'creating' or v_existing.expires_at is null or v_existing.expires_at > now() then
      return v_existing;
    end if;
    -- Pendente mas expirada: encerra (libera o índice único parcial)
    -- antes de abrir uma nova, na MESMA transação.
    update public.billing_charges set status = 'expired', cancelled_at = now(), updated_at = now()
      where id = v_existing.id;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, p_store_id, 'billing_charge_expired', 'billing_charge', v_existing.id::text, '{}'::jsonb);
  end if;

  -- Próximo período: continuação sem lacuna se a última cobrança
  -- aprovada ainda não venceu (renovação adiantada); senão, começa agora.
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
      -- Corrida real: outra requisição venceu (índice único parcial por
      -- store_id). Devolve a cobrança que já existe, nunca duas.
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
  'Primeiro passo da orquestração (lib/billing/orchestration.ts) — deriva plan_code/amount_cents do banco (store_plans + platform_plan_price_cents), nunca de parâmetro do cliente. Idempotente por índice único parcial (store_id) WHERE status IN (creating,pending): nunca duas cobranças abertas para a mesma loja, mesmo sob concorrência real.';

create or replace function public.billing_charge_mark_created(
  p_charge_id uuid,
  p_provider_payment_id text,
  p_provider_status text,
  p_provider_status_detail text,
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
begin
  select * into v_charge from public.billing_charges where id = p_charge_id for update;
  if v_charge.id is null then
    raise exception 'billing_charge_not_found' using errcode = '02000';
  end if;
  if v_charge.status <> 'creating' then
    return v_charge; -- resposta tardia de um retry — idempotente.
  end if;

  update public.billing_charges
  set provider_payment_id = p_provider_payment_id,
      status = 'pending',
      provider_status = p_provider_status,
      provider_status_detail = p_provider_status_detail,
      qr_code = p_qr_code,
      qr_code_base64 = p_qr_code_base64,
      ticket_url = p_ticket_url,
      expires_at = p_expires_at,
      updated_at = now()
  where id = p_charge_id
  returning * into v_charge;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, v_charge.store_id, 'billing_charge_created', 'billing_charge', v_charge.id::text,
    jsonb_build_object('provider_payment_id', p_provider_payment_id));

  return v_charge;
end;
$$;

create or replace function public.billing_charge_mark_creation_failed(
  p_charge_id uuid,
  p_error_code text
)
returns public.billing_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge public.billing_charges;
begin
  select * into v_charge from public.billing_charges where id = p_charge_id for update;
  if v_charge.id is null then
    raise exception 'billing_charge_not_found' using errcode = '02000';
  end if;
  if v_charge.status <> 'creating' then
    return v_charge; -- já resolvido — idempotente.
  end if;

  update public.billing_charges
  set status = 'error', failed_at = now(), provider_status_detail = p_error_code, updated_at = now()
  where id = p_charge_id
  returning * into v_charge;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, v_charge.store_id, 'billing_charge_rejected', 'billing_charge', v_charge.id::text,
    jsonb_build_object('reason', p_error_code));

  return v_charge;
end;
$$;

comment on function public.billing_charge_mark_creation_failed(uuid, text) is
  'Erro DEFINITIVO na criação (credencial da plataforma inválida, recusa do Mercado Pago) — nunca para erro transitório (timeout/5xx), que mantém status=creating para retry com a MESMA idempotency key. Sem efeito colateral em stores/estoque (billing não reserva nada na criação).';

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
  v_terminal_paid boolean;
  v_terminal_unpaid boolean;
begin
  if p_internal_status not in ('pending', 'approved', 'rejected', 'cancelled', 'expired') then
    raise exception 'invalid_provider_status' using errcode = '22023';
  end if;

  -- Trava a linha da COBRANÇA primeiro: webhook duplicado, webhook +
  -- reconciliação simultâneos, duas reconciliações concorrentes
  -- serializam aqui — a segunda só prossegue depois que a primeira já
  -- decidiu, nunca as duas ativam a loja. Mesmo desenho de
  -- pix_payment_apply_provider_state (0007_payments.sql).
  select * into v_charge from public.billing_charges where id = p_charge_id for update;
  if v_charge.id is null then
    raise exception 'billing_charge_not_found' using errcode = '02000';
  end if;

  if v_charge.provider_payment_id is not null and v_charge.provider_payment_id <> p_provider_payment_id then
    raise exception 'provider_payment_id_mismatch' using errcode = '23514';
  end if;

  if v_charge.status = 'manual_review' then
    return v_charge; -- já sinalizado para revisão humana — nunca decide sozinho depois disso.
  end if;

  -- QA-FINAL-003 (achado no QA independente): `<>` com operando NULL
  -- avalia para NULL em SQL, e `if null then` em PL/pgSQL é tratado como
  -- falso — ou seja, um provider_state chegando SEM external_reference/
  -- amount_cents/currency (nulo) passaria pela checagem de integridade
  -- como se estivesse correto. `IS DISTINCT FROM` é null-safe (NULL só é
  -- igual a NULL, nunca "igual" a um valor real): qualquer campo crítico
  -- ausente/divergente sempre cai em manual_review, nunca ativa.
  if v_charge.external_reference is distinct from p_external_reference
    or v_charge.amount_cents is distinct from p_amount_cents
    or v_charge.currency is distinct from p_currency then
    update public.billing_charges set status = 'manual_review', updated_at = now()
      where id = p_charge_id returning * into v_charge;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_manual_review_required', 'billing_charge', v_charge.id::text,
      jsonb_build_object('reason', 'external_reference_or_amount_mismatch', 'provider_payment_id', p_provider_payment_id));
    return v_charge;
  end if;

  v_terminal_paid := v_charge.status = 'approved';
  v_terminal_unpaid := v_charge.status in ('rejected', 'cancelled', 'expired');

  -- QA-003 (achado no QA dinâmico da TASK-007): uma cobrança já
  -- `approved` — com amount/currency/external_reference já conferidos
  -- acima — representa um período pago CONSUMADO (period_start/
  -- period_end, base de toda renovação futura via
  -- billing_charge_upsert_creating). Um evento terminal conflitante
  -- chegando DEPOIS (ex.: `expired`/`cancelled` tardio, stale ou
  -- incorreto do provedor) NUNCA pode apagar esse fato — isso destruiria
  -- silenciosamente o registro do período pago sem nenhum fluxo
  -- explícito de estorno/chargeback (fora do escopo desta task). Por
  -- isso este caso NÃO muda `status`/`approved_at`/`period_start`/
  -- `period_end` — só registra a anomalia em audit_log para revisão
  -- humana e atualiza metadados de rastreio, exatamente como o ramo
  -- "já terminal e coerente" abaixo.
  if v_terminal_paid and p_internal_status <> 'approved' then
    update public.billing_charges
    set provider_status = p_provider_status, provider_status_detail = p_provider_status_detail,
        last_webhook_at = now(), updated_at = now()
    where id = p_charge_id
    returning * into v_charge;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_manual_review_required', 'billing_charge', v_charge.id::text,
      jsonb_build_object('reason', 'terminal_state_conflict_after_approval', 'previous_status', 'approved', 'incoming_status', p_internal_status, 'provider_payment_id', p_provider_payment_id, 'note', 'approved status preserved — period pago não foi afetado'));
    return v_charge;
  end if;

  -- Sentido oposto: cobrança já terminal SEM pagamento (rejected/
  -- cancelled/expired) recebendo um `approved` tardio. Aqui SIM vai para
  -- manual_review — não existe fato de pagamento consumado para
  -- preservar, e ativar automaticamente a partir de um estado já
  -- encerrado é o tipo de decisão que precisa de revisão humana (evita
  -- ativação por evento duplicado/fora de ordem do provedor).
  if v_terminal_unpaid and p_internal_status = 'approved' then
    update public.billing_charges set status = 'manual_review', updated_at = now()
      where id = p_charge_id returning * into v_charge;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_manual_review_required', 'billing_charge', v_charge.id::text,
      jsonb_build_object('reason', 'terminal_state_conflict', 'previous_status', v_charge.status, 'incoming_status', p_internal_status, 'provider_payment_id', p_provider_payment_id));
    return v_charge;
  end if;

  if v_terminal_paid or v_terminal_unpaid then
    -- Já terminal e coerente com o novo evento — idempotente: só
    -- atualiza metadados de rastreio, nunca reativa/reprocessa.
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
    update public.billing_charges
    set status = 'approved', approved_at = now(), provider_status = p_provider_status,
        provider_status_detail = p_provider_status_detail, provider_payment_id = p_provider_payment_id,
        last_webhook_at = now(), updated_at = now()
    where id = p_charge_id
    returning * into v_charge;

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_charge.store_id, 'billing_charge_approved', 'billing_charge', v_charge.id::text,
      jsonb_build_object('plan_code', v_charge.plan_code, 'period_start', v_charge.period_start, 'period_end', v_charge.period_end));

    -- Ativação atômica: só transiciona pending_payment->active (uma vez —
    -- WHERE status='pending_payment' torna a segunda chamada um no-op sem
    -- erro). Loja já active (renovação) só ganha o novo período acima,
    -- sem mudança de status. `stores` nunca teve coluna updated_at (ver
    -- 0001_init.sql) — só status muda aqui, ao contrário de
    -- billing_charges/order_payments, que têm updated_at próprio.
    update public.stores set status = 'active'
      where id = v_charge.store_id and status = 'pending_payment';
    if found then
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'store_activated_by_billing', 'store', v_charge.store_id::text,
        jsonb_build_object('charge_id', v_charge.id));
    else
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_charge.store_id, 'billing_subscription_renewed', 'store', v_charge.store_id::text,
        jsonb_build_object('charge_id', v_charge.id, 'period_end', v_charge.period_end));
    end if;

    return v_charge;
  end if;

  -- rejected / cancelled / expired: pagamento termina sem pagar, loja
  -- simplesmente continua no status atual (nenhum efeito colateral).
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
  'Único caminho para aplicar o estado REAL da cobrança (sempre obtido por consulta direta ao Mercado Pago, nunca confiado do corpo do webhook) — usado pelo webhook e pela reconciliação manual, mesma função, mesmo lock. external_reference/amount/currency divergentes ou estado terminal conflitante nunca decidem sozinhos: viram manual_review + auditoria crítica. approved ativa a loja (primeira cobrança) OU renova o período (loja já active) — nunca duas vezes, mesma proteção idempotente de pix_payment_apply_provider_state.';

revoke all on function public.billing_charge_upsert_creating(uuid, text, text, text, text) from public;
revoke all on function public.billing_charge_mark_created(uuid, text, text, text, text, text, text, timestamptz) from public;
revoke all on function public.billing_charge_mark_creation_failed(uuid, text) from public;
revoke all on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) from public;
grant execute on function public.billing_charge_upsert_creating(uuid, text, text, text, text) to service_role;
grant execute on function public.billing_charge_mark_created(uuid, text, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.billing_charge_mark_creation_failed(uuid, text) to service_role;
grant execute on function public.billing_charge_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) to service_role;

-- ============================================================
-- 4. billing_webhook_event_record — registro (service_role)
-- ============================================================

create or replace function public.billing_webhook_event_record(
  p_store_id uuid,
  p_charge_id uuid,
  p_provider_event_id text,
  p_provider_payment_id text,
  p_action text,
  p_payload_hash text,
  p_processing_status text,
  p_error_code text
)
returns table (event_id uuid, is_duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.billing_webhook_events (
    store_id, charge_id, provider_event_id, provider_payment_id, action,
    payload_hash, processing_status, processed_at, error_code
  ) values (
    p_store_id, p_charge_id, p_provider_event_id, p_provider_payment_id, p_action,
    p_payload_hash, p_processing_status, case when p_processing_status <> 'received' then now() else null end, p_error_code
  )
  on conflict (store_id, provider_payment_id, payload_hash) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.billing_webhook_events
    where store_id = p_store_id and provider_payment_id = p_provider_payment_id and payload_hash = p_payload_hash
    limit 1;
    return query select v_id, true;
  else
    return query select v_id, false;
  end if;
end;
$$;

comment on function public.billing_webhook_event_record(uuid, uuid, text, text, text, text, text, text) is
  'Registra a notificação recebida no webhook de billing (UNIQUE (store_id, provider_payment_id, payload_hash) deduplica entregas repetidas). is_duplicate=true permite responder 200 sem reprocessar — mas mesmo se reprocessar, billing_charge_apply_provider_state é idempotente por construção.';

revoke all on function public.billing_webhook_event_record(uuid, uuid, text, text, text, text, text, text) from public;
grant execute on function public.billing_webhook_event_record(uuid, uuid, text, text, text, text, text, text) to service_role;

-- ============================================================
-- 5. billing_get_current_charge — leitura sanitizada (authenticated)
-- ============================================================

create or replace function public.billing_get_current_charge(p_store_id uuid)
returns table (
  id uuid,
  status text,
  plan_code integer,
  amount_cents integer,
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  expires_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz
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
    select c.id, c.status, c.plan_code, c.amount_cents, c.qr_code, c.qr_code_base64, c.ticket_url,
      c.expires_at, c.period_start, c.period_end, c.created_at
    from public.billing_charges c
    where c.store_id = p_store_id
    order by c.created_at desc
    limit 1;
end;
$$;

comment on function public.billing_get_current_charge(uuid) is
  'Última cobrança de billing da loja (qualquer status) para a tela pending-payment — nunca devolve provider_payment_id/provider_idempotency_key/payer_email/payer_doc_*. Qualquer membro da loja pode ler (mesmo raciocínio de billing_charges_select_member): é a única tela visível enquanto a loja está pending_payment.';

revoke all on function public.billing_get_current_charge(uuid) from public;
grant execute on function public.billing_get_current_charge(uuid) to authenticated;

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
    'billing_subscription_renewed'
  ));

comment on constraint audit_log_action_check on public.audit_log is
  'Conjunto de actions só CRESCE entre migrations (nunca estreitar — bloqueador histórico BUG-RT2-006, qa/reports/TASK-002-RETEST.md). TASK-007 adiciona os 9 eventos de billing/ativação — todos os valores anteriores permanecem intactos.';
