-- TASK-005 — Pix e pagamentos (Mercado Pago, por loja).
--
-- Decisões aprovadas por Caraffa (2026-08-04): Mercado Pago via
-- POST /v1/payments; cada loja usa suas próprias credenciais (sem OAuth,
-- sem split, sem conta global); credenciais cadastradas manualmente pelo
-- comerciante e criptografadas (AES-256-GCM, lib/payments/crypto.ts,
-- chave só em PAYMENT_ENCRYPTION_KEY — nunca no banco); reembolso fora do
-- escopo (pedido pago cancelado só com erro seguro); checkout público
-- passa a EXIGIR Pix configurado e ativo na loja (não há mais pedido sem
-- pagamento pela loja pública a partir desta tarefa — `create_order`,
-- TASK-004, continua existindo sem alteração: pedidos manuais antigos são
-- preservados como estão, nunca alterados).
--
-- Mesmo padrão de autorização operacional de TASK-003/004: funções
-- SECURITY DEFINER dedicadas, cada uma reautoriza via auth.uid() no
-- próprio banco, nunca confia em store_id/role vindo do cliente, grava
-- auditoria real na MESMA transação da escrita.
--
-- Fronteira de privilégio nova nesta tarefa: as funções que orquestram o
-- pagamento (pix_payment_*) só podem ser chamadas por `service_role` —
-- rodam exclusivamente a partir de módulos server-only (checkout público,
-- webhook, reconciliação/cron), nunca a partir da sessão do usuário final
-- (anon/authenticated), porque precisam descriptografar credenciais e
-- falar com o Mercado Pago antes de tocar no banco. As funções de LEITURA/
-- CONFIGURAÇÃO administrativa (payment_settings_*, payment_events_list_*)
-- continuam no padrão usual: EXECUTE para `authenticated`, reautorizadas
-- por auth.uid() dentro da própria função.

-- ============================================================
-- 0. Autorização operacional de pagamentos
-- ============================================================

create or replace function public.can_manage_store_payments(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.store_members sm
    join public.stores s on s.id = sm.store_id
    where sm.store_id = target_store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
      and s.status = 'active'
  );
$$;

comment on function public.can_manage_store_payments(uuid) is
  'Autorização operacional de pagamentos (credenciais e leitura administrativa de order_payments): owner/admin da loja E loja status=active. Mesmo desenho de can_manage_store_orders (0006_orders.sql), função própria e nomeada pelo domínio — staff nunca administra nem lê pagamentos aqui (diferente de pedidos, onde staff tem leitura).';

revoke all on function public.can_manage_store_payments(uuid) from public;
grant execute on function public.can_manage_store_payments(uuid) to authenticated;

-- ============================================================
-- 1. orders — colunas novas (ALTER TABLE, nunca recriada)
-- ============================================================

alter table public.orders
  add column payment_mode text not null default 'manual' check (payment_mode in ('manual', 'pix')),
  add column receipt_token_hash text;

comment on column public.orders.payment_mode is
  'manual = pedido criado antes da TASK-005 ou fora do fluxo de pagamento (preservado como está, nunca alterado/cancelado silenciosamente). pix = checkout exigiu pagamento via Mercado Pago; só a engine de pagamento (pix_payment_apply_provider_state) pode mover esse pedido de pending para confirmed ou para cancelled — order_advance_status/order_cancel (TASK-004) recusam essas transições para payment_mode=pix (ver guards abaixo).';

comment on column public.orders.receipt_token_hash is
  'sha256 de um token de alta entropia gerado no checkout (nunca armazenado em texto puro) — prova de posse para a página pública de pagamento (/pedido/[publicCode]/pagamento). Sem isso, publicCode sozinho nunca é suficiente para ver QR Code/status de um pedido de outra pessoa.';

-- ============================================================
-- 2. store_payment_settings — credenciais por loja (criptografadas)
-- ============================================================

create table public.store_payment_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores (id) on delete restrict,
  provider text not null default 'mercado_pago' check (provider in ('mercado_pago')),
  environment text not null check (environment in ('test', 'production')),
  encrypted_access_token text not null,
  encrypted_webhook_secret text not null,
  access_token_preview text not null,
  webhook_key text not null unique,
  is_enabled boolean not null default false,
  credentials_verified_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.store_payment_settings is
  'Credenciais Mercado Pago por loja. encrypted_access_token/encrypted_webhook_secret são AES-256-GCM (lib/payments/crypto.ts, PAYMENT_ENCRYPTION_KEY só em variável de ambiente do processo Next.js — nunca neste banco, nunca no bundle). access_token_preview guarda só um preview mascarado (ex.: "APP_USR-••••1234"), calculado uma vez no momento de salvar — nunca o valor completo volta ao navegador depois de salvo. webhook_key é o identificador público de alta entropia usado para localizar a config candidata em /api/webhooks/mercado-pago (a autenticidade real vem da assinatura, não do webhook_key). RLS sem NENHUMA policy (nem para owner) — todo acesso é por função SECURITY DEFINER (payment_settings_*) ou pelo módulo server-only de orquestração (service_role).';

comment on column public.store_payment_settings.encrypted_access_token is
  'Nunca descriptografado dentro do Postgres — a criptografia/descriptografia acontece só em lib/payments/crypto.ts (Node, server-only). Este banco só guarda e devolve o texto cifrado.';

alter table public.store_payment_settings enable row level security;

revoke all on public.store_payment_settings from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.store_payment_settings to service_role;

-- ============================================================
-- 3. order_payments — uma tentativa de pagamento por pedido
-- ============================================================

create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  order_id uuid not null unique references public.orders (id) on delete restrict,
  provider text not null default 'mercado_pago' check (provider in ('mercado_pago')),
  provider_payment_id text,
  provider_idempotency_key text not null check (char_length(provider_idempotency_key) between 1 and 64),
  external_reference text not null unique,
  status text not null default 'creating' check (status in (
    'creating', 'pending', 'approved', 'rejected', 'cancelled', 'expired', 'error', 'manual_review'
  )),
  provider_status text,
  provider_status_detail text,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'BRL',
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  payer_email text not null,
  payer_doc_type text not null check (payer_doc_type in ('CPF', 'CNPJ')),
  payer_doc_last4 text not null check (payer_doc_last4 ~ '^[0-9]{4}$'),
  expires_at timestamptz,
  approved_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  last_webhook_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_payments_store_idempotency_unique unique (store_id, provider_idempotency_key),
  constraint order_payments_provider_payment_id_unique unique (provider, provider_payment_id)
);

comment on table public.order_payments is
  'Uma tentativa de pagamento Pix por pedido (order_id UNIQUE — nunca uma segunda linha para o mesmo pedido; retry reusa a MESMA linha/idempotency key, nunca cria outra). external_reference = o próprio id desta linha (gerado pelo banco, nunca fabricável pelo cliente) — enviado ao Mercado Pago e conferido de volta em todo webhook/reconciliação antes de aplicar qualquer transição. payer_doc_last4/payer_email só o necessário para operação do comerciante — CPF/CNPJ completo nunca é persistido (vai só ao provedor, em memória do processo, durante a criação).';

comment on column public.order_payments.provider_idempotency_key is
  'Enviada como X-Idempotency-Key ao Mercado Pago — estável para esta tentativa (nunca regenerada por timeout/retry/duplo clique). Determinística a partir do id desta linha, gerada uma única vez em pix_payment_attempt_upsert_creating.';

comment on column public.order_payments.status is
  'Status interno do PAGAMENTO — separado do status operacional do pedido (orders.status, TASK-004). creating/pending nunca alteram o pedido; approved confirma o pedido uma vez (order_confirmed_by_payment); rejected/cancelled/expired cancelam o pedido e devolvem estoque uma vez (order_cancelled_by_payment_failure), só se o pedido ainda estiver pending; manual_review é um estado de escape para inconsistência real (nunca decidido automaticamente a partir daí) — ver pix_payment_apply_provider_state.';

create index order_payments_store_status_idx on public.order_payments (store_id, status);
create index order_payments_provider_payment_id_idx on public.order_payments (provider_payment_id) where provider_payment_id is not null;

alter table public.order_payments enable row level security;

create policy order_payments_select_manager
  on public.order_payments
  for select
  to authenticated
  using (public.can_manage_store_payments(store_id));

revoke all on public.order_payments from public, anon, authenticated, service_role;
grant select on public.order_payments to authenticated;
grant select, insert, update, delete on public.order_payments to service_role;

comment on policy order_payments_select_manager on public.order_payments is
  'Só owner/admin da própria loja active (can_manage_store_payments) — diferente de orders/order_items (que também liberam staff para leitura), pagamento é mais sensível: dados do pagador (e-mail, últimos 4 dígitos do documento) e estado financeiro real. Nenhuma escrita direta é concedida (nem a authenticated nem a service_role via RLS — service_role tem GRANT de tabela e passa por cima da RLS, que é o desenho pretendido para as funções SECURITY DEFINER pix_payment_*).';

-- ============================================================
-- 4. payment_webhook_events — log append-only de eventos recebidos
-- ============================================================

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  payment_attempt_id uuid references public.order_payments (id) on delete set null,
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
  constraint payment_webhook_events_dedup_unique unique (store_id, provider_payment_id, payload_hash)
);

comment on table public.payment_webhook_events is
  'Log append-only de notificações recebidas (webhook) — nunca guarda Access Token, Webhook Secret, assinatura completa, CPF/CNPJ, QR Code completo, nem o header Authorization (ver lib/payments/webhook-log.ts). payload_hash é o hash do corpo relevante (id do pagamento + action + timestamp), usado para deduplicar entregas repetidas do próprio Mercado Pago (UNIQUE (store_id, provider_payment_id, payload_hash)) sem depender de um provider_event_id sempre presente.';

create index payment_webhook_events_payment_attempt_idx on public.payment_webhook_events (payment_attempt_id, received_at desc);

alter table public.payment_webhook_events enable row level security;

revoke all on public.payment_webhook_events from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.payment_webhook_events to service_role;

-- ============================================================
-- 5. payment_settings_* — configuração administrativa (authenticated)
-- ============================================================

create or replace function public.payment_settings_get(p_store_id uuid)
returns table (
  is_configured boolean,
  environment text,
  is_enabled boolean,
  credentials_verified_at timestamptz,
  last_error_code text,
  access_token_preview text,
  webhook_key text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_row public.store_payment_settings;
begin
  if not public.can_manage_store_payments(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select * into v_row from public.store_payment_settings where store_id = p_store_id;

  if v_row.id is null then
    return query select false, null::text, false, null::timestamptz, null::text, null::text, null::text;
  else
    return query select true, v_row.environment, v_row.is_enabled, v_row.credentials_verified_at,
      v_row.last_error_code, v_row.access_token_preview, v_row.webhook_key;
  end if;
end;
$$;

comment on function public.payment_settings_get(uuid) is
  'Única forma de ler o estado da configuração de pagamentos — nunca devolve encrypted_access_token/encrypted_webhook_secret (nem sequer estão no retorno desta função). access_token_preview é o único indício do token, mascarado, calculado uma vez ao salvar.';

create or replace function public.payment_settings_upsert(
  p_store_id uuid,
  p_environment text,
  p_encrypted_access_token text,
  p_encrypted_webhook_secret text,
  p_access_token_preview text
)
returns public.store_payment_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.store_payment_settings;
  v_webhook_key text;
begin
  if not public.can_manage_store_payments(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_environment not in ('test', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  if p_encrypted_access_token is null or char_length(p_encrypted_access_token) = 0 then
    raise exception 'invalid_access_token' using errcode = '22023';
  end if;
  if p_encrypted_webhook_secret is null or char_length(p_encrypted_webhook_secret) = 0 then
    raise exception 'invalid_webhook_secret' using errcode = '22023';
  end if;

  select webhook_key into v_webhook_key from public.store_payment_settings where store_id = p_store_id;
  if v_webhook_key is null then
    v_webhook_key := encode(extensions.gen_random_bytes(32), 'hex');
  end if;

  insert into public.store_payment_settings (
    store_id, provider, environment, encrypted_access_token, encrypted_webhook_secret,
    access_token_preview, webhook_key, is_enabled, credentials_verified_at, last_error_code
  ) values (
    p_store_id, 'mercado_pago', p_environment, p_encrypted_access_token, p_encrypted_webhook_secret,
    p_access_token_preview, v_webhook_key, false, null, null
  )
  on conflict (store_id) do update set
    environment = excluded.environment,
    encrypted_access_token = excluded.encrypted_access_token,
    encrypted_webhook_secret = excluded.encrypted_webhook_secret,
    access_token_preview = excluded.access_token_preview,
    credentials_verified_at = null,
    last_error_code = null,
    updated_at = now()
  returning * into v_row;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_store_id, 'payment_settings_configured', 'store_payment_settings', v_row.id::text,
    jsonb_build_object('environment', p_environment));

  return v_row;
end;
$$;

comment on function public.payment_settings_upsert(uuid, text, text, text, text) is
  'Salva/substitui as credenciais (já criptografadas por lib/payments/crypto.ts ANTES de chegar aqui — este banco nunca vê o valor em texto puro). webhook_key é gerado uma única vez por loja e preservado em atualizações seguintes. Toda troca de credencial reseta credentials_verified_at/last_error_code (força novo teste de conexão) mas preserva is_enabled — ativar/desativar é uma ação própria (payment_settings_set_enabled).';

create or replace function public.payment_settings_set_enabled(p_store_id uuid, p_is_enabled boolean)
returns public.store_payment_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.store_payment_settings;
begin
  if not public.can_manage_store_payments(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update public.store_payment_settings
  set is_enabled = p_is_enabled, updated_at = now()
  where store_id = p_store_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'payment_settings_not_found' using errcode = '02000';
  end if;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_store_id,
    case when p_is_enabled then 'payment_settings_configured' else 'payment_settings_disabled' end,
    'store_payment_settings', v_row.id::text, jsonb_build_object('is_enabled', p_is_enabled));

  return v_row;
end;
$$;

create or replace function public.payment_settings_mark_verified(p_store_id uuid, p_ok boolean, p_error_code text)
returns public.store_payment_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.store_payment_settings;
begin
  if not public.can_manage_store_payments(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update public.store_payment_settings
  set credentials_verified_at = case when p_ok then now() else credentials_verified_at end,
      last_error_code = case when p_ok then null else p_error_code end,
      updated_at = now()
  where store_id = p_store_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'payment_settings_not_found' using errcode = '02000';
  end if;

  return v_row;
end;
$$;

comment on function public.payment_settings_mark_verified(uuid, boolean, text) is
  'Chamada pelo módulo server-only depois de testar a conexão de fato (PixPaymentGateway.validateCredentials, fora do banco) — o banco nunca faz a chamada HTTP, só registra o resultado.';

revoke all on function public.payment_settings_get(uuid) from public;
revoke all on function public.payment_settings_upsert(uuid, text, text, text, text) from public;
revoke all on function public.payment_settings_set_enabled(uuid, boolean) from public;
revoke all on function public.payment_settings_mark_verified(uuid, boolean, text) from public;
grant execute on function public.payment_settings_get(uuid) to authenticated;
grant execute on function public.payment_settings_upsert(uuid, text, text, text, text) to authenticated;
grant execute on function public.payment_settings_set_enabled(uuid, boolean) to authenticated;
grant execute on function public.payment_settings_mark_verified(uuid, boolean, text) to authenticated;

-- ============================================================
-- 6. pix_payment_* — orquestração (service_role apenas)
-- ============================================================

create or replace function public.pix_payment_attempt_upsert_creating(
  p_order_id uuid,
  p_provider_idempotency_key text,
  p_amount_cents integer,
  p_currency text,
  p_payer_email text,
  p_payer_doc_type text,
  p_payer_doc_last4 text,
  p_receipt_token_hash text
)
returns public.order_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_existing public.order_payments;
  v_new_id uuid;
  v_attempt public.order_payments;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'order_not_found' using errcode = '02000';
  end if;

  if p_receipt_token_hash is null or char_length(p_receipt_token_hash) < 32 then
    raise exception 'invalid_receipt_token' using errcode = '22023';
  end if;

  -- Sempre atualiza o hash do token de recibo, mesmo em retry — o
  -- checkout gera um token novo a cada tentativa de request (nunca
  -- guarda o valor em texto puro para reemitir depois), então o cookie
  -- da resposta ANTERIOR (se o cliente nunca a recebeu — timeout,
  -- conexão perdida) fica órfão de propósito; a resposta desta chamada
  -- sempre traz um cookie que bate com o hash mais recente.
  update public.orders
  set payment_mode = 'pix', receipt_token_hash = p_receipt_token_hash, updated_at = now()
  where id = p_order_id;

  select * into v_existing from public.order_payments where order_id = p_order_id;
  if v_existing.id is not null then
    return v_existing; -- retry/duplo clique: mesma tentativa de pagamento, nunca uma segunda linha.
  end if;

  if p_amount_cents <> v_order.total_cents then
    raise exception 'amount_mismatch' using errcode = '23514';
  end if;
  if p_payer_doc_type not in ('CPF', 'CNPJ') then
    raise exception 'invalid_payer_document' using errcode = '22023';
  end if;
  if p_payer_doc_last4 !~ '^[0-9]{4}$' then
    raise exception 'invalid_payer_document' using errcode = '22023';
  end if;

  v_new_id := gen_random_uuid();

  insert into public.order_payments (
    id, store_id, order_id, provider, provider_idempotency_key, external_reference,
    status, amount_cents, currency, payer_email, payer_doc_type, payer_doc_last4
  ) values (
    v_new_id, v_order.store_id, p_order_id, 'mercado_pago', p_provider_idempotency_key, v_new_id::text,
    'creating', p_amount_cents, p_currency, p_payer_email, p_payer_doc_type, p_payer_doc_last4
  )
  returning * into v_attempt;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, v_order.store_id, 'pix_payment_creation_started', 'order_payment', v_attempt.id::text,
    jsonb_build_object('order_id', p_order_id, 'amount_cents', p_amount_cents));

  return v_attempt;
end;
$$;

comment on function public.pix_payment_attempt_upsert_creating(uuid, text, integer, text, text, text, text, text) is
  'Primeiro passo da orquestração (lib/payments/checkout-orchestration.ts): cria a tentativa em creating + marca orders.payment_mode=pix + guarda o hash do token de recibo, tudo na MESMA transação do pedido já criado por create_order. Idempotente por order_id (UNIQUE) — nunca cria uma segunda tentativa para o mesmo pedido, mesmo sob retry concorrente (lock em orders primeiro).';

create or replace function public.pix_payment_mark_created(
  p_payment_attempt_id uuid,
  p_provider_payment_id text,
  p_provider_status text,
  p_provider_status_detail text,
  p_qr_code text,
  p_qr_code_base64 text,
  p_ticket_url text,
  p_expires_at timestamptz
)
returns public.order_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.order_payments;
begin
  select * into v_attempt from public.order_payments where id = p_payment_attempt_id for update;
  if v_attempt.id is null then
    raise exception 'payment_attempt_not_found' using errcode = '02000';
  end if;
  if v_attempt.status <> 'creating' then
    return v_attempt; -- resposta tardia de um retry — idempotente, nunca sobrescreve um estado já avançado.
  end if;

  update public.order_payments
  set provider_payment_id = p_provider_payment_id,
      status = 'pending',
      provider_status = p_provider_status,
      provider_status_detail = p_provider_status_detail,
      qr_code = p_qr_code,
      qr_code_base64 = p_qr_code_base64,
      ticket_url = p_ticket_url,
      expires_at = p_expires_at,
      updated_at = now()
  where id = p_payment_attempt_id
  returning * into v_attempt;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, v_attempt.store_id, 'pix_payment_created', 'order_payment', v_attempt.id::text,
    jsonb_build_object('order_id', v_attempt.order_id, 'provider_payment_id', p_provider_payment_id));

  return v_attempt;
end;
$$;

create or replace function public.pix_payment_mark_creation_failed(
  p_payment_attempt_id uuid,
  p_error_code text
)
returns public.order_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.order_payments;
  v_order public.orders;
  v_restored jsonb := '[]'::jsonb;
begin
  select * into v_attempt from public.order_payments where id = p_payment_attempt_id for update;
  if v_attempt.id is null then
    raise exception 'payment_attempt_not_found' using errcode = '02000';
  end if;
  if v_attempt.status <> 'creating' then
    return v_attempt; -- já resolvido — idempotente.
  end if;

  update public.order_payments
  set status = 'error', failed_at = now(), provider_status_detail = p_error_code, updated_at = now()
  where id = p_payment_attempt_id
  returning * into v_attempt;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, v_attempt.store_id, 'pix_payment_rejected', 'order_payment', v_attempt.id::text,
    jsonb_build_object('order_id', v_attempt.order_id, 'reason', p_error_code));

  select * into v_order from public.orders where id = v_attempt.order_id for update;
  if v_order.status = 'pending' then
    update public.orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_order.id;

    perform 1
      from public.products p
      join public.order_items oi on oi.product_id = p.id
      where oi.order_id = v_order.id
      order by p.id
      for update of p;

    with restored as (
      update public.products p
      set stock = p.stock + oi.quantity, updated_at = now()
      from public.order_items oi
      where oi.order_id = v_order.id and oi.product_id = p.id
      returning p.id, oi.quantity
    )
    select coalesce(jsonb_agg(jsonb_build_object('product_id', id, 'quantity', quantity) order by id), '[]'::jsonb)
      into v_restored
    from restored;

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_order.store_id, 'order_cancelled_by_payment_failure', 'order', v_order.id::text,
      jsonb_build_object('public_code', v_order.public_code, 'reason', p_error_code, 'items', v_restored));
  end if;

  return v_attempt;
end;
$$;

comment on function public.pix_payment_mark_creation_failed(uuid, text) is
  'Erro DEFINITIVO na criação (credencial inválida, validação recusada pelo Mercado Pago) — nunca chamada para erro transitório (timeout/5xx), que deve manter o estado creating para retry com a MESMA idempotency key. Cancela o pedido e devolve o estoque atomicamente, exatamente como order_cancel (TASK-004), só que disparado pela falha de pagamento, não por ação administrativa.';

create or replace function public.pix_payment_apply_provider_state(
  p_payment_attempt_id uuid,
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
returns public.order_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.order_payments;
  v_order public.orders;
  v_restored jsonb := '[]'::jsonb;
  v_terminal_paid boolean;
  v_terminal_unpaid boolean;
begin
  if p_internal_status not in ('pending', 'approved', 'rejected', 'cancelled', 'expired') then
    raise exception 'invalid_provider_status' using errcode = '22023';
  end if;

  -- Trava a linha do PAGAMENTO primeiro: webhook duplicado, webhook +
  -- reconciliação simultâneos, e duas reconciliações concorrentes
  -- serializam aqui, exatamente como order_cancel serializa cancelamentos
  -- concorrentes (0006_orders.sql) — a segunda chamada só prossegue depois
  -- que a primeira já decidiu, nunca as duas aplicam o mesmo efeito.
  select * into v_attempt from public.order_payments where id = p_payment_attempt_id for update;
  if v_attempt.id is null then
    raise exception 'payment_attempt_not_found' using errcode = '02000';
  end if;

  if v_attempt.provider_payment_id is not null and v_attempt.provider_payment_id <> p_provider_payment_id then
    raise exception 'provider_payment_id_mismatch' using errcode = '23514';
  end if;

  if v_attempt.status = 'manual_review' then
    return v_attempt; -- já sinalizado para revisão humana — nunca decide sozinho depois disso.
  end if;

  if v_attempt.external_reference <> p_external_reference
    or v_attempt.amount_cents <> p_amount_cents
    or v_attempt.currency <> p_currency then
    update public.order_payments set status = 'manual_review', updated_at = now()
      where id = p_payment_attempt_id returning * into v_attempt;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_attempt.store_id, 'payment_manual_review_required', 'order_payment', v_attempt.id::text,
      jsonb_build_object('reason', 'external_reference_or_amount_mismatch', 'provider_payment_id', p_provider_payment_id));
    return v_attempt;
  end if;

  v_terminal_paid := v_attempt.status = 'approved';
  v_terminal_unpaid := v_attempt.status in ('rejected', 'cancelled', 'expired');

  if (v_terminal_paid and p_internal_status <> 'approved')
    or (v_terminal_unpaid and p_internal_status = 'approved') then
    update public.order_payments set status = 'manual_review', updated_at = now()
      where id = p_payment_attempt_id returning * into v_attempt;
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_attempt.store_id, 'payment_manual_review_required', 'order_payment', v_attempt.id::text,
      jsonb_build_object('reason', 'terminal_state_conflict', 'previous_status', v_attempt.status, 'incoming_status', p_internal_status, 'provider_payment_id', p_provider_payment_id));
    return v_attempt;
  end if;

  if v_terminal_paid or v_terminal_unpaid then
    -- Já terminal e coerente com o novo evento (ex.: dois webhooks approved
    -- seguidos) — idempotente: só atualiza metadados de rastreio, nunca
    -- duplica o efeito de negócio (confirmação/cancelamento/estoque).
    update public.order_payments
    set provider_status = p_provider_status, provider_status_detail = p_provider_status_detail,
        last_webhook_at = now(), updated_at = now()
    where id = p_payment_attempt_id
    returning * into v_attempt;
    return v_attempt;
  end if;

  select * into v_order from public.orders where id = v_attempt.order_id for update;

  if p_internal_status = 'pending' then
    update public.order_payments
    set provider_status = p_provider_status, provider_status_detail = p_provider_status_detail,
        qr_code = coalesce(p_qr_code, qr_code), qr_code_base64 = coalesce(p_qr_code_base64, qr_code_base64),
        ticket_url = coalesce(p_ticket_url, ticket_url), expires_at = coalesce(p_expires_at, expires_at),
        provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
        last_webhook_at = now(), updated_at = now()
    where id = p_payment_attempt_id
    returning * into v_attempt;
    return v_attempt;
  end if;

  if p_internal_status = 'approved' then
    update public.order_payments
    set status = 'approved', approved_at = now(), provider_status = p_provider_status,
        provider_status_detail = p_provider_status_detail, provider_payment_id = p_provider_payment_id,
        last_webhook_at = now(), updated_at = now()
    where id = p_payment_attempt_id
    returning * into v_attempt;

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_attempt.store_id, 'pix_payment_approved', 'order_payment', v_attempt.id::text,
      jsonb_build_object('order_id', v_order.id, 'provider_payment_id', p_provider_payment_id));

    if v_order.status = 'pending' then
      update public.orders set status = 'confirmed', updated_at = now() where id = v_order.id;
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, v_order.store_id, 'order_confirmed_by_payment', 'order', v_order.id::text,
        jsonb_build_object('public_code', v_order.public_code));
    end if;

    return v_attempt;
  end if;

  -- rejected / cancelled / expired: pagamento termina sem pagar.
  update public.order_payments
  set status = p_internal_status,
      failed_at = case when p_internal_status = 'rejected' then now() else failed_at end,
      cancelled_at = case when p_internal_status in ('cancelled', 'expired') then now() else cancelled_at end,
      provider_status = p_provider_status, provider_status_detail = p_provider_status_detail,
      provider_payment_id = p_provider_payment_id, last_webhook_at = now(), updated_at = now()
  where id = p_payment_attempt_id
  returning * into v_attempt;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, v_attempt.store_id,
    case p_internal_status
      when 'rejected' then 'pix_payment_rejected'
      when 'cancelled' then 'pix_payment_cancelled'
      else 'pix_payment_expired'
    end,
    'order_payment', v_attempt.id::text,
    jsonb_build_object('order_id', v_order.id, 'provider_payment_id', p_provider_payment_id));

  if v_order.status = 'pending' then
    update public.orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_order.id;

    perform 1
      from public.products p
      join public.order_items oi on oi.product_id = p.id
      where oi.order_id = v_order.id
      order by p.id
      for update of p;

    with restored as (
      update public.products p
      set stock = p.stock + oi.quantity, updated_at = now()
      from public.order_items oi
      where oi.order_id = v_order.id and oi.product_id = p.id
      returning p.id, oi.quantity
    )
    select coalesce(jsonb_agg(jsonb_build_object('product_id', id, 'quantity', quantity) order by id), '[]'::jsonb)
      into v_restored
    from restored;

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (null, v_order.store_id, 'order_cancelled_by_payment_failure', 'order', v_order.id::text,
      jsonb_build_object('public_code', v_order.public_code, 'items', v_restored));
  end if;

  return v_attempt;
end;
$$;

comment on function public.pix_payment_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) is
  'Único caminho para aplicar o estado REAL do pagamento (sempre obtido por consulta direta ao Mercado Pago, nunca confiado do corpo do webhook) — usado tanto pelo webhook quanto pela reconciliação (mesma função, mesmo lock, mesmas garantias). external_reference/amount/currency divergentes ou estado terminal conflitante (aprovado depois de cancelado, ou vice-versa) nunca decidem sozinhos: viram manual_review + auditoria crítica. approved confirma o pedido e NUNCA baixa estoque de novo (já reservado na criação); rejected/cancelled/expired cancelam o pedido e devolvem estoque exatamente uma vez, só se o pedido ainda estiver pending.';

revoke all on function public.pix_payment_attempt_upsert_creating(uuid, text, integer, text, text, text, text, text) from public;
revoke all on function public.pix_payment_mark_created(uuid, text, text, text, text, text, text, timestamptz) from public;
revoke all on function public.pix_payment_mark_creation_failed(uuid, text) from public;
revoke all on function public.pix_payment_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) from public;
grant execute on function public.pix_payment_attempt_upsert_creating(uuid, text, integer, text, text, text, text, text) to service_role;
grant execute on function public.pix_payment_mark_created(uuid, text, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.pix_payment_mark_creation_failed(uuid, text) to service_role;
grant execute on function public.pix_payment_apply_provider_state(uuid, text, text, text, text, integer, text, text, text, text, text, timestamptz) to service_role;

-- ============================================================
-- 7. payment_webhook_events — registro (service_role) e leitura sanitizada (authenticated)
-- ============================================================

create or replace function public.pix_webhook_event_record(
  p_store_id uuid,
  p_payment_attempt_id uuid,
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
  insert into public.payment_webhook_events (
    store_id, payment_attempt_id, provider_event_id, provider_payment_id, action,
    payload_hash, processing_status, processed_at, error_code
  ) values (
    p_store_id, p_payment_attempt_id, p_provider_event_id, p_provider_payment_id, p_action,
    p_payload_hash, p_processing_status, case when p_processing_status <> 'received' then now() else null end, p_error_code
  )
  on conflict (store_id, provider_payment_id, payload_hash) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.payment_webhook_events
    where store_id = p_store_id and provider_payment_id = p_provider_payment_id and payload_hash = p_payload_hash
    limit 1;
    return query select v_id, true;
  else
    return query select v_id, false;
  end if;
end;
$$;

comment on function public.pix_webhook_event_record(uuid, uuid, text, text, text, text, text, text) is
  'Registra a notificação recebida (UNIQUE (store_id, provider_payment_id, payload_hash) deduplica entregas repetidas do próprio Mercado Pago). is_duplicate=true permite ao handler responder 200 sem reprocessar — mas mesmo se reprocessar, pix_payment_apply_provider_state é idempotente por construção.';

create or replace function public.payment_events_list_sanitized(p_order_id uuid)
returns table (
  action text,
  processing_status text,
  received_at timestamptz,
  processed_at timestamptz,
  error_code text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_store_id uuid;
begin
  select store_id into v_store_id from public.orders where id = p_order_id;
  if v_store_id is null or not public.can_manage_store_payments(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
    select e.action, e.processing_status, e.received_at, e.processed_at, e.error_code
    from public.payment_webhook_events e
    join public.order_payments p on p.id = e.payment_attempt_id
    where p.order_id = p_order_id
    order by e.received_at desc;
end;
$$;

comment on function public.payment_events_list_sanitized(uuid) is
  'Histórico de eventos para o painel (detalhe do pedido) — nunca devolve payload_hash/provider_event_id/provider_payment_id cru, só o suficiente para o comerciante entender o que aconteceu.';

revoke all on function public.pix_webhook_event_record(uuid, uuid, text, text, text, text, text, text) from public;
revoke all on function public.payment_events_list_sanitized(uuid) from public;
grant execute on function public.pix_webhook_event_record(uuid, uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.payment_events_list_sanitized(uuid) to authenticated;

-- ============================================================
-- 8. Guards de integração em order_advance_status/order_cancel (TASK-004)
-- ============================================================
--
-- CREATE OR REPLACE preserva a assinatura e todo o comportamento anterior
-- para payment_mode='manual' (pedidos legados e qualquer pedido futuro
-- fora do fluxo Pix) — a regressão completa da suíte TASK-004
-- (orders_isolation_check.sql, order-concurrency-check.ts) continua
-- valendo sem alteração. A única mudança de comportamento é para
-- payment_mode='pix': confirmação e cancelamento passam a exigir a
-- engine de pagamento (pix_payment_apply_provider_state) — nunca a ação
-- administrativa direta, porque não há reembolso nesta tarefa.

create or replace function public.order_advance_status(
  p_order_id uuid,
  p_new_status text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_allowed boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'order_not_found' using errcode = '02000';
  end if;
  if not public.can_manage_store_orders(v_order.store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  v_allowed := case v_order.status
    when 'pending' then p_new_status = 'confirmed' and v_order.payment_mode <> 'pix'
    when 'confirmed' then p_new_status = 'preparing'
    when 'preparing' then p_new_status = 'ready'
    when 'ready' then p_new_status = 'completed'
    else false
  end;
  if not v_allowed then
    if v_order.status = 'pending' and p_new_status = 'confirmed' and v_order.payment_mode = 'pix' then
      raise exception 'payment_not_approved' using errcode = '42501';
    end if;
    raise exception 'invalid_status_transition' using errcode = '22023';
  end if;

  update public.orders
  set status = p_new_status,
      updated_at = now(),
      completed_at = case when p_new_status = 'completed' then now() else completed_at end
  where id = p_order_id
  returning * into v_order;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_order.store_id, 'order_status_changed', 'order', p_order_id::text,
    jsonb_build_object('public_code', v_order.public_code, 'new_status', p_new_status));

  return v_order;
end;
$$;

comment on function public.order_advance_status(uuid, text) is
  'Máquina de estados linear (pending->confirmed->preparing->ready->completed). Para payment_mode=pix, pending->confirmed é reservado a pix_payment_apply_provider_state (payment_not_approved se tentado aqui) — o restante da máquina (confirmed em diante) é administrativo normal, igual à TASK-004, já que a esse ponto o pagamento já foi aprovado.';

revoke all on function public.order_advance_status(uuid, text) from public;
grant execute on function public.order_advance_status(uuid, text) to authenticated;

create or replace function public.order_cancel(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_restored jsonb := '[]'::jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'order_not_found' using errcode = '02000';
  end if;
  if not public.can_manage_store_orders(v_order.store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if v_order.status in ('completed', 'cancelled') then
    raise exception 'invalid_status_transition' using errcode = '22023';
  end if;
  if v_order.payment_mode = 'pix' then
    raise exception 'pix_order_requires_payment_flow' using errcode = '42501';
  end if;

  update public.orders
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = p_order_id
  returning * into v_order;

  perform 1
    from public.products p
    join public.order_items oi on oi.product_id = p.id
    where oi.order_id = p_order_id
    order by p.id
    for update of p;

  with restored as (
    update public.products p
    set stock = p.stock + oi.quantity, updated_at = now()
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id = p.id
    returning p.id, oi.quantity
  )
  select coalesce(jsonb_agg(jsonb_build_object('product_id', id, 'quantity', quantity) order by id), '[]'::jsonb)
    into v_restored
  from restored;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_order.store_id, 'order_cancelled', 'order', p_order_id::text,
    jsonb_build_object('public_code', v_order.public_code));

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_order.store_id, 'order_stock_restored', 'order', p_order_id::text,
    jsonb_build_object('public_code', v_order.public_code, 'items', v_restored));

  return v_order;
end;
$$;

comment on function public.order_cancel(uuid) is
  'Cancelamento administrativo direto — só para payment_mode=manual (pedidos legados/fora do fluxo Pix). Para payment_mode=pix, sempre pix_order_requires_payment_flow: o cancelamento de um pedido Pix exige primeiro reconciliar com o provedor (lib/payments/reconcile.ts) — se o pagamento já estiver approved, o erro correto é paid_order_requires_refund (sem reembolso nesta tarefa); se ainda não estiver pago e o provedor confirmar estado terminal não pago, quem cancela e devolve o estoque é pix_payment_apply_provider_state, nunca esta função.';

revoke all on function public.order_cancel(uuid) from public;
grant execute on function public.order_cancel(uuid) to authenticated;

-- ============================================================
-- 9. audit_log_action_check — só ALARGA
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
    'payment_manual_review_required'
  ));

comment on constraint audit_log_action_check on public.audit_log is
  'Conjunto de actions só CRESCE entre migrations (nunca estreitar — bloqueador histórico BUG-RT2-006, qa/reports/TASK-002-RETEST.md). TASK-005 adiciona os 12 eventos de pagamento — todos os valores anteriores permanecem intactos.';
