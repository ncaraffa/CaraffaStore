-- TASK-012 commit 4 — Cupons de desconto.
--
-- ESCOPO: O CUPOM É DA LOJA, NÃO DO WORKSPACE
--
-- Decisão comercial explícita: um workspace Profissional com três lojas
-- pode ter NATAL10 na Loja A e NATAL10 na Loja B como cupons
-- independentes, com regras e contadores próprios. Portanto a
-- unicidade é (store_id, normalized_code).
--
-- O ENTITLEMENT, porém, é do workspace: quem decide se a loja PODE usar
-- cupons é store_entitlements(store) -> workspace -> assinatura -> plano.
-- Nunca o navegador.
--
-- ONDE O USO É CONTADO (por que não basta uses_count)
--
-- Um contador incrementado no pagamento permitiria que dois checkouts
-- simultâneos recebessem Pix com desconto usando a MESMA última vaga —
-- e o limite de 100 utilizações viraria 101. Então o ciclo é:
--
--   aplicar no carrinho ....... não consome nada (é só cálculo)
--   pedido/Pix criado ......... RESERVA, na mesma transação do pedido
--   pagamento aprovado ........ reserved -> consumed
--   pedido expira/cancela ..... reserved -> released
--
-- A reserva acontece dentro de create_order, que já é transacional e já
-- trava os produtos. Nenhum lock é mantido durante a chamada de rede ao
-- Mercado Pago: essa chamada acontece DEPOIS, em
-- lib/payments/checkout-orchestration.ts, fora da transação.

-- ============================================================
-- 1. Normalização de código
-- ============================================================
--
-- " natal10 ", "NATAL10" e "natal10" têm que ser o MESMO cupom. A
-- normalização é feita no servidor e persistida numa coluna própria, que
-- carrega a constraint de unicidade — não depende do formulário.
--
-- Alfabeto fechado (A-Z, 0-9, hífen, underscore) de propósito: evita
-- homoglyphs e confusão Unicode nesta V1. Um código com acento ou
-- cirílico é rejeitado na criação, não silenciosamente transliterado.

create or replace function public.coupon_normalize_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select upper(trim(coalesce(p_code, '')));
$fn$;

comment on function public.coupon_normalize_code(text) is
  'trim + uppercase. Deliberadamente NÃO remove nem transforma caracteres inválidos: quem valida o alfabeto é a CHECK constraint de coupons.normalized_code, para que um código impossível falhe alto na criação em vez de virar outro código silenciosamente.';

revoke all on function public.coupon_normalize_code(text) from public;
grant execute on function public.coupon_normalize_code(text) to anon, authenticated, service_role;

-- ============================================================
-- 2. coupons
-- ============================================================

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,

  -- Como o lojista digitou (para exibir), e a forma canônica (para casar).
  code text not null,
  normalized_code text not null
    check (normalized_code ~ '^[A-Z0-9_-]{3,32}$'),

  discount_type text not null check (discount_type in ('percentage', 'fixed_amount')),

  -- percentage  -> BASIS POINTS (1000 = 10,00%). Inteiro, nunca float:
  --                dinheiro e percentual não usam ponto flutuante.
  -- fixed_amount -> CENTAVOS.
  discount_value integer not null check (discount_value > 0),

  minimum_order_cents integer check (minimum_order_cents is null or minimum_order_cents >= 0),
  maximum_discount_cents integer check (maximum_discount_cents is null or maximum_discount_cents > 0),

  starts_at timestamptz,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  active boolean not null default true,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Identidade: loja + código canônico. NATAL10 da Loja A e NATAL10 da
  -- Loja B são cupons diferentes.
  constraint coupons_store_code_unique unique (store_id, normalized_code),

  -- Percentual entre 0,01% e 100%. Acima de 100% o desconto passaria do
  -- subtotal por construção.
  constraint coupons_percentage_range check (
    discount_type <> 'percentage' or discount_value between 1 and 10000
  ),

  -- maximum_discount_cents só faz sentido para percentual: num valor
  -- fixo o teto seria o próprio valor. Rejeitado explicitamente em vez
  -- de ignorado em silêncio.
  constraint coupons_max_discount_only_for_percentage check (
    maximum_discount_cents is null or discount_type = 'percentage'
  ),

  constraint coupons_dates_ordered check (
    starts_at is null or expires_at is null or starts_at < expires_at
  )
);

comment on table public.coupons is
  'Cupom de desconto DA LOJA (store-scoped): NATAL10 pode existir independentemente em várias lojas do mesmo workspace. Quem autoriza o uso é o entitlement do plano da ASSINATURA do workspace, nunca o navegador. Sem limite artificial de quantidade de cupons por plano.';

comment on column public.coupons.discount_value is
  'percentage: BASIS POINTS (1000 = 10%). fixed_amount: CENTAVOS. Sempre inteiro — nenhum valor monetário ou percentual do sistema usa ponto flutuante.';

comment on column public.coupons.normalized_code is
  'Forma canônica (trim + uppercase) com alfabeto fechado A-Z 0-9 _ -. É esta coluna que carrega a unicidade por loja, então " natal10 " e "NATAL10" colidem no banco, não no formulário.';

create index coupons_store_active_idx on public.coupons (store_id, active);

alter table public.coupons enable row level security;

-- Leitura só para quem opera a loja. O COMPRADOR nunca lê a tabela: ele
-- manda o código e recebe de volta apenas "vale / não vale e por quê",
-- via função. Isso impede enumerar cupons de qualquer loja.
create policy coupons_select_member on public.coupons
  for select to authenticated
  using (public.is_store_member(store_id));

grant select on public.coupons to authenticated;

-- ============================================================
-- 3. coupon_redemptions — o ciclo reserved/consumed/released
-- ============================================================

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id) on delete restrict,
  store_id uuid not null references public.stores (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete cascade,

  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'released')),

  -- Quanto ESTE pedido descontou. Snapshot: editar o cupom depois não
  -- reescreve o que já foi resgatado.
  discount_cents integer not null check (discount_cents >= 0),

  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,

  -- Um pedido resgata no máximo um cupom (V1 não tem cupom cumulativo).
  constraint coupon_redemptions_one_per_order unique (order_id)
);

comment on table public.coupon_redemptions is
  'Ciclo de vida do uso de um cupom. reserved é criado na MESMA transação do pedido (nunca ao digitar no carrinho); consumed acontece quando o pagamento é aprovado; released quando o pedido/cobrança termina sem pagamento. reserved + consumed é o que conta contra max_uses — por isso dois checkouts simultâneos não conseguem a mesma última vaga.';

create index coupon_redemptions_coupon_status_idx on public.coupon_redemptions (coupon_id, status);
create index coupon_redemptions_order_idx on public.coupon_redemptions (order_id);

alter table public.coupon_redemptions enable row level security;

create policy coupon_redemptions_select_member on public.coupon_redemptions
  for select to authenticated
  using (public.is_store_member(store_id));

grant select on public.coupon_redemptions to authenticated;

-- Utilizações que ocupam vaga: reservadas + consumidas. Liberadas não.
create or replace function public.coupon_used_count(p_coupon_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::integer from public.coupon_redemptions
  where coupon_id = p_coupon_id and status in ('reserved', 'consumed');
$fn$;

revoke all on function public.coupon_used_count(uuid) from public;
grant execute on function public.coupon_used_count(uuid) to anon, authenticated, service_role;

-- ============================================================
-- 4. orders ganha o snapshot financeiro do cupom
-- ============================================================
--
-- Pedido histórico NUNCA é recalculado. Se o lojista mudar NATAL10 de
-- 10% para 15% amanhã, um pedido de ontem continua mostrando 10% e
-- R$180 — os valores viajam gravados na própria linha do pedido.
--
-- Backfill dos pedidos existentes: desconto zero e cupom nulo. Nenhum
-- pedido antigo passa a "ter tido" desconto.

alter table public.orders
  add column discount_cents integer not null default 0 check (discount_cents >= 0),
  add column coupon_id uuid references public.coupons (id) on delete set null,
  add column coupon_code_snapshot text,
  add column coupon_discount_type_snapshot text
    check (coupon_discount_type_snapshot is null or coupon_discount_type_snapshot in ('percentage', 'fixed_amount')),
  add column coupon_discount_value_snapshot integer;

comment on column public.orders.discount_cents is
  'Desconto aplicado NESTE pedido, em centavos. Junto com subtotal_cents e total_cents forma a verdade financeira do momento da compra: total = subtotal - discount, calculado no servidor e nunca reescrito depois.';

comment on column public.orders.coupon_code_snapshot is
  'Código do cupom como valia no momento do pedido. O painel renderiza o histórico a partir DESTE snapshot, nunca consultando o cupom atual — editar ou desativar o cupom não pode alterar um pedido já feito.';

-- Coerência aritmética garantida pelo banco, não pela aplicação.
alter table public.orders add constraint orders_total_matches_discount
  check (total_cents = subtotal_cents - discount_cents);

-- ============================================================
-- 5. Cálculo do desconto — determinístico
-- ============================================================

create or replace function public.coupon_discount_for(
  p_discount_type text,
  p_discount_value integer,
  p_maximum_discount_cents integer,
  p_subtotal_cents integer
)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select least(
    case p_discount_type
      -- floor: fração de centavo nunca vira centavo a mais de desconto.
      -- 1999 * 1000bp / 10000 = 199,9 -> 199. Determinístico e sempre a
      -- favor de não descontar demais.
      when 'percentage' then (p_subtotal_cents::bigint * p_discount_value) / 10000
      else p_discount_value::bigint
    end,
    coalesce(p_maximum_discount_cents, 2147483647)::bigint,
    -- O desconto nunca passa do subtotal: total jamais fica negativo.
    p_subtotal_cents::bigint
  )::integer;
$fn$;

comment on function public.coupon_discount_for(text, integer, integer, integer) is
  'Desconto em centavos, com três tetos aplicados em conjunto: o valor do cupom, o maximum_discount_cents (quando houver) e o próprio subtotal. Percentual usa divisão inteira (floor) sobre basis points — determinístico e nunca desconta a mais por arredondamento. Como o desconto é limitado ao subtotal, o total nunca fica negativo.';

revoke all on function public.coupon_discount_for(text, integer, integer, integer) from public;
grant execute on function public.coupon_discount_for(text, integer, integer, integer) to anon, authenticated, service_role;

-- ============================================================
-- 6. Validação do cupom — a mesma para prévia e para checkout
-- ============================================================
--
-- Devolve motivo legível por máquina; a aplicação traduz para o
-- comprador. Não vaza nada sobre cupons de outras lojas: um código de
-- outra loja é simplesmente "not_found".

create or replace function public.coupon_validate(
  p_store_id uuid,
  p_code text,
  p_subtotal_cents integer
)
returns table (
  valid boolean,
  reason text,
  coupon_id uuid,
  code text,
  discount_type text,
  discount_value integer,
  discount_cents integer,
  minimum_order_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_coupon public.coupons;
  v_entitled boolean;
  v_used integer;
  v_discount integer;
begin
  -- 1. o plano da assinatura permite cupons?
  select e.coupons into v_entitled from public.store_entitlements(p_store_id) e;
  if coalesce(v_entitled, false) is not true then
    return query select false, 'coupons_not_available'::text, null::uuid, null::text, null::text, null::integer, 0, null::integer;
    return;
  end if;

  -- 2. existe NESTA loja? (código de outra loja = inexistente)
  select * into v_coupon from public.coupons
    where store_id = p_store_id and normalized_code = public.coupon_normalize_code(p_code);
  if v_coupon.id is null then
    return query select false, 'coupon_not_found'::text, null::uuid, null::text, null::text, null::integer, 0, null::integer;
    return;
  end if;

  if not v_coupon.active then
    return query select false, 'coupon_inactive'::text, v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, 0, v_coupon.minimum_order_cents;
    return;
  end if;

  -- 3. janela de validade — relógio do BANCO, nunca do navegador
  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    return query select false, 'coupon_not_started'::text, v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, 0, v_coupon.minimum_order_cents;
    return;
  end if;
  if v_coupon.expires_at is not null and now() >= v_coupon.expires_at then
    return query select false, 'coupon_expired'::text, v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, 0, v_coupon.minimum_order_cents;
    return;
  end if;

  -- 4. pedido mínimo
  if v_coupon.minimum_order_cents is not null and p_subtotal_cents < v_coupon.minimum_order_cents then
    return query select false, 'coupon_minimum_not_met'::text, v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, 0, v_coupon.minimum_order_cents;
    return;
  end if;

  -- 5. ainda há utilização disponível? (leitura sem lock: é só prévia —
  -- a decisão real, sob lock, acontece na reserva dentro de create_order)
  if v_coupon.max_uses is not null then
    v_used := public.coupon_used_count(v_coupon.id);
    if v_used >= v_coupon.max_uses then
      return query select false, 'coupon_usage_limit_reached'::text, v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, 0, v_coupon.minimum_order_cents;
      return;
    end if;
  end if;

  v_discount := public.coupon_discount_for(
    v_coupon.discount_type, v_coupon.discount_value, v_coupon.maximum_discount_cents, p_subtotal_cents);

  -- 6. Não emitimos cobrança Pix de R$0: o mínimo aceito pelo Mercado
  -- Pago para Pix não está estabelecido neste projeto, e criar uma
  -- cobrança inválida seria pior que recusar o cupom. Regra explícita em
  -- vez de suposição — se um dia o piso do PSP for confirmado, é aqui
  -- que muda.
  if p_subtotal_cents - v_discount <= 0 then
    return query select false, 'coupon_would_zero_total'::text, v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, 0, v_coupon.minimum_order_cents;
    return;
  end if;

  return query select true, null::text, v_coupon.id, v_coupon.code, v_coupon.discount_type, v_coupon.discount_value, v_discount, v_coupon.minimum_order_cents;
end;
$fn$;

comment on function public.coupon_validate(uuid, text, integer) is
  'Valida um cupom para um subtotal e devolve o desconto. Mesma função usada na prévia do carrinho e dentro de create_order, para que a tela nunca prometa um desconto que o checkout depois recusa. Datas vêm do relógio do banco. Cupom de outra loja responde coupon_not_found — não dá para enumerar cupons alheios.';

revoke all on function public.coupon_validate(uuid, text, integer) from public;
grant execute on function public.coupon_validate(uuid, text, integer) to anon, authenticated, service_role;

-- Prévia para o storefront: resolve a loja pelo slug (o comprador é anon
-- e não conhece store_id) e devolve só o necessário para a tela.
create or replace function public.coupon_preview(
  p_store_slug text,
  p_code text,
  p_subtotal_cents integer
)
returns table (valid boolean, reason text, code text, discount_cents integer, minimum_order_cents integer)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store_id uuid;
  v_status text;
begin
  if p_subtotal_cents is null or p_subtotal_cents < 0 then
    raise exception 'invalid_subtotal' using errcode = '22023';
  end if;

  select id, status into v_store_id, v_status from public.stores where slug = p_store_slug;
  if v_store_id is null or v_status <> 'active' then
    return query select false, 'coupon_not_found'::text, null::text, 0, null::integer;
    return;
  end if;

  return query
    select v.valid, v.reason, v.code, v.discount_cents, v.minimum_order_cents
    from public.coupon_validate(v_store_id, p_code, p_subtotal_cents) v;
end;
$fn$;

comment on function public.coupon_preview(text, text, integer) is
  'Prévia do cupom para o carrinho público. É SÓ prévia: não reserva nada e o subtotal recebido aqui não vira preço — create_order recalcula tudo a partir de products. Serve para a tela poder dizer "-R$20" ou "faltam R$15" antes do checkout.';

revoke all on function public.coupon_preview(text, text, integer) from public;
grant execute on function public.coupon_preview(text, text, integer) to anon, authenticated;

-- ============================================================
-- 7. CRUD do lojista — entitlement verificado no servidor
-- ============================================================

create or replace function public.coupon_upsert(
  p_store_id uuid,
  p_coupon_id uuid,
  p_code text,
  p_discount_type text,
  p_discount_value integer,
  p_minimum_order_cents integer default null,
  p_maximum_discount_cents integer default null,
  p_starts_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_max_uses integer default null,
  p_active boolean default true
)
returns public.coupons
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_normalized text := public.coupon_normalize_code(p_code);
  v_entitled boolean;
  v_row public.coupons;
begin
  if not public.can_manage_store_catalog(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- ENTITLEMENT no servidor: o Essencial não cria nem edita cupom, mesmo
  -- chamando esta RPC diretamente com o menu escondido no frontend.
  select e.coupons into v_entitled from public.store_entitlements(p_store_id) e;
  if coalesce(v_entitled, false) is not true then
    raise exception 'coupons_not_available' using errcode = '42501';
  end if;

  if v_normalized !~ '^[A-Z0-9_-]{3,32}$' then
    raise exception 'invalid_coupon_code' using errcode = '22023';
  end if;
  if p_discount_type not in ('percentage', 'fixed_amount') then
    raise exception 'invalid_discount_type' using errcode = '22023';
  end if;
  if p_discount_value is null or p_discount_value <= 0 then
    raise exception 'invalid_discount_value' using errcode = '22023';
  end if;
  if p_discount_type = 'percentage' and p_discount_value > 10000 then
    raise exception 'invalid_discount_value' using errcode = '22023';
  end if;
  if p_discount_type = 'fixed_amount' and p_maximum_discount_cents is not null then
    raise exception 'max_discount_only_for_percentage' using errcode = '22023';
  end if;
  if p_minimum_order_cents is not null and p_minimum_order_cents < 0 then
    raise exception 'invalid_minimum_order' using errcode = '22023';
  end if;
  if p_maximum_discount_cents is not null and p_maximum_discount_cents <= 0 then
    raise exception 'invalid_maximum_discount' using errcode = '22023';
  end if;
  if p_starts_at is not null and p_expires_at is not null and p_starts_at >= p_expires_at then
    raise exception 'invalid_date_range' using errcode = '22023';
  end if;
  if p_max_uses is not null and p_max_uses <= 0 then
    raise exception 'invalid_max_uses' using errcode = '22023';
  end if;

  if p_coupon_id is null then
    begin
      insert into public.coupons (
        store_id, code, normalized_code, discount_type, discount_value,
        minimum_order_cents, maximum_discount_cents, starts_at, expires_at, max_uses, active, created_by
      ) values (
        p_store_id, trim(p_code), v_normalized, p_discount_type, p_discount_value,
        p_minimum_order_cents, p_maximum_discount_cents, p_starts_at, p_expires_at, p_max_uses, p_active, auth.uid()
      )
      returning * into v_row;
    exception
      when unique_violation then
        raise exception 'coupon_code_taken' using errcode = '23505';
    end;

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (auth.uid(), p_store_id, 'coupon_created', 'coupon', v_row.id::text,
      jsonb_build_object('code', v_row.normalized_code, 'discount_type', v_row.discount_type));
  else
    begin
      update public.coupons set
        code = trim(p_code),
        normalized_code = v_normalized,
        discount_type = p_discount_type,
        discount_value = p_discount_value,
        minimum_order_cents = p_minimum_order_cents,
        maximum_discount_cents = p_maximum_discount_cents,
        starts_at = p_starts_at,
        expires_at = p_expires_at,
        max_uses = p_max_uses,
        active = p_active,
        updated_at = now()
      where id = p_coupon_id and store_id = p_store_id
      returning * into v_row;
    exception
      when unique_violation then
        raise exception 'coupon_code_taken' using errcode = '23505';
    end;

    if v_row.id is null then
      raise exception 'coupon_not_found' using errcode = '02000';
    end if;

    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (auth.uid(), p_store_id,
      case when p_active then 'coupon_updated' else 'coupon_disabled' end,
      'coupon', v_row.id::text,
      jsonb_build_object('code', v_row.normalized_code));
  end if;

  return v_row;
end;
$fn$;

comment on function public.coupon_upsert(uuid, uuid, text, text, integer, integer, integer, timestamptz, timestamptz, integer, boolean) is
  'Cria/edita cupom. Verifica o entitlement de cupons da ASSINATURA no servidor — uma conta Essencial é recusada aqui mesmo chamando a RPC direto, sem passar pelo painel. Nunca há exclusão física: desativar preserva a auditoria e o histórico de pedidos que usaram o cupom.';

revoke all on function public.coupon_upsert(uuid, uuid, text, text, integer, integer, integer, timestamptz, timestamptz, integer, boolean) from public;
grant execute on function public.coupon_upsert(uuid, uuid, text, text, integer, integer, integer, timestamptz, timestamptz, integer, boolean) to authenticated;

-- Listagem para o painel, já com o uso calculado.
create or replace function public.coupon_list(p_store_id uuid)
returns table (
  id uuid, code text, discount_type text, discount_value integer,
  minimum_order_cents integer, maximum_discount_cents integer,
  starts_at timestamptz, expires_at timestamptz,
  max_uses integer, used_count integer, active boolean, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  return query
    select c.id, c.code, c.discount_type, c.discount_value,
           c.minimum_order_cents, c.maximum_discount_cents,
           c.starts_at, c.expires_at,
           c.max_uses, public.coupon_used_count(c.id), c.active, c.created_at
    from public.coupons c
    where c.store_id = p_store_id
    order by c.active desc, c.created_at desc;
end;
$fn$;

revoke all on function public.coupon_list(uuid) from public;
grant execute on function public.coupon_list(uuid) to authenticated;
