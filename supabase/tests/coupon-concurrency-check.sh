#!/usr/bin/env bash
# TASK-012 commit 4 — Concorrência da ÚLTIMA utilização do cupom.
#
# Cenário obrigatório:
#
#   max_uses = 100, já usados 99
#   checkout A e checkout B simultâneos, em conexões independentes
#
#   -> exatamente UM reserva
#   -> o outro recebe coupon_usage_limit_reached
#   -> reserved + consumed <= max_uses, SEMPRE
#
# O teste em transação única (coupons_check.sql) não exercita a corrida:
# só duas conexões reais disputando o mesmo `for update` provam isso.
#
# Uso: bash supabase/tests/coupon-concurrency-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

CONTAINER="${PG_CONTAINER:-supabase_db_commerce-platform-local}"
PSQL="docker exec -i ${CONTAINER} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -t -A"

echo "== fixture: cupom com 99/100 usos, loja Growth com estoque folgado =="
$PSQL <<'SQL'
drop table if exists public._coup_fixture;
create table public._coup_fixture (store uuid, product uuid, coupon uuid, slug text);
do $$
declare
  v_uid uuid := gen_random_uuid(); v_ws uuid; v_store uuid; v_prod uuid; v_coupon uuid;
  v_order uuid; i integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'coupconc-' || v_uid || '@test.local','x',now(),now(),now());
  insert into public.workspaces (owner_user_id, name) values (v_uid,'WS coupconc') returning id into v_ws;
  insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
    values (v_ws,'growth','active',now());
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');
  insert into public.stores (slug, name, status, workspace_id)
    values ('coupconc-' || substr(v_uid::text,1,8), 'Loja coupconc','active', v_ws) returning id into v_store;
  insert into public.store_members (store_id, user_id, role) values (v_store, v_uid, 'owner');
  insert into public.products (store_id, name, slug, price_cents, stock, status)
    values (v_store,'Produto','produto',10000,5000,'published') returning id into v_prod;

  insert into public.coupons (store_id, code, normalized_code, discount_type, discount_value, max_uses)
    values (v_store,'ULTIMA','ULTIMA','percentage',1000,100) returning id into v_coupon;

  -- 99 resgates já consumidos: sobra exatamente UMA vaga.
  for i in 1..99 loop
    insert into public.orders (
      store_id, public_code, idempotency_key, request_fingerprint,
      customer_name, customer_phone, fulfillment_method,
      status, subtotal_cents, discount_cents, total_cents
    ) values (
      v_store, 'SEED' || lpad(i::text,4,'0'), gen_random_uuid(), 'seed' || i,
      'Seed','11999990000','pickup','confirmed', 10000, 1000, 9000
    ) returning id into v_order;
    insert into public.coupon_redemptions (coupon_id, store_id, order_id, status, discount_cents)
      values (v_coupon, v_store, v_order, 'consumed', 1000);
  end loop;

  insert into public._coup_fixture
    select v_store, v_prod, v_coupon, slug from public.stores where id = v_store;
end $$;
SQL

STORE_SLUG=$($PSQL -c "select slug from public._coup_fixture;")
PROD=$($PSQL -c "select product from public._coup_fixture;")
COUPON=$($PSQL -c "select coupon from public._coup_fixture;")
echo "    usos antes: $($PSQL -c "select public.coupon_used_count('${COUPON}'::uuid);")/100"

attempt() { # attempt <tag>
  local tag="$1"
  $PSQL <<SQL 2>&1 | sed "s/^/${tag}: /"
-- (composite).id, nao "composite is not null": em Postgres um registro
-- so e IS NOT NULL quando TODOS os campos sao nao-nulos, e um pedido tem
-- campos opcionais nulos (delivery_address, cancelled_at...).
select (public.create_order(
  '${STORE_SLUG}', gen_random_uuid(), 'Cliente ${tag}', '1199999${RANDOM:0:4}', 'pickup', null, null,
  jsonb_build_array(jsonb_build_object('product_id', '${PROD}', 'quantity', 1)),
  'ULTIMA')).id is not null as created;
SQL
}

echo "== A e B disputam a ULTIMA vaga simultaneamente =="
attempt A > /tmp/coup_a.log 2>&1 &
PID_A=$!
attempt B > /tmp/coup_b.log 2>&1 &
PID_B=$!
wait $PID_A; wait $PID_B

cat /tmp/coup_a.log /tmp/coup_b.log

FINAL=$($PSQL -c "select public.coupon_used_count('${COUPON}'::uuid);")
WON=$(cat /tmp/coup_a.log /tmp/coup_b.log | grep -cE "^[AB]: t$" || true)
REJECTED=$(cat /tmp/coup_a.log /tmp/coup_b.log | grep -c "coupon_usage_limit_reached" || true)

echo "== resultado =="
echo "usos finais: ${FINAL}/100"
echo "aceitos: ${WON} · recusados por coupon_usage_limit_reached: ${REJECTED}"

$PSQL -c "drop table if exists public._coup_fixture;" >/dev/null

if [ "${FINAL}" != "100" ]; then
  echo "FAIL: terminou em ${FINAL}/100 (limite estourado ou vaga perdida)"
  exit 1
fi
if [ "${WON}" != "1" ] || [ "${REJECTED}" != "1" ]; then
  echo "FAIL: esperava exatamente 1 aceito e 1 recusado (got ${WON}/${REJECTED})"
  exit 1
fi
echo "PASS - 99/100 + dois checkouts simultaneos = 100/100, nunca 101"
