-- TASK-013 — Frete simples por CEP, configurado por loja.
--
-- ESCOPO: O FRETE É DA LOJA, NÃO DO WORKSPACE
--
-- Mesma decisão dos cupons (0019_coupons.sql): um workspace pode ter
-- lojas em cidades diferentes, e cada uma precisa do seu próprio CEP de
-- origem e da sua própria tabela de valores. Portanto store_id, com
-- unicidade por loja.
--
-- A REGRA (V1 deliberadamente simples)
--
--   destino.cidade = origem.cidade e destino.UF = origem.UF -> same_city
--   destino.UF     = origem.UF                              -> same_state
--   caso contrário                                          -> other_state
--
-- Sem peso, dimensão, distância, faixa de CEP ou transportadora. O que
-- entra na conta é só o par (cidade, UF) do destino comparado ao da
-- origem, e o subtotal já descontado.
--
-- ONDE O VALOR É DECIDIDO
--
-- Em lugar nenhum do navegador. `shipping_quote` existe só para a tela
-- poder mostrar "Frete R$ 15,00" antes de finalizar — e recalcula tudo
-- (subtotal a partir de products, desconto por coupon_validate, frete
-- por shipping_fee_for) exatamente como create_order fará depois. O
-- valor que o cliente paga nasce dentro de create_order, na mesma
-- transação do pedido, e vai para orders.total_cents — que é justamente
-- o número enviado ao Mercado Pago
-- (lib/payments/checkout-orchestration.ts).
--
-- COMPATIBILIDADE COM PEDIDOS DE ENTREGA JÁ EXISTENTES
--
-- Lojas que hoje recebem pedidos com `fulfillment_method='delivery'` e
-- endereço em texto livre continuam funcionando exatamente igual
-- enquanto não configurarem frete: com `enabled=false` (ou sem linha
-- nenhuma), create_order segue o caminho antigo — endereço livre
-- obrigatório, frete zero. Nenhum pedido antigo muda de valor, e
-- nenhuma loja perde a modalidade de entrega por causa desta migration.

-- ============================================================
-- 1. Normalização de cidade, UF e CEP
-- ============================================================
--
-- "Corumbá", "CORUMBA" e " corumbá " precisam ser a MESMA cidade. A
-- comparação nunca é feita sobre o texto cru: as duas pontas (origem
-- salva pelo lojista e destino vindo do ViaCEP ou digitado à mão)
-- passam por shipping_normalize_city antes de qualquer igualdade.
--
-- translate() em vez de unaccent(): unaccent é extensão, exigiria
-- CREATE EXTENSION e um schema fixo no search_path das funções
-- SECURITY DEFINER (que rodam com search_path = ''). O mapa explícito
-- cobre todo o acento usado em português e é IMMUTABLE de verdade.

create or replace function public.shipping_normalize_city(p_city text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select nullif(
    regexp_replace(
      upper(translate(
        trim(coalesce(p_city, '')),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
      )),
      '\s+', ' ', 'g'
    ),
    ''
  );
$fn$;

comment on function public.shipping_normalize_city(text) is
  'Forma canônica do nome de cidade para comparação: sem acento, maiúscula, espaços colapsados. Usada nos DOIS lados da comparação (origem da loja e destino do comprador) — "Corumbá" e "CORUMBA" nunca podem cair em faixas de frete diferentes.';

revoke all on function public.shipping_normalize_city(text) from public;
grant execute on function public.shipping_normalize_city(text) to anon, authenticated, service_role;

create or replace function public.shipping_normalize_state(p_state text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select nullif(upper(trim(coalesce(p_state, ''))), '');
$fn$;

comment on function public.shipping_normalize_state(text) is
  'UF em maiúscula, sem espaços. Deliberadamente NÃO valida o alfabeto de 27 UFs aqui — quem recusa uma UF impossível é a CHECK da coluna e a validação da RPC, para que o erro apareça alto na configuração em vez de virar outra UF em silêncio.';

revoke all on function public.shipping_normalize_state(text) from public;
grant execute on function public.shipping_normalize_state(text) to anon, authenticated, service_role;

create or replace function public.shipping_normalize_postal_code(p_postal_code text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select nullif(regexp_replace(coalesce(p_postal_code, ''), '[^0-9]', '', 'g'), '');
$fn$;

comment on function public.shipping_normalize_postal_code(text) is
  'Extrai apenas os dígitos do CEP — "79330-000", "79330 000" e "79330000" são o mesmo CEP. A exigência de 8 dígitos vive na CHECK da coluna e nas RPCs; esta função só canonicaliza a forma.';

revoke all on function public.shipping_normalize_postal_code(text) from public;
grant execute on function public.shipping_normalize_postal_code(text) to anon, authenticated, service_role;

-- ============================================================
-- 2. store_shipping_settings
-- ============================================================

create table public.store_shipping_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,

  enabled boolean not null default false,

  -- Origem. Guardamos CEP + cidade + UF; rua/número da loja não entram
  -- porque a regra da V1 não usa endereço, só o par (cidade, UF).
  origin_postal_code text check (origin_postal_code is null or origin_postal_code ~ '^[0-9]{8}$'),
  origin_city text check (origin_city is null or char_length(origin_city) between 1 and 120),
  origin_state text check (origin_state is null or origin_state ~ '^[A-Z]{2}$'),

  -- Valores em CENTAVOS, inteiros — mesmo padrão de products.price_cents
  -- e coupons. Nenhum valor monetário do sistema usa ponto flutuante.
  same_city_fee_cents integer not null default 0 check (same_city_fee_cents between 0 and 1000000),
  same_state_fee_cents integer not null default 0 check (same_state_fee_cents between 0 and 1000000),
  other_state_fee_cents integer not null default 0 check (other_state_fee_cents between 0 and 1000000),

  -- Acréscimo fixo somado ao frete cobrado. Nunca somado quando o frete
  -- sai grátis (ver shipping_fee_for).
  additional_fee_cents integer not null default 0 check (additional_fee_cents between 0 and 1000000),

  free_shipping_enabled boolean not null default false,
  free_shipping_minimum_cents integer check (free_shipping_minimum_cents is null or free_shipping_minimum_cents > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint store_shipping_settings_store_unique unique (store_id),

  -- Entrega ligada sem origem seria um frete impossível de calcular: o
  -- banco recusa o estado inconsistente em vez de deixar o checkout
  -- descobrir isso no meio de um pedido.
  constraint store_shipping_settings_origin_required_when_enabled check (
    not enabled or (origin_postal_code is not null and origin_city is not null and origin_state is not null)
  ),

  constraint store_shipping_settings_free_minimum_required check (
    not free_shipping_enabled or (free_shipping_minimum_cents is not null and free_shipping_minimum_cents > 0)
  )
);

comment on table public.store_shipping_settings is
  'Configuração de frete DA LOJA (store-scoped, nunca por workspace — um workspace pode ter lojas em cidades diferentes). Toda escrita passa por shipping_settings_upsert (SECURITY DEFINER, owner/admin + loja active + sessão viva). O comprador nunca lê esta tabela: ele manda o CEP e recebe de volta apenas o valor do frete, via shipping_quote — a cidade/UF do destino sai de shipping_postal_codes, resolvida pelo servidor.';

comment on column public.store_shipping_settings.additional_fee_cents is
  'Acréscimo fixo em centavos somado ao valor da faixa. NÃO é somado quando o frete grátis se aplica — a regra está em shipping_fee_for e é a razão de o acréscimo não ser apenas mais uma parcela da soma.';

comment on column public.store_shipping_settings.free_shipping_minimum_cents is
  'Mínimo comparado ao subtotal DEPOIS do desconto do cupom e ANTES do frete. Produtos R$220 com cupom de R$30 dão R$190 — abaixo de um mínimo de R$200, portanto sem frete grátis.';

alter table public.store_shipping_settings enable row level security;

-- Leitura só para quem opera a loja, e mesmo assim o painel usa
-- shipping_settings_get (que devolve os defaults quando ainda não há
-- linha). O comprador nunca chega aqui: shipping_quote é SECURITY
-- DEFINER e devolve valor calculado, não a configuração.
create policy store_shipping_settings_select_member on public.store_shipping_settings
  for select to authenticated
  using (public.is_store_member(store_id));

-- Zera o default do Supabase (ALTER DEFAULT PRIVILEGES concede tudo a
-- anon/authenticated/service_role em tabelas novas) antes de conceder o
-- mínimo — a lição de 0021_revoke_default_table_grants.sql, que existiu
-- justamente porque nove migrations da TASK-012 esqueceram este revoke.
revoke all on public.store_shipping_settings from public, anon, authenticated, service_role;
grant select on public.store_shipping_settings to authenticated;
grant select, insert, update, delete on public.store_shipping_settings to service_role;

-- ============================================================
-- 2.1 shipping_postal_codes — de onde vem a cidade/UF do destino
-- ============================================================
--
-- POR QUE ESTA TABELA EXISTE
--
-- A faixa de frete é decidida comparando a cidade/UF do DESTINO com a da
-- origem. Se o destino viesse do navegador, bastaria interceptar a
-- requisição e enviar a cidade da loja para pagar sempre a faixa mais
-- barata:
--
--   CEP 01310-100 (São Paulo)  +  city="Corumbá", state="MS"  ->  same_city
--
-- O banco não faz chamada de rede, então não consegue consultar o CEP
-- sozinho. A solução é estreitar a porta: cidade e UF entram por um
-- único caminho, escrito exclusivamente por `service_role` a partir de
-- uma consulta REAL de CEP feita no servidor
-- (lib/shipping/postal-code-lookup.ts). O checkout público lê daqui, e o
-- que o navegador digitou nesses dois campos deixa de existir para
-- efeito de preço.
--
-- É a mesma técnica já usada nos pagamentos (0007_payments.sql): o fato
-- que o banco não pode verificar sozinho entra por uma RPC service_role
-- dedicada, e não por parâmetro de função pública.
--
-- Não é "tabela de faixas de CEP": não há faixa nenhuma aqui, é um cache
-- de CEP -> (cidade, UF) preenchido sob demanda, um CEP por linha.

create table public.shipping_postal_codes (
  postal_code text primary key check (postal_code ~ '^[0-9]{8}$'),
  city text not null check (char_length(city) between 1 and 120),
  state text not null check (state ~ '^[A-Z]{2}$'),
  resolved_at timestamptz not null default now()
);

comment on table public.shipping_postal_codes is
  'Cache de CEP -> (cidade, UF) resolvido pelo SERVIDOR, nunca pelo navegador. É a única fonte de destino aceita no cálculo de frete: create_order e shipping_quote leem daqui e ignoram qualquer cidade/UF vinda do cliente. Escrita só por service_role (shipping_postal_code_upsert), a partir de uma consulta real ao serviço de CEP. Dado público de referência — não contém nada de pessoal, apenas o CEP e a localidade correspondente.';

comment on column public.shipping_postal_codes.resolved_at is
  'Quando esta linha foi confirmada pelo serviço de CEP. O servidor reconsulta e reescreve a cada checkout, então o valor tende a ser recente; guardado para auditoria e para uma eventual política de expiração futura.';

alter table public.shipping_postal_codes enable row level security;

-- Sem NENHUMA policy: nem o comprador nem o lojista leem esta tabela
-- diretamente. Quem lê são as funções SECURITY DEFINER de frete, que
-- rodam como dono. Enumerar CEPs por aqui não revelaria nada sensível,
-- mas também não há motivo para abrir.
revoke all on public.shipping_postal_codes from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.shipping_postal_codes to service_role;

create or replace function public.shipping_postal_code_upsert(
  p_postal_code text,
  p_city text,
  p_state text
)
returns public.shipping_postal_codes
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_postal text := public.shipping_normalize_postal_code(p_postal_code);
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_state text := public.shipping_normalize_state(p_state);
  v_row public.shipping_postal_codes;
begin
  if v_postal is null or v_postal !~ '^[0-9]{8}$' then
    raise exception 'invalid_postal_code' using errcode = '22023';
  end if;
  if v_city is null or char_length(v_city) > 120 then
    raise exception 'invalid_postal_code_city' using errcode = '22023';
  end if;
  if v_state is null or v_state !~ '^[A-Z]{2}$' then
    raise exception 'invalid_postal_code_state' using errcode = '22023';
  end if;

  insert into public.shipping_postal_codes (postal_code, city, state)
  values (v_postal, v_city, v_state)
  on conflict (postal_code) do update set
    city = excluded.city,
    state = excluded.state,
    resolved_at = now()
  returning * into v_row;

  return v_row;
end;
$fn$;

comment on function public.shipping_postal_code_upsert(text, text, text) is
  'Grava o resultado de uma consulta de CEP feita no servidor. EXECUTE só para service_role — é esta restrição que impede o comprador de plantar "CEP de São Paulo fica em Corumbá/MS" e pagar a faixa mais barata. Chamada exclusivamente por lib/shipping/service-only/postal-code-store.ts, depois de uma resposta real do serviço de CEP.';

revoke all on function public.shipping_postal_code_upsert(text, text, text) from public, anon, authenticated;
grant execute on function public.shipping_postal_code_upsert(text, text, text) to service_role;

-- Leitura do destino confiável. Devolve zero linhas quando o CEP nunca
-- foi resolvido pelo servidor — e é assim que o cálculo descobre que não
-- pode prosseguir, em vez de cair num palpite.
create or replace function public.shipping_resolve_destination(p_postal_code text)
returns table (city text, state text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.city, p.state
  from public.shipping_postal_codes p
  where p.postal_code = public.shipping_normalize_postal_code(p_postal_code);
$fn$;

comment on function public.shipping_resolve_destination(text) is
  'Cidade/UF de um CEP, sempre a partir do que o SERVIDOR resolveu. Única fonte de destino do cálculo de frete. CEP não resolvido devolve vazio — o chamador recusa o pedido (shipping_destination_unresolved) em vez de aceitar o que o navegador afirmou.';

revoke all on function public.shipping_resolve_destination(text) from public;
grant execute on function public.shipping_resolve_destination(text) to anon, authenticated, service_role;

-- ============================================================
-- 3. shipping_fee_for — a regra, num lugar só
-- ============================================================
--
-- Pura: não lê tabela, não decide autorização. Existe para que a prévia
-- (shipping_quote) e a cobrança real (create_order) NUNCA possam
-- divergir — é literalmente a mesma função nas duas pontas.
--
-- A ordem importa e é a da especificação:
--   1. frete grátis atingido -> 0 (e o acréscimo NÃO entra)
--   2. mesma cidade E mesma UF -> same_city
--   3. mesma UF                -> same_state
--   4. resto                   -> other_state
--   ... e só então soma o acréscimo.

create or replace function public.shipping_fee_for(
  p_origin_city text,
  p_origin_state text,
  p_dest_city text,
  p_dest_state text,
  p_same_city_fee_cents integer,
  p_same_state_fee_cents integer,
  p_other_state_fee_cents integer,
  p_additional_fee_cents integer,
  p_free_shipping_enabled boolean,
  p_free_shipping_minimum_cents integer,
  p_discounted_subtotal_cents integer
)
returns table (rule text, shipping_cents integer)
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_origin_city text := public.shipping_normalize_city(p_origin_city);
  v_origin_state text := public.shipping_normalize_state(p_origin_state);
  v_dest_city text := public.shipping_normalize_city(p_dest_city);
  v_dest_state text := public.shipping_normalize_state(p_dest_state);
begin
  if coalesce(p_free_shipping_enabled, false)
     and p_free_shipping_minimum_cents is not null
     and coalesce(p_discounted_subtotal_cents, 0) >= p_free_shipping_minimum_cents then
    -- Frete grátis é grátis de verdade: acréscimo nenhum é somado aqui.
    return query select 'free'::text, 0;
    return;
  end if;

  if v_dest_state is not distinct from v_origin_state
     and v_dest_city is not distinct from v_origin_city then
    return query select 'same_city'::text,
      coalesce(p_same_city_fee_cents, 0) + coalesce(p_additional_fee_cents, 0);
  elsif v_dest_state is not distinct from v_origin_state then
    return query select 'same_state'::text,
      coalesce(p_same_state_fee_cents, 0) + coalesce(p_additional_fee_cents, 0);
  else
    return query select 'other_state'::text,
      coalesce(p_other_state_fee_cents, 0) + coalesce(p_additional_fee_cents, 0);
  end if;
end;
$fn$;

comment on function public.shipping_fee_for(text, text, text, text, integer, integer, integer, integer, boolean, integer, integer) is
  'A regra de frete da V1, em um único lugar: mesma cidade / mesma UF / outra UF, com frete grátis tendo prioridade sobre as três. Quando o frete sai grátis o acréscimo NÃO é cobrado — grátis significa zero, não "zero mais a taxa". Cidade e UF são normalizadas nos dois lados antes da comparação, então acento e caixa nunca mudam a faixa.';

revoke all on function public.shipping_fee_for(text, text, text, text, integer, integer, integer, integer, boolean, integer, integer) from public;
grant execute on function public.shipping_fee_for(text, text, text, text, integer, integer, integer, integer, boolean, integer, integer) to anon, authenticated, service_role;

-- ============================================================
-- 4. shipping_settings_get / shipping_settings_upsert (painel)
-- ============================================================

create or replace function public.shipping_settings_get(p_store_id uuid)
returns table (
  is_configured boolean,
  enabled boolean,
  origin_postal_code text,
  origin_city text,
  origin_state text,
  same_city_fee_cents integer,
  same_state_fee_cents integer,
  other_state_fee_cents integer,
  additional_fee_cents integer,
  free_shipping_enabled boolean,
  free_shipping_minimum_cents integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row public.store_shipping_settings;
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select * into v_row from public.store_shipping_settings where store_id = p_store_id;

  if v_row.id is null then
    -- Loja que nunca configurou frete: devolve o estado neutro em vez de
    -- nada, para o painel abrir num formulário vazio e não num erro.
    return query select false, false, null::text, null::text, null::text,
      0, 0, 0, 0, false, null::integer, null::timestamptz;
    return;
  end if;

  return query select true, v_row.enabled, v_row.origin_postal_code, v_row.origin_city, v_row.origin_state,
    v_row.same_city_fee_cents, v_row.same_state_fee_cents, v_row.other_state_fee_cents,
    v_row.additional_fee_cents, v_row.free_shipping_enabled, v_row.free_shipping_minimum_cents, v_row.updated_at;
end;
$fn$;

comment on function public.shipping_settings_get(uuid) is
  'Configuração de frete para o painel. Qualquer membro lê (é informação operacional da loja, não credencial); só owner/admin escreve, via shipping_settings_upsert. Loja sem linha nenhuma devolve o estado neutro (desligado, tudo zero), nunca erro.';

revoke all on function public.shipping_settings_get(uuid) from public;
grant execute on function public.shipping_settings_get(uuid) to authenticated;

create or replace function public.shipping_settings_upsert(
  p_store_id uuid,
  p_enabled boolean,
  p_origin_postal_code text,
  p_origin_city text,
  p_origin_state text,
  p_same_city_fee_cents integer,
  p_same_state_fee_cents integer,
  p_other_state_fee_cents integer,
  p_additional_fee_cents integer,
  p_free_shipping_enabled boolean,
  p_free_shipping_minimum_cents integer
)
returns public.store_shipping_settings
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_postal text := public.shipping_normalize_postal_code(p_origin_postal_code);
  v_city text := nullif(trim(coalesce(p_origin_city, '')), '');
  v_state text := public.shipping_normalize_state(p_origin_state);
  v_enabled boolean := coalesce(p_enabled, false);
  v_free boolean := coalesce(p_free_shipping_enabled, false);
  v_row public.store_shipping_settings;
begin
  -- Mesma autorização operacional do catálogo e dos cupons: owner/admin,
  -- loja active, sessão da CaraffaStore viva (0016_app_sessions.sql).
  -- Staff nunca configura frete.
  if not public.can_manage_store_catalog(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_postal is not null and v_postal !~ '^[0-9]{8}$' then
    raise exception 'invalid_origin_postal_code' using errcode = '22023';
  end if;
  if v_state is not null and v_state !~ '^[A-Z]{2}$' then
    raise exception 'invalid_origin_state' using errcode = '22023';
  end if;
  if v_city is not null and char_length(v_city) > 120 then
    raise exception 'invalid_origin_city' using errcode = '22023';
  end if;

  -- Ligar a entrega sem saber de onde ela sai é o erro de configuração
  -- mais provável — recusado aqui com um código próprio, não com a
  -- mensagem genérica da CHECK.
  if v_enabled and (v_postal is null or v_city is null or v_state is null) then
    raise exception 'origin_required' using errcode = '22023';
  end if;

  if coalesce(p_same_city_fee_cents, 0) < 0 or coalesce(p_same_state_fee_cents, 0) < 0
     or coalesce(p_other_state_fee_cents, 0) < 0 or coalesce(p_additional_fee_cents, 0) < 0 then
    raise exception 'invalid_shipping_fee' using errcode = '22023';
  end if;
  if coalesce(p_same_city_fee_cents, 0) > 1000000 or coalesce(p_same_state_fee_cents, 0) > 1000000
     or coalesce(p_other_state_fee_cents, 0) > 1000000 or coalesce(p_additional_fee_cents, 0) > 1000000 then
    raise exception 'shipping_fee_too_high' using errcode = '22023';
  end if;

  if v_free and (p_free_shipping_minimum_cents is null or p_free_shipping_minimum_cents <= 0) then
    raise exception 'invalid_free_shipping_minimum' using errcode = '22023';
  end if;

  insert into public.store_shipping_settings (
    store_id, enabled, origin_postal_code, origin_city, origin_state,
    same_city_fee_cents, same_state_fee_cents, other_state_fee_cents, additional_fee_cents,
    free_shipping_enabled, free_shipping_minimum_cents
  ) values (
    p_store_id, v_enabled, v_postal, v_city, v_state,
    coalesce(p_same_city_fee_cents, 0), coalesce(p_same_state_fee_cents, 0),
    coalesce(p_other_state_fee_cents, 0), coalesce(p_additional_fee_cents, 0),
    v_free, case when v_free then p_free_shipping_minimum_cents else null end
  )
  on conflict (store_id) do update set
    enabled = excluded.enabled,
    origin_postal_code = excluded.origin_postal_code,
    origin_city = excluded.origin_city,
    origin_state = excluded.origin_state,
    same_city_fee_cents = excluded.same_city_fee_cents,
    same_state_fee_cents = excluded.same_state_fee_cents,
    other_state_fee_cents = excluded.other_state_fee_cents,
    additional_fee_cents = excluded.additional_fee_cents,
    free_shipping_enabled = excluded.free_shipping_enabled,
    free_shipping_minimum_cents = excluded.free_shipping_minimum_cents,
    updated_at = now()
  returning * into v_row;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_store_id, 'shipping_settings_updated', 'store_shipping_settings', v_row.id::text,
    jsonb_build_object(
      'enabled', v_row.enabled,
      'origin_city', v_row.origin_city,
      'origin_state', v_row.origin_state,
      'same_city_fee_cents', v_row.same_city_fee_cents,
      'same_state_fee_cents', v_row.same_state_fee_cents,
      'other_state_fee_cents', v_row.other_state_fee_cents,
      'additional_fee_cents', v_row.additional_fee_cents,
      'free_shipping_enabled', v_row.free_shipping_enabled,
      'free_shipping_minimum_cents', v_row.free_shipping_minimum_cents));

  return v_row;
end;
$fn$;

comment on function public.shipping_settings_upsert(uuid, boolean, text, text, text, integer, integer, integer, integer, boolean, integer) is
  'Única forma de gravar a configuração de frete. Exige can_manage_store_catalog (owner/admin + loja active + sessão viva) — chamar a RPC direto sem passar pelo painel não contorna nada. Recusa entrega ligada sem CEP/cidade/UF de origem e frete grátis sem mínimo válido, em vez de gravar um estado que o checkout não conseguiria calcular.';

revoke all on function public.shipping_settings_upsert(uuid, boolean, text, text, text, integer, integer, integer, integer, boolean, integer) from public;
grant execute on function public.shipping_settings_upsert(uuid, boolean, text, text, text, integer, integer, integer, integer, boolean, integer) to authenticated;

-- ============================================================
-- 5. audit_log_action_check — só ALARGA
-- ============================================================
--
-- Mesma regra de todas as migrations anteriores (bloqueador histórico
-- BUG-RT2-006, qa/reports/TASK-002-RETEST.md): o conjunto de actions só
-- cresce. A lista abaixo é a de 0020_coupon_lifecycle.sql, intacta, mais
-- a action nova desta task.

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
  'member_invited', 'member_joined', 'member_removed', 'member_invitation_revoked',
  'session_created', 'session_revoked',
  'coupon_created', 'coupon_updated', 'coupon_disabled',
  'coupon_reserved', 'coupon_consumed', 'coupon_released',
  -- TASK-013 — frete
  'shipping_settings_updated'
));

-- ============================================================
-- 6. orders ganha o snapshot do frete e do endereço
-- ============================================================
--
-- Pedido histórico NUNCA é recalculado. Se o lojista mudar a mesma
-- cidade de R$10 para R$30 amanhã, um pedido de ontem continua
-- mostrando R$10 — o valor, a faixa aplicada e a origem usada viajam
-- gravados na própria linha do pedido, exatamente como já acontece com
-- o cupom (0019_coupons.sql).
--
-- Backfill dos pedidos existentes: frete zero e endereço estruturado
-- nulo. Nenhum pedido antigo passa a "ter tido" frete, e o
-- delivery_address em texto livre dos pedidos antigos continua
-- intocado.

alter table public.orders
  add column shipping_amount_cents integer not null default 0 check (shipping_amount_cents >= 0),
  add column shipping_rule text
    check (shipping_rule is null or shipping_rule in ('free', 'same_city', 'same_state', 'other_state')),
  add column shipping_postal_code text
    check (shipping_postal_code is null or shipping_postal_code ~ '^[0-9]{8}$'),
  add column shipping_street text,
  add column shipping_number text,
  add column shipping_complement text,
  add column shipping_neighborhood text,
  add column shipping_city text,
  add column shipping_state text
    check (shipping_state is null or shipping_state ~ '^[A-Z]{2}$'),
  add column shipping_origin_postal_code text,
  add column shipping_origin_city text,
  add column shipping_origin_state text;

comment on column public.orders.shipping_amount_cents is
  'Frete efetivamente cobrado NESTE pedido, em centavos. Junto com subtotal_cents e discount_cents forma a verdade financeira do momento da compra: total = subtotal - desconto + frete, garantido por CHECK. Alterar a configuração da loja depois não reescreve este número.';

comment on column public.orders.shipping_rule is
  'Faixa aplicada no momento da compra: free, same_city, same_state ou other_state. Snapshot — serve para o lojista entender por que aquele pedido pagou aquele valor, mesmo anos depois e com a tabela de preços já trocada.';

comment on column public.orders.shipping_origin_city is
  'Cidade de origem usada NO CÁLCULO deste pedido. Se a loja mudar de cidade, o pedido antigo continua explicando a conta que foi feita na época.';

-- A verdade financeira do pedido passa a ter três parcelas. A constraint
-- antiga (total = subtotal - desconto) é substituída, não afrouxada:
-- continua sendo impossível gravar um total que não bate com as partes.
alter table public.orders drop constraint orders_total_matches_discount;

alter table public.orders add constraint orders_total_matches_components
  check (total_cents = subtotal_cents - discount_cents + shipping_amount_cents);

comment on constraint orders_total_matches_components on public.orders is
  'total = subtotal - desconto + frete. Substitui orders_total_matches_discount (TASK-012), que não conhecia frete. Nenhum pedido existente é afetado: shipping_amount_cents nasce 0 no backfill, então a igualdade antiga continua valendo para todos eles.';

-- Endereço estruturado obrigatório quando houve cálculo de frete: um
-- pedido com faixa aplicada e sem destino gravado seria um pedido que
-- não sabe explicar o próprio valor.
alter table public.orders add constraint orders_shipping_snapshot_complete
  check (
    shipping_rule is null
    or (shipping_postal_code is not null and shipping_city is not null and shipping_state is not null)
  );

-- ============================================================
-- 7. shipping_quote — prévia pública do checkout (anon)
-- ============================================================
--
-- É SÓ prévia: não cria pedido, não reserva nada, não trava linha
-- nenhuma. Mas o subtotal NÃO vem do navegador — é recalculado a partir
-- de products, do mesmo jeito que create_order faz. Isso é o que
-- permite a tela mostrar "Total R$ 194,90" e o Pix cobrar exatamente
-- isso: as duas contas nascem das mesmas fontes.
--
-- Um payload adulterado (preço, desconto ou frete inventados) não muda
-- nada aqui, porque nenhum desses números é aceito como entrada. Cidade
-- e UF também não: o destino vem de shipping_resolve_destination, sobre
-- o CEP. Esta função recebe exatamente os mesmos dados que create_order
-- e roda a mesma conta — é por isso que prévia e cobrança não têm como
-- divergir.

create or replace function public.shipping_quote(
  p_store_slug text,
  p_items jsonb,
  p_coupon_code text,
  p_postal_code text
)
returns table (
  shipping_enabled boolean,
  available boolean,
  reason text,
  rule text,
  shipping_cents integer,
  subtotal_cents integer,
  discount_cents integer,
  total_cents integer,
  free_shipping_enabled boolean,
  free_shipping_minimum_cents integer,
  origin_city text,
  origin_state text,
  -- Destino REALMENTE usado no calculo, resolvido do CEP pelo servidor.
  -- A tela mostra este par, nunca o que foi digitado: assim o comprador
  -- ve a mesma cidade que decidiu o preco.
  dest_city text,
  dest_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store_id uuid;
  v_store_status text;
  v_settings public.store_shipping_settings;
  v_items_normalized jsonb;
  v_subtotal integer := 0;
  v_found integer := 0;
  v_expected integer;
  v_discount integer := 0;
  v_discounted integer;
  v_coupon record;
  v_coupon_code text := nullif(trim(coalesce(p_coupon_code, '')), '');
  v_postal text := public.shipping_normalize_postal_code(p_postal_code);
  -- Destino resolvido pelo servidor a partir do CEP, nunca recebido.
  v_city text;
  v_state text;
  v_fee record;
begin
  select id, status into v_store_id, v_store_status from public.stores where slug = p_store_slug;
  if v_store_id is null or v_store_status <> 'active' then
    return query select false, false, 'store_not_available'::text, null::text, 0, 0, 0, 0,
      false, null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  select * into v_settings from public.store_shipping_settings where store_id = v_store_id;

  -- Loja sem frete configurado: a tela some com a seção de endereço
  -- estruturado e o checkout segue o caminho legado (entrega com
  -- endereço livre, frete zero).
  if v_settings.id is null or not v_settings.enabled then
    return query select false, false, 'shipping_disabled'::text, null::text, 0, 0, 0, 0,
      false, null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- Subtotal recalculado do banco, nunca recebido pronto.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return query select true, false, 'empty_cart'::text, null::text, 0, 0, 0, 0,
      v_settings.free_shipping_enabled, v_settings.free_shipping_minimum_cents,
      v_settings.origin_city, v_settings.origin_state, null::text, null::text;
    return;
  end if;
  if jsonb_array_length(p_items) > 50 then
    return query select true, false, 'too_many_items'::text, null::text, 0, 0, 0, 0,
      v_settings.free_shipping_enabled, v_settings.free_shipping_minimum_cents,
      v_settings.origin_city, v_settings.origin_state, null::text, null::text;
    return;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where not (item ? 'product_id') or not (item ? 'quantity')
      or (item->>'product_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (item->>'quantity') !~ '^[0-9]+$'
      or (item->>'quantity')::int < 1
      or (item->>'quantity')::int > 999
  ) then
    return query select true, false, 'invalid_item'::text, null::text, 0, 0, 0, 0,
      v_settings.free_shipping_enabled, v_settings.free_shipping_minimum_cents,
      v_settings.origin_city, v_settings.origin_state, null::text, null::text;
    return;
  end if;

  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', total_qty) order by product_id)
    into v_items_normalized
  from (
    select (item->>'product_id')::uuid as product_id, sum((item->>'quantity')::int) as total_qty
    from jsonb_array_elements(p_items) item
    group by (item->>'product_id')::uuid
  ) consolidated;

  select coalesce(sum(p.price_cents * x.quantity), 0)::integer, count(*)::integer
    into v_subtotal, v_found
  from public.products p
  join jsonb_to_recordset(v_items_normalized) as x(product_id uuid, quantity int)
    on x.product_id = p.id
  where p.store_id = v_store_id and p.status = 'published';

  select jsonb_array_length(v_items_normalized) into v_expected;
  if v_found <> v_expected then
    return query select true, false, 'product_not_found'::text, null::text, 0, 0, 0, 0,
      v_settings.free_shipping_enabled, v_settings.free_shipping_minimum_cents,
      v_settings.origin_city, v_settings.origin_state, null::text, null::text;
    return;
  end if;

  -- Desconto pela MESMA função que o pedido usa. Cupom inválido aqui não
  -- é erro de frete: a prévia segue sem desconto, e quem reclama do
  -- cupom é a prévia do cupom (coupon_preview), na tela do carrinho.
  if v_coupon_code is not null then
    select * into v_coupon from public.coupon_validate(v_store_id, v_coupon_code, v_subtotal) v;
    if v_coupon.valid then
      v_discount := v_coupon.discount_cents;
    end if;
  end if;
  v_discounted := v_subtotal - v_discount;

  -- CEP ainda não preenchido, ou preenchido fora do formato: a tela
  -- simplesmente ainda não tem o que perguntar respondido.
  if v_postal is null or v_postal !~ '^[0-9]{8}$' then
    return query select true, false, 'invalid_postal_code'::text, null::text, 0,
      v_subtotal, v_discount, v_discounted,
      v_settings.free_shipping_enabled, v_settings.free_shipping_minimum_cents,
      v_settings.origin_city, v_settings.origin_state, null::text, null::text;
    return;
  end if;

  -- Destino SEMPRE do CEP resolvido pelo servidor. Se o CEP nunca foi
  -- resolvido (serviço de CEP fora do ar, ou CEP inexistente), a prévia
  -- diz que não deu para calcular — e não chuta uma faixa a partir do
  -- que o navegador digitou.
  select d.city, d.state into v_city, v_state from public.shipping_resolve_destination(v_postal) d;
  if v_city is null or v_state is null then
    return query select true, false, 'destination_unresolved'::text, null::text, 0,
      v_subtotal, v_discount, v_discounted,
      v_settings.free_shipping_enabled, v_settings.free_shipping_minimum_cents,
      v_settings.origin_city, v_settings.origin_state, null::text, null::text;
    return;
  end if;

  select f.rule, f.shipping_cents into v_fee
  from public.shipping_fee_for(
    v_settings.origin_city, v_settings.origin_state, v_city, v_state,
    v_settings.same_city_fee_cents, v_settings.same_state_fee_cents, v_settings.other_state_fee_cents,
    v_settings.additional_fee_cents, v_settings.free_shipping_enabled, v_settings.free_shipping_minimum_cents,
    v_discounted
  ) f;

  return query select true, true, null::text, v_fee.rule, v_fee.shipping_cents,
    v_subtotal, v_discount, v_discounted + v_fee.shipping_cents,
    v_settings.free_shipping_enabled, v_settings.free_shipping_minimum_cents,
    v_settings.origin_city, v_settings.origin_state, v_city, v_state;
end;
$fn$;

comment on function public.shipping_quote(text, jsonb, text, text) is
  'Prévia do frete para o checkout público. Recalcula subtotal a partir de products e desconto por coupon_validate — nenhum valor monetário é aceito do navegador, nem para exibir. Por isso o total mostrado na tela é exatamente o que create_order vai gravar e o que o Mercado Pago vai cobrar. Não reserva nada e não cria pedido.';

revoke all on function public.shipping_quote(text, jsonb, text, text) from public;
grant execute on function public.shipping_quote(text, jsonb, text, text) to anon, authenticated;

-- ============================================================
-- 8. create_order passa a calcular e gravar o frete
-- ============================================================
--
-- Corpo derivado do de 0020_coupon_lifecycle.sql; as mudanças estão
-- marcadas com TASK-013: os parâmetros de endereço, o endereço no
-- fingerprint de idempotência, o bloco 6.6 (frete) e o snapshot no
-- INSERT. Todo o resto — releitura de preços do banco, lock de produtos
-- em ORDER BY id, reserva do cupom, baixa de estoque, auditoria — é
-- preservado literalmente.
--
-- O QUE NÃO É PARÂMETRO, DE PROPÓSITO
--
-- Não existe p_shipping_amount_cents, p_subtotal_cents, p_discount_cents
-- nem p_total_cents: valor que o cliente não pode enviar é valor que o
-- cliente não pode forjar.
--
-- Também não existe p_shipping_city nem p_shipping_state. Cidade e UF
-- decidem a FAIXA, então aceitá-las do navegador seria o mesmo que
-- aceitar o preço: bastaria mandar um CEP de São Paulo com
-- city="Corumbá"/state="MS" para pagar a faixa de mesma cidade. As duas
-- saem de shipping_resolve_destination, sobre o CEP, a partir do que o
-- servidor resolveu.
--
-- p_expected_total_cents é o único número que o cliente manda — e ele
-- só consegue FAZER O PEDIDO FALHAR, nunca baratear: é comparado com o
-- total recalculado aqui e, se divergir, o pedido é recusado. Serve para
-- o caso em que o lojista muda a tabela de preços entre a tela e o
-- envio: em vez de cobrar em silêncio um valor diferente do que estava
-- na tela, o checkout recotiza e mostra o novo valor.
--
-- DROP explícito: os parâmetros novos criariam uma SOBRECARGA em vez de
-- substituir, e a chamada de 9 argumentos ficaria presa na versão antiga
-- (sem frete). Mesma lição de 0010/0011/0013/0020.
drop function if exists public.create_order(text, uuid, text, text, text, text, text, jsonb, text);

create or replace function public.create_order(
  p_store_slug text,
  p_idempotency_key uuid,
  p_customer_name text,
  p_customer_phone text,
  p_fulfillment_method text,
  p_delivery_address text,
  p_customer_notes text,
  p_items jsonb,
  p_coupon_code text default null,
  p_shipping_postal_code text default null,
  p_shipping_street text default null,
  p_shipping_number text default null,
  p_shipping_complement text default null,
  p_shipping_neighborhood text default null,
  p_expected_total_cents integer default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_store_status text;
  v_customer_name text := nullif(trim(p_customer_name), '');
  v_customer_phone text := nullif(trim(p_customer_phone), '');
  v_delivery_address text := nullif(trim(p_delivery_address), '');
  v_customer_notes text := nullif(trim(p_customer_notes), '');
  v_items_normalized jsonb;
  v_fingerprint text;
  v_existing_order public.orders;
  v_product_count integer;
  v_found_count integer := 0;
  v_subtotal integer := 0;
  v_line_items jsonb := '[]'::jsonb;
  v_public_code text;
  v_order public.orders;
  v_stock_updated_count integer;
  v_row record;
  v_coupon record;
  -- Escalares dedicados em vez de ler v_coupon direto no INSERT: um
  -- `record` NAO atribuido (pedido sem cupom) faz o Postgres levantar
  -- "tuple structure of a not-yet-assigned record is indeterminate".
  v_coupon_id uuid;
  v_coupon_code_snap text;
  v_coupon_type_snap text;
  v_coupon_value_snap integer;
  v_discount integer := 0;
  v_total integer;
  v_coupon_code text := nullif(trim(coalesce(p_coupon_code, '')), '');
  v_max_uses integer;
  -- TASK-013 — frete
  v_settings public.store_shipping_settings;
  v_ship_postal text := public.shipping_normalize_postal_code(p_shipping_postal_code);
  v_ship_street text := nullif(trim(coalesce(p_shipping_street, '')), '');
  v_ship_number text := nullif(trim(coalesce(p_shipping_number, '')), '');
  v_ship_complement text := nullif(trim(coalesce(p_shipping_complement, '')), '');
  v_ship_neighborhood text := nullif(trim(coalesce(p_shipping_neighborhood, '')), '');
  -- Resolvidos do CEP pelo servidor, nunca recebidos do cliente.
  v_ship_city text;
  v_ship_state text;
  v_shipping_cents integer := 0;
  v_shipping_rule text;
  v_fee record;
  v_structured_shipping boolean := false;
begin
  -- 1. loja
  select id, status into v_store_id, v_store_status from public.stores where slug = p_store_slug;
  if v_store_id is null then
    raise exception 'store_not_found' using errcode = '02000';
  end if;
  if v_store_status <> 'active' then
    raise exception 'store_not_active' using errcode = '42501';
  end if;

  -- TASK-013: a configuração é lida ANTES de validar o endereço, porque é
  -- ela quem decide QUAL endereço é exigido — o estruturado (frete
  -- ligado) ou o texto livre de sempre (frete desligado).
  select * into v_settings from public.store_shipping_settings where store_id = v_store_id;
  v_structured_shipping := p_fulfillment_method = 'delivery'
    and v_settings.id is not null and v_settings.enabled;

  -- 2. campos do cliente
  if v_customer_name is null or char_length(v_customer_name) < 2 or char_length(v_customer_name) > 120 then
    raise exception 'invalid_customer_name' using errcode = '22023';
  end if;
  if v_customer_phone is null or v_customer_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'invalid_customer_phone' using errcode = '22023';
  end if;
  if p_fulfillment_method not in ('pickup', 'delivery') then
    raise exception 'invalid_fulfillment_method' using errcode = '22023';
  end if;

  if v_structured_shipping then
    -- Entrega com frete ligado: o endereço é estruturado e o CEP é
    -- obrigatório. O delivery_address de texto livre passa a ser
    -- DERIVADO desses campos (montado abaixo), nunca recebido pronto —
    -- assim as telas antigas que leem delivery_address continuam
    -- funcionando sem duplicar a informação.
    if v_ship_postal is null or v_ship_postal !~ '^[0-9]{8}$' then
      raise exception 'invalid_shipping_postal_code' using errcode = '22023';
    end if;
    if v_ship_street is null or char_length(v_ship_street) > 200 then
      raise exception 'invalid_shipping_street' using errcode = '22023';
    end if;
    if v_ship_number is null or char_length(v_ship_number) > 20 then
      raise exception 'invalid_shipping_number' using errcode = '22023';
    end if;
    if v_ship_complement is not null and char_length(v_ship_complement) > 100 then
      raise exception 'invalid_shipping_complement' using errcode = '22023';
    end if;
    if v_ship_neighborhood is not null and char_length(v_ship_neighborhood) > 120 then
      raise exception 'invalid_shipping_neighborhood' using errcode = '22023';
    end if;

    -- O destino sai do CEP, resolvido pelo SERVIDOR (shipping_postal_codes,
    -- escrita só por service_role). Nada aqui olha para o que o navegador
    -- afirmou sobre cidade ou UF — esses campos nem chegam nesta função.
    --
    -- CEP nunca resolvido (serviço de CEP fora do ar, ou CEP inexistente)
    -- recusa o pedido em vez de arbitrar uma faixa. É o fallback seguro:
    -- a alternativa seria deixar o comprador escolher a própria cidade e,
    -- com ela, o próprio preço.
    select d.city, d.state into v_ship_city, v_ship_state
    from public.shipping_resolve_destination(v_ship_postal) d;

    if v_ship_city is null or v_ship_state is null then
      raise exception 'shipping_destination_unresolved' using errcode = '23514';
    end if;

    v_delivery_address := v_ship_street || ', ' || v_ship_number
      || coalesce(' - ' || v_ship_complement, '')
      || coalesce(', ' || v_ship_neighborhood, '')
      || ', ' || v_ship_city || ' - ' || v_ship_state
      || ', CEP ' || substr(v_ship_postal, 1, 5) || '-' || substr(v_ship_postal, 6, 3);
  else
    -- Caminho legado, preservado: retirada, ou entrega numa loja que
    -- ainda não configurou frete.
    if p_fulfillment_method = 'delivery' and (v_delivery_address is null or char_length(v_delivery_address) = 0) then
      raise exception 'delivery_address_required' using errcode = '22023';
    end if;
    if v_delivery_address is not null and char_length(v_delivery_address) > 500 then
      raise exception 'invalid_delivery_address' using errcode = '22023';
    end if;
  end if;

  if v_customer_notes is not null and char_length(v_customer_notes) > 1000 then
    raise exception 'invalid_customer_notes' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;

  -- 3. itens: valida formato, rejeita vazio/excesso, consolida duplicados
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    where not (item ? 'product_id') or not (item ? 'quantity')
      or (item->>'product_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (item->>'quantity') !~ '^[0-9]+$'
      or (item->>'quantity')::int < 1
      or (item->>'quantity')::int > 999
  ) then
    raise exception 'invalid_item' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', total_qty) order by product_id)
    into v_items_normalized
  from (
    select (item->>'product_id')::uuid as product_id, sum((item->>'quantity')::int) as total_qty
    from jsonb_array_elements(p_items) item
    group by (item->>'product_id')::uuid
  ) consolidated;

  -- 4. idempotência: fingerprint determinístico do conteúdo (nunca do preço,
  -- que é recalculado do banco a cada tentativa) + advisory lock por
  -- (store_id, idempotency_key) — serializa duas chamadas concorrentes com
  -- a MESMA key (duplo clique/retry real), sem bloquear chamadas com keys
  -- diferentes (carrinhos/clientes distintos continuam paralelos).
  v_fingerprint := md5(
    coalesce(v_customer_name, '') || '|' || coalesce(v_customer_phone, '') || '|' || p_fulfillment_method || '|' ||
    coalesce(v_delivery_address, '') || '|' || coalesce(v_customer_notes, '') || '|' ||
    coalesce((
      select string_agg((elem->>'product_id') || ':' || (elem->>'quantity'), ',' order by elem->>'product_id')
      from jsonb_array_elements(v_items_normalized) elem
    ), '') || '|' ||
    -- TASK-012: o cupom entra no fingerprint. Sem isso, reenviar o mesmo
    -- carrinho com um cupom DIFERENTE sob a mesma idempotency key
    -- devolveria o pedido antigo (sem desconto) como se fosse sucesso.
    coalesce(public.coupon_normalize_code(v_coupon_code), '') || '|' ||
    -- TASK-013: e o endereço também. v_delivery_address já é derivado
    -- dele no caminho estruturado, mas CEP/cidade/UF entram explícitos
    -- porque são o que decide o VALOR — trocar só o CEP sob a mesma key
    -- não pode devolver o pedido antigo, com o frete antigo.
    coalesce(v_ship_postal, '') || '|' || coalesce(public.shipping_normalize_city(v_ship_city), '') || '|' ||
    coalesce(v_ship_state, '')
  );

  perform pg_advisory_xact_lock(hashtextextended(v_store_id::text || ':' || p_idempotency_key::text, 0));

  select * into v_existing_order from public.orders where store_id = v_store_id and idempotency_key = p_idempotency_key;
  if v_existing_order.id is not null then
    if v_existing_order.request_fingerprint = v_fingerprint then
      return v_existing_order; -- reenvio idempotente: mesmo pedido, sem duplicar nada
    else
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
  end if;

  -- 5+6. bloqueia produtos em ORDER BY id (evita deadlock entre pedidos
  -- concorrentes) e valida loja/status/estoque com o preço lido agora.
  select jsonb_array_length(v_items_normalized) into v_product_count;

  for v_row in
    select p.id, p.store_id, p.status, p.stock, p.price_cents, p.name, p.slug, x.quantity
    from public.products p
    join jsonb_to_recordset(v_items_normalized) as x(product_id uuid, quantity int)
      on x.product_id = p.id
    order by p.id
    for update of p
  loop
    if v_row.store_id <> v_store_id then
      raise exception 'product_store_mismatch' using errcode = '23514';
    end if;
    if v_row.status <> 'published' then
      raise exception 'product_not_available' using errcode = '23514';
    end if;
    if v_row.stock < v_row.quantity then
      raise exception 'insufficient_stock' using errcode = '23514';
    end if;

    v_subtotal := v_subtotal + (v_row.price_cents * v_row.quantity);
    v_found_count := v_found_count + 1;
    v_line_items := v_line_items || jsonb_build_object(
      'product_id', v_row.id,
      'name', v_row.name,
      'slug', v_row.slug,
      'unit_price_cents', v_row.price_cents,
      'quantity', v_row.quantity,
      'line_total_cents', v_row.price_cents * v_row.quantity
    );
  end loop;

  if v_found_count <> v_product_count then
    raise exception 'product_not_found' using errcode = '23503';
  end if;

  -- 6.5 TASK-012 — cupom: valida com o subtotal JA recalculado do banco
  -- (nunca o que o navegador disse) e reserva a utilizacao.
  --
  -- A reserva acontece AQUI, dentro da mesma transacao que cria o pedido
  -- e baixa o estoque. E o que impede dois checkouts simultaneos de
  -- levarem a mesma ultima vaga: o `for update` na linha do cupom
  -- serializa os dois, e o segundo rele a contagem ja com a reserva do
  -- primeiro visivel.
  --
  -- Nenhuma chamada de rede acontece dentro desta transacao — o Mercado
  -- Pago so e chamado depois, em lib/payments/checkout-orchestration.ts.
  v_total := v_subtotal;

  if v_coupon_code is not null then
    select * into v_coupon
      from public.coupon_validate(v_store_id, v_coupon_code, v_subtotal) v;

    if not v_coupon.valid then
      raise exception '%', v_coupon.reason using errcode = '23514';
    end if;

    -- Trava a linha do cupom antes de decidir a vaga.
    perform 1 from public.coupons where id = v_coupon.coupon_id for update;

    -- Releitura pos-lock: o limite pode ter se esgotado entre a
    -- validacao e o lock (TOCTOU classico).
    select max_uses into v_max_uses from public.coupons where id = v_coupon.coupon_id;
    if v_max_uses is not null and public.coupon_used_count(v_coupon.coupon_id) >= v_max_uses then
      raise exception 'coupon_usage_limit_reached' using errcode = '23514';
    end if;

    v_coupon_id := v_coupon.coupon_id;
    v_coupon_code_snap := v_coupon.code;
    v_coupon_type_snap := v_coupon.discount_type;
    v_coupon_value_snap := v_coupon.discount_value;
    v_discount := v_coupon.discount_cents;
    v_total := v_subtotal - v_discount;
  end if;

  -- 6.6 TASK-013 — frete: calculado DEPOIS do cupom, porque o mínimo do
  -- frete grátis compara o subtotal já descontado (produtos R$220 com
  -- cupom de R$30 valem R$190 para esta decisão, não R$220).
  --
  -- shipping_amount_cents nunca vem do cliente: mesmo que o navegador
  -- mande {"shipping_amount_cents": 1}, esta função nem lê esse campo —
  -- ele não é parâmetro. O valor sai de shipping_fee_for sobre a
  -- configuração vigente da loja.
  if v_structured_shipping then
    select f.rule, f.shipping_cents into v_fee
    from public.shipping_fee_for(
      v_settings.origin_city, v_settings.origin_state, v_ship_city, v_ship_state,
      v_settings.same_city_fee_cents, v_settings.same_state_fee_cents, v_settings.other_state_fee_cents,
      v_settings.additional_fee_cents, v_settings.free_shipping_enabled, v_settings.free_shipping_minimum_cents,
      v_total
    ) f;
    v_shipping_rule := v_fee.rule;
    v_shipping_cents := v_fee.shipping_cents;
    v_total := v_total + v_shipping_cents;
  end if;

  -- 6.7 TASK-013 — o total da tela tem que ser o total cobrado.
  --
  -- Entre a prévia e o envio, o lojista pode ter mudado a tabela de
  -- frete, o preço de um produto ou o cupom (TOCTOU real, não teórico).
  -- O pedido continua sendo criado com o valor RECALCULADO aqui — nunca
  -- com o que veio do cliente —, mas se esse valor não bate com o que o
  -- comprador tinha na tela, é melhor recusar e recotizar do que debitar
  -- em silêncio um valor que ele não viu.
  --
  -- Este parâmetro só aperta: mandar um total errado faz o pedido
  -- falhar, nunca ficar mais barato. Omiti-lo mantém o comportamento
  -- anterior (usado por retirada e pelas lojas sem frete).
  if p_expected_total_cents is not null and p_expected_total_cents <> v_total then
    raise exception 'total_changed' using errcode = '23514';
  end if;

  -- 7. cria pedido + itens + reduz estoque + auditoria
  v_public_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    store_id, public_code, idempotency_key, request_fingerprint,
    customer_name, customer_phone, fulfillment_method, delivery_address, customer_notes,
    status, subtotal_cents, discount_cents, shipping_amount_cents, total_cents,
    coupon_id, coupon_code_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot,
    shipping_rule, shipping_postal_code, shipping_street, shipping_number, shipping_complement,
    shipping_neighborhood, shipping_city, shipping_state,
    shipping_origin_postal_code, shipping_origin_city, shipping_origin_state
  ) values (
    v_store_id, v_public_code, p_idempotency_key, v_fingerprint,
    v_customer_name, v_customer_phone, p_fulfillment_method, v_delivery_address, v_customer_notes,
    'pending', v_subtotal, v_discount, v_shipping_cents, v_total,
    v_coupon_id, v_coupon_code_snap, v_coupon_type_snap, v_coupon_value_snap,
    v_shipping_rule,
    case when v_structured_shipping then v_ship_postal end,
    case when v_structured_shipping then v_ship_street end,
    case when v_structured_shipping then v_ship_number end,
    case when v_structured_shipping then v_ship_complement end,
    case when v_structured_shipping then v_ship_neighborhood end,
    case when v_structured_shipping then v_ship_city end,
    case when v_structured_shipping then v_ship_state end,
    case when v_structured_shipping then v_settings.origin_postal_code end,
    case when v_structured_shipping then v_settings.origin_city end,
    case when v_structured_shipping then v_settings.origin_state end
  )
  returning * into v_order;

  -- Reserva a utilizacao. unique(order_id) garante uma reserva por
  -- pedido mesmo sob retry.
  if v_coupon_id is not null then
    insert into public.coupon_redemptions (coupon_id, store_id, order_id, status, discount_cents)
    values (v_coupon_id, v_store_id, v_order.id, 'reserved', v_discount);
  end if;

  insert into public.order_items (
    order_id, store_id, product_id, product_name_snapshot, product_slug_snapshot,
    unit_price_cents, quantity, line_total_cents
  )
  select v_order.id, v_store_id, (li->>'product_id')::uuid, li->>'name', li->>'slug',
    (li->>'unit_price_cents')::int, (li->>'quantity')::int, (li->>'line_total_cents')::int
  from jsonb_array_elements(v_line_items) li;

  update public.products p
  set stock = p.stock - x.quantity, updated_at = now()
  from jsonb_to_recordset(v_items_normalized) as x(product_id uuid, quantity int)
  where p.id = x.product_id and p.stock >= x.quantity;
  get diagnostics v_stock_updated_count = row_count;
  if v_stock_updated_count <> v_found_count then
    raise exception 'stock_would_be_negative' using errcode = '23514';
  end if;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, 'order_created', 'order', v_order.id::text,
    jsonb_build_object('public_code', v_public_code, 'subtotal_cents', v_subtotal,
      'discount_cents', v_discount, 'shipping_cents', v_shipping_cents, 'shipping_rule', v_shipping_rule,
      'total_cents', v_total, 'item_count', v_found_count));

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, 'order_stock_reserved', 'order', v_order.id::text,
    jsonb_build_object('public_code', v_public_code, 'items', v_items_normalized));

  return v_order;
end;
$$;

comment on function public.create_order(text, uuid, text, text, text, text, text, jsonb, text, text, text, text, text, text, integer) is
  'Única forma de criar um pedido — checkout público, chamável por anon E authenticated. Nunca confia em preço, total, desconto ou FRETE vindo do cliente: preços são relidos de products, o desconto é recalculado por coupon_validate e o frete por shipping_fee_for sobre a configuração vigente da loja, tudo dentro da MESMA transação. TASK-013: nem o valor do frete nem a cidade/UF de destino são parâmetros — o valor sai da configuração da loja e o destino de shipping_resolve_destination sobre o CEP, resolvido pelo servidor; não existe payload capaz de escolher a faixa. O endereço estruturado só é exigido quando a loja tem entrega configurada, preservando o caminho de endereço livre das lojas que ainda não configuraram. p_expected_total_cents é uma trava opcional: total divergente recusa o pedido (total_changed), nunca o barateia. CEP e destino resolvido entram no fingerprint de idempotência — trocar o endereço sob a mesma key não devolve o pedido antigo com o frete antigo.';

revoke all on function public.create_order(text, uuid, text, text, text, text, text, jsonb, text, text, text, text, text, text, integer) from public;
grant execute on function public.create_order(text, uuid, text, text, text, text, text, jsonb, text, text, text, text, text, text, integer) to anon, authenticated;
