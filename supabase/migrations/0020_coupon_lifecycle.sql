-- TASK-012 commit 4 (parte 2) â€” Ciclo de vida do resgate ligado ao pedido.
--
-- ONDE consumed/released ACONTECEM
--
-- As trÃªs rotas que encerram um pedido â€” pagamento aprovado, pagamento
-- que falhou/expirou, e cancelamento administrativo â€” jÃ¡ convergem para
-- a MESMA coisa: orders.status muda. Em vez de reescrever
-- pix_payment_apply_provider_state, pix_payment_mark_creation_failed e
-- order_cancel (trÃªs funÃ§Ãµes grandes, trÃªs chances de divergir), o
-- resgate segue o status do pedido por trigger.
--
-- Isso torna a regra de negÃ³cio literal: "o cupom Ã© consumido quando o
-- pedido Ã© confirmado e liberado quando o pedido Ã© cancelado".
--
-- IDEMPOTÃŠNCIA
--
-- Duplo-webhook e webhook+reconciliaÃ§Ã£o concorrentes nÃ£o consomem duas
-- vezes por dois motivos somados:
--   1. as funÃ§Ãµes de pagamento jÃ¡ tratam estado terminal como no-op, entÃ£o
--      o status do pedido sÃ³ transiciona uma vez;
--   2. mesmo que a trigger dispare de novo, o UPDATE Ã© condicionado ao
--      estado ATUAL do resgate (reserved -> consumed), entÃ£o repetir nÃ£o
--      tem efeito. released -> released tambÃ©m Ã© inerte.

-- ============================================================
-- 1. audit_log_action_check â€” sÃ³ ALARGA
-- ============================================================

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
  -- TASK-012 commit 4 â€” cupons
  'coupon_created', 'coupon_updated', 'coupon_disabled',
  'coupon_reserved', 'coupon_consumed', 'coupon_released'
));

-- ============================================================
-- 2. Trigger: o resgate segue o status do pedido
-- ============================================================

create or replace function public.coupon_sync_redemption_with_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Pagamento aprovado / pedido confirmado -> consome definitivamente.
  if new.status in ('confirmed', 'preparing', 'ready', 'completed') then
    update public.coupon_redemptions
      set status = 'consumed', consumed_at = now()
      where order_id = new.id and status = 'reserved';

    if found then
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, new.store_id, 'coupon_consumed', 'order', new.id::text,
        jsonb_build_object('public_code', new.public_code, 'discount_cents', new.discount_cents));
    end if;

  -- Pedido cancelado antes do pagamento -> devolve a vaga.
  --
  -- SÃ³ libera o que ainda estÃ¡ `reserved`. Um resgate jÃ¡ `consumed`
  -- (pedido pago e depois cancelado) NÃƒO volta para a praÃ§a: o cupom foi
  -- efetivamente usado numa venda concluÃ­da, e devolver a vaga seria
  -- reabrir uma promoÃ§Ã£o jÃ¡ paga. Estorno Ã© assunto financeiro, fora
  -- desta task.
  elsif new.status = 'cancelled' then
    update public.coupon_redemptions
      set status = 'released', released_at = now()
      where order_id = new.id and status = 'reserved';

    if found then
      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      values (null, new.store_id, 'coupon_released', 'order', new.id::text,
        jsonb_build_object('public_code', new.public_code));
    end if;
  end if;

  return new;
end;
$fn$;

comment on function public.coupon_sync_redemption_with_order() is
  'Liga o ciclo do resgate ao status do pedido: confirmado -> consumed, cancelado -> released. Cobre de uma vez as trÃªs rotas que encerram um pedido (webhook aprovado, falha/expiraÃ§Ã£o do pagamento, cancelamento administrativo) sem duplicar a regra em cada uma. Idempotente: o UPDATE Ã© condicionado a status=reserved, entÃ£o replay de webhook ou reconciliaÃ§Ã£o concorrente nÃ£o consome nem libera duas vezes. Resgate jÃ¡ consumed nunca volta a reserved.';

create trigger coupon_redemption_follows_order
  after update of status on public.orders
  for each row
  execute function public.coupon_sync_redemption_with_order();

-- ============================================================
-- 3. create_order aceita cupom e RESERVA na mesma transaÃ§Ã£o
-- ============================================================
--
-- Corpo derivado do de 0006; as mudanÃ§as estÃ£o marcadas com TASK-012:
-- parÃ¢metro p_coupon_code, cupom no fingerprint de idempotÃªncia, bloco
-- 6.5 (validaÃ§Ã£o + lock + reserva) e o snapshot financeiro no INSERT.
-- Todo o resto â€” releitura de preÃ§os do banco, lock de produtos em
-- ORDER BY id, baixa de estoque, auditoria â€” Ã© preservado.
--
-- DROP explÃ­cito: o parÃ¢metro novo criaria uma SOBRECARGA em vez de
-- substituir, e a chamada de 8 argumentos ficaria presa na versÃ£o antiga
-- (sem cupom). Mesma liÃ§Ã£o de 0010/0011/0013.
drop function if exists public.create_order(text, uuid, text, text, text, text, text, jsonb);

create or replace function public.create_order(
  p_store_slug text,
  p_idempotency_key uuid,
  p_customer_name text,
  p_customer_phone text,
  p_fulfillment_method text,
  p_delivery_address text,
  p_customer_notes text,
  p_items jsonb,
  p_coupon_code text default null
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
  -- Achado pelo teste do caso sem cupom.
  v_coupon_id uuid;
  v_coupon_code_snap text;
  v_coupon_type_snap text;
  v_coupon_value_snap integer;
  v_discount integer := 0;
  v_total integer;
  v_coupon_code text := nullif(trim(coalesce(p_coupon_code, '')), '');
  v_max_uses integer;
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

  -- 4. idempotÃªncia: fingerprint determinÃ­stico do conteÃºdo (nunca do preÃ§o,
  -- que Ã© recalculado do banco a cada tentativa) + advisory lock por
  -- (store_id, idempotency_key) â€” serializa duas chamadas concorrentes com
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
    coalesce(public.coupon_normalize_code(v_coupon_code), '')
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
  -- concorrentes) e valida loja/status/estoque com o preÃ§o lido agora.
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

  -- 6.5 TASK-012 â€” cupom: valida com o subtotal JA recalculado do banco
  -- (nunca o que o navegador disse) e reserva a utilizacao.
  --
  -- A reserva acontece AQUI, dentro da mesma transacao que cria o pedido
  -- e baixa o estoque. E o que impede dois checkouts simultaneos de
  -- levarem a mesma ultima vaga: o `for update` na linha do cupom
  -- serializa os dois, e o segundo rele a contagem ja com a reserva do
  -- primeiro visivel.
  --
  -- Nenhuma chamada de rede acontece dentro desta transacao â€” o Mercado
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

  -- 7. cria pedido + itens + reduz estoque + auditoria
  v_public_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    store_id, public_code, idempotency_key, request_fingerprint,
    customer_name, customer_phone, fulfillment_method, delivery_address, customer_notes,
    status, subtotal_cents, discount_cents, total_cents,
    coupon_id, coupon_code_snapshot, coupon_discount_type_snapshot, coupon_discount_value_snapshot
  ) values (
    v_store_id, v_public_code, p_idempotency_key, v_fingerprint,
    v_customer_name, v_customer_phone, p_fulfillment_method, v_delivery_address, v_customer_notes,
    'pending', v_subtotal, v_discount, v_total,
    v_coupon_id, v_coupon_code_snap, v_coupon_type_snap, v_coupon_value_snap
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
      'discount_cents', v_discount, 'total_cents', v_total, 'item_count', v_found_count));

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, 'order_stock_reserved', 'order', v_order.id::text,
    jsonb_build_object('public_code', v_public_code, 'items', v_items_normalized));

  return v_order;
end;
$$;


comment on function public.create_order(text, uuid, text, text, text, text, text, jsonb, text) is
  'Ãšnica forma de criar um pedido â€” checkout pÃºblico, chamÃ¡vel por anon E authenticated. Nunca confia em preÃ§o, total ou desconto vindo do cliente: preÃ§os sÃ£o relidos de products e o desconto Ã© recalculado por coupon_validate dentro da MESMA transaÃ§Ã£o. TASK-012: reserva a utilizaÃ§Ã£o do cupom aqui, com a linha do cupom travada, de modo que dois checkouts simultÃ¢neos nÃ£o levem a mesma Ãºltima vaga; a chamada ao Mercado Pago acontece depois, fora da transaÃ§Ã£o. O cupom entra no fingerprint de idempotÃªncia â€” reenviar o mesmo carrinho com outro cupom nÃ£o devolve o pedido antigo.';

revoke all on function public.create_order(text, uuid, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.create_order(text, uuid, text, text, text, text, text, jsonb, text) to anon, authenticated;
