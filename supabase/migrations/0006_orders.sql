-- TASK-004 — Carrinho, checkout sem pagamento e gestão de pedidos.
--
-- Decisões aprovadas por Caraffa (2026-08-04, sem necessidade de nova
-- aprovação): checkout público sem login de cliente; carrinho vive só no
-- navegador (localStorage), tudo revalidado no servidor; pedido criado
-- como `pending`, sem Pix/pagamento nesta tarefa; estoque reservado e
-- reduzido atomicamente na criação do pedido, devolvido exatamente uma
-- vez no cancelamento; sem variantes (cada item referencia um produto
-- simples da TASK-003).
--
-- Mesmo padrão de autorização operacional da TASK-003
-- (can_manage_store_catalog, 0005_catalog.sql): funções SECURITY
-- DEFINER dedicadas, cada uma reautoriza via auth.uid() no próprio
-- banco, nunca confia em store_id/role vindo do cliente, e grava o
-- evento de auditoria correspondente na MESMA transação da escrita.
--
-- `create_order` é a única função desta migração chamável por `anon`
-- (checkout público sem login) — todas as outras (avançar status,
-- cancelar, listar) exigem `authenticated` com vínculo administrativo na
-- loja.

-- ============================================================
-- 0. Autorização operacional de pedidos
-- ============================================================

-- Leitura (painel): qualquer membro da loja (owner/admin/staff), desde
-- que a loja esteja active — diferente do catálogo (products_select_member
-- não exige loja active, pois ver o próprio catálogo nunca foi
-- considerado sensível), pedidos contêm dados pessoais de clientes e a
-- própria tarefa exige explicitamente que lojas pending_payment/suspended
-- não consigam "listar nem administrar pedidos por URL, Server Action ou
-- RPC direta" — então a LEITURA também exige loja active aqui.
create or replace function public.can_view_store_orders(target_store_id uuid)
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
      and s.status = 'active'
  );
$$;

comment on function public.can_view_store_orders(uuid) is
  'Leitura de pedidos: qualquer membro (owner/admin/staff) da loja E loja status=active. Pedidos carregam dados pessoais de clientes — diferente do catálogo, a própria leitura exige loja active (fecha o mesmo tipo de bypass de BUG-CLAUDE-003-001, aplicado aqui também à leitura, não só à escrita).';

-- Escrita/gestão (avançar status, cancelar): só owner/admin, loja active
-- — mesmo desenho de can_manage_store_catalog (0005_catalog.sql), mas
-- como função própria (nome explícito can_manage_store_orders), sem
-- reaproveitar a de catálogo — mantém cada tarefa com sua autorização
-- operacional isolada e nomeada pelo próprio domínio.
create or replace function public.can_manage_store_orders(target_store_id uuid)
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

comment on function public.can_manage_store_orders(uuid) is
  'Autorização operacional de pedidos: owner/admin da loja E loja status=active. Usada por order_advance_status/order_cancel. Staff nunca recebe escrita administrativa aqui (só leitura, via can_view_store_orders).';

revoke all on function public.can_view_store_orders(uuid) from public;
revoke all on function public.can_manage_store_orders(uuid) from public;
grant execute on function public.can_view_store_orders(uuid) to authenticated;
grant execute on function public.can_manage_store_orders(uuid) to authenticated;

-- ============================================================
-- 1. orders
-- ============================================================

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  public_code text not null,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  customer_name text not null,
  customer_phone text not null,
  fulfillment_method text not null check (fulfillment_method in ('pickup', 'delivery')),
  delivery_address text,
  customer_notes text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled')),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  constraint orders_store_idempotency_unique unique (store_id, idempotency_key),
  constraint orders_store_public_code_unique unique (store_id, public_code),
  constraint orders_delivery_address_required check (
    fulfillment_method <> 'delivery' or (delivery_address is not null and length(trim(delivery_address)) > 0)
  )
);

comment on table public.orders is
  'Pedido criado publicamente (checkout sem login, TASK-004) ou administrado pelo painel. store_id ON DELETE RESTRICT (registro de negócio histórico, mesma classe de audit_log — nunca some junto com a loja). Toda mutação exclusivamente via create_order/order_advance_status/order_cancel (SECURITY DEFINER) — authenticated/anon não têm nenhum GRANT de INSERT/UPDATE/DELETE direto (ver seção de privilégios abaixo).';

comment on column public.orders.idempotency_key is
  'Gerado pelo navegador (crypto.randomUUID()) uma vez por tentativa real de checkout. UNIQUE(store_id, idempotency_key) + request_fingerprint (ver create_order) garantem que reenvio (duplo clique/refresh/retry) nunca cria pedido nem baixa estoque duas vezes — e que a MESMA key com conteúdo diferente é rejeitada, nunca reaproveitada para alterar um pedido existente.';

comment on column public.orders.public_code is
  'Código curto exposto ao cliente (URL de sucesso, sem autenticação) — nunca o id UUID interno. Não carrega nenhuma informação sensível por si só (a página de sucesso não faz nenhuma consulta ao banco, só exibe o código recebido na resposta da criação).';

create index orders_store_status_idx on public.orders (store_id, status);
create index orders_store_created_at_idx on public.orders (store_id, created_at desc);

alter table public.orders enable row level security;

create policy orders_select_member
  on public.orders
  for select
  to authenticated
  using (public.can_view_store_orders(store_id));

revoke all on public.orders from public, anon, authenticated, service_role;
grant select on public.orders to authenticated;
grant select, insert, update, delete on public.orders to service_role;

-- ============================================================
-- 2. order_items
-- ============================================================

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  product_name_snapshot text not null,
  product_slug_snapshot text,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity > 0 and quantity <= 999),
  line_total_cents integer not null check (line_total_cents >= 0),
  created_at timestamptz not null default now()
);

comment on table public.order_items is
  'Snapshot imutável do item no momento do pedido (nome/slug/preço) — nunca lido do produto atual, preserva o pedido mesmo que o produto seja depois renomeado/despublicado/arquivado/tenha o preço alterado. product_id ON DELETE RESTRICT: não há caminho de exclusão física de produtos neste projeto (TASK-003 só permite arquivar), então isso nunca bloqueia nada na prática — é defesa em profundidade, não uma restrição ativa.';

create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

alter table public.order_items enable row level security;

create policy order_items_select_member
  on public.order_items
  for select
  to authenticated
  using (public.can_view_store_orders(store_id));

revoke all on public.order_items from public, anon, authenticated, service_role;
grant select on public.order_items to authenticated;
grant select, insert, update, delete on public.order_items to service_role;

comment on table public.order_items is
  'order_items nunca é público — sem GRANT nem policy `to public`/`to anon` em nenhuma tabela desta migração (diferente do catálogo): dados pessoais do cliente (no pedido pai) nunca podem vazar via um join administrativo mal escrito, e nem por isso um SELECT direto exporia algo, já que não há linha visível para anon em nenhuma hipótese.';

-- ============================================================
-- 3. create_order — criação atômica, idempotente, pública (anon)
-- ============================================================
--
-- Ordem de operações (todas na MESMA transação — qualquer falha desfaz
-- tudo: nenhum pedido, nenhum item, nenhum estoque alterado, nenhuma
-- auditoria falsa):
--   1. resolve loja pelo slug, exige status active;
--   2. valida campos do cliente (nome/telefone/modalidade/endereço/obs);
--   3. valida/consolida itens do carrinho (soma quantidades duplicadas,
--      rejeita vazio, rejeita item malformado);
--   4. calcula fingerprint determinístico do pedido (conteúdo, não preço)
--      e serializa por (store_id, idempotency_key) via advisory lock —
--      reenvio com a MESMA key e MESMO conteúdo retorna o pedido já
--      criado (idempotente); MESMA key com conteúdo diferente é rejeitada;
--   5. bloqueia as linhas dos produtos envolvidos em ORDER BY id (evita
--      deadlock entre pedidos concorrentes com produtos em comum, mesmo
--      em ordens diferentes no carrinho de cada cliente);
--   6. valida cada produto: existe, pertence à loja, está published,
--      tem estoque suficiente — preço sempre lido do banco nesse mesmo
--      instante, nunca do cliente;
--   7. cria o pedido (subtotal/total calculados no banco) + os
--      order_items (snapshots) + reduz o estoque (compare-and-swap,
--      mesmo padrão de catalog_adjust_stock) + grava auditoria real.
create or replace function public.create_order(
  p_store_slug text,
  p_idempotency_key uuid,
  p_customer_name text,
  p_customer_phone text,
  p_fulfillment_method text,
  p_delivery_address text,
  p_customer_notes text,
  p_items jsonb
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
begin
  -- 1. loja
  select id, status into v_store_id, v_store_status from public.stores where slug = p_store_slug;
  if v_store_id is null then
    raise exception 'store_not_found' using errcode = '02000';
  end if;
  if v_store_status <> 'active' then
    raise exception 'store_not_active' using errcode = '42501';
  end if;

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
  if p_fulfillment_method = 'delivery' and (v_delivery_address is null or char_length(v_delivery_address) = 0) then
    raise exception 'delivery_address_required' using errcode = '22023';
  end if;
  if v_delivery_address is not null and char_length(v_delivery_address) > 500 then
    raise exception 'invalid_delivery_address' using errcode = '22023';
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
    ), '')
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

  -- 7. cria pedido + itens + reduz estoque + auditoria
  v_public_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    store_id, public_code, idempotency_key, request_fingerprint,
    customer_name, customer_phone, fulfillment_method, delivery_address, customer_notes,
    status, subtotal_cents, total_cents
  ) values (
    v_store_id, v_public_code, p_idempotency_key, v_fingerprint,
    v_customer_name, v_customer_phone, p_fulfillment_method, v_delivery_address, v_customer_notes,
    'pending', v_subtotal, v_subtotal
  )
  returning * into v_order;

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
    jsonb_build_object('public_code', v_public_code, 'total_cents', v_subtotal, 'item_count', v_found_count));

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, 'order_stock_reserved', 'order', v_order.id::text,
    jsonb_build_object('public_code', v_public_code, 'items', v_items_normalized));

  return v_order;
end;
$$;

comment on function public.create_order(text, uuid, text, text, text, text, text, jsonb) is
  'Única forma de criar um pedido — checkout público, chamável por anon E authenticated. Nunca confia em preço/nome/total vindo do cliente (sempre relidos de products dentro da mesma transação); bloqueia produtos em ORDER BY id (evita deadlock); idempotente via advisory lock + fingerprint em (store_id, idempotency_key) — reenvio idêntico retorna o mesmo pedido, reenvio com conteúdo diferente sob a mesma key é rejeitado (idempotency_conflict).';

revoke all on function public.create_order(text, uuid, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_order(text, uuid, text, text, text, text, text, jsonb) to anon, authenticated;

-- ============================================================
-- 4. order_advance_status — transições de status (painel)
-- ============================================================

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
    when 'pending' then p_new_status = 'confirmed'
    when 'confirmed' then p_new_status = 'preparing'
    when 'preparing' then p_new_status = 'ready'
    when 'ready' then p_new_status = 'completed'
    else false
  end;
  if not v_allowed then
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
  'Única forma de avançar o status de um pedido além de pending. Máquina de estados linear (pending->confirmed->preparing->ready->completed) — nunca aceita retroceder, pular etapa, reabrir completed/cancelled, nem concluir diretamente um pending. Cancelamento é sempre via order_cancel, nunca por aqui.';

revoke all on function public.order_advance_status(uuid, text) from public;
grant execute on function public.order_advance_status(uuid, text) to authenticated;

-- ============================================================
-- 5. order_cancel — cancelamento atômico + devolução de estoque
-- ============================================================

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
  -- Trava a linha do PEDIDO primeiro: duas chamadas concorrentes de
  -- cancelamento do MESMO pedido serializam aqui — a segunda só
  -- prossegue depois que a primeira confirma (status já 'cancelled') ou
  -- desfaz, nunca as duas devolvem estoque.
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

  update public.orders
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = p_order_id
  returning * into v_order;

  -- Trava os produtos envolvidos em ORDER BY id antes de devolver o
  -- estoque — mesma técnica de create_order, evita deadlock com pedidos
  -- concorrentes que compartilhem produtos.
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
  'Único caminho de cancelamento. completed/cancelled são terminais (nunca reabertos). Devolve a quantidade de cada item exatamente uma vez — o lock em orders (for update) garante isso mesmo sob duas chamadas concorrentes reais.';

revoke all on function public.order_cancel(uuid) from public;
grant execute on function public.order_cancel(uuid) to authenticated;

-- ============================================================
-- 6. audit_log_action_check — só ALARGA (nunca estreita, mesma regra de
--    todas as migrations anteriores — ver 0004_account_audit.sql)
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
    'order_stock_restored'
  ));

comment on constraint audit_log_action_check on public.audit_log is
  'Conjunto de actions só CRESCE entre migrations (nunca estreitar — bloqueador histórico BUG-RT2-006, qa/reports/TASK-002-RETEST.md). TASK-004 adiciona os 5 eventos de pedido — todos os valores anteriores permanecem intactos.';
