#!/usr/bin/env bash
# TASK-012 commit 2 — Concorrência da ÚLTIMA vaga de imagem.
#
# O teste de quota (quota_enforcement_check.sql) roda numa sessão só e
# por isso nunca exercita a corrida real. Aqui duas CONEXÕES independentes
# disputam a última vaga do produto — o mesmo motivo pelo qual a
# concorrência de estoque vive em stock-concurrency-check.ts e não no
# arquivo de SAVEPOINTs.
#
# Cenário: plano growth (5 imagens), produto já com 4. A e B tentam
# inserir a 5a e a 6a ao mesmo tempo. Exatamente uma deve vencer.
#
# Uso: bash supabase/tests/image-quota-concurrency-check.sh
set -uo pipefail

CONTAINER="${PG_CONTAINER:-supabase_db_commerce-platform-local}"
PSQL="docker exec -i ${CONTAINER} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -t -A"

echo "== preparando fixture (workspace growth, produto com 4/5 imagens) =="
$PSQL <<'SQL'
drop table if exists public._conc_fixture;
create table public._conc_fixture (uid uuid, ws uuid, store uuid, product uuid);
do $$
declare v_uid uuid := gen_random_uuid(); v_ws uuid; v_store uuid; v_prod uuid; i integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'conc-' || v_uid || '@quota.test','x',now(),now(),now());
  insert into public.workspaces (owner_user_id, name) values (v_uid,'WS conc') returning id into v_ws;
  insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
    values (v_ws,'growth','active',now());
  insert into public.stores (slug, name, status, workspace_id)
    values ('loja-conc-' || substr(v_uid::text,1,8), 'Loja conc','active', v_ws) returning id into v_store;
  insert into public.store_members (store_id, user_id, role) values (v_store, v_uid, 'owner');
  insert into public.products (store_id, name, slug, price_cents, stock, status)
    values (v_store,'conc','conc',100,1,'draft') returning id into v_prod;
  for i in 1..4 loop
    insert into public.product_images (store_id, product_id, storage_path, position, is_cover)
      values (v_store, v_prod, v_store::text || '/' || v_prod::text || '/' || i || '.jpg', i, i = 1);
  end loop;
  insert into public._conc_fixture values (v_uid, v_ws, v_store, v_prod);
end $$;
SQL

UID_=$($PSQL -c "select uid from public._conc_fixture;")
STORE=$($PSQL -c "select store from public._conc_fixture;")
PROD=$($PSQL -c "select product from public._conc_fixture;")

run_attempt() {
  local tag="$1"
  $PSQL <<SQL 2>&1 | sed "s/^/${tag}: /"
select set_config('request.jwt.claims', json_build_object('sub','${UID_}')::text, false);
select public.catalog_add_product_image('${PROD}'::uuid, '${STORE}/${PROD}/${tag}.jpg') is not null as inserted;
SQL
}

echo "== disparando A e B simultaneamente na ULTIMA vaga =="
run_attempt A > /tmp/conc_a.log 2>&1 &
PID_A=$!
run_attempt B > /tmp/conc_b.log 2>&1 &
PID_B=$!
wait $PID_A; wait $PID_B

cat /tmp/conc_a.log /tmp/conc_b.log

FINAL=$($PSQL -c "select count(*) from public.product_images where product_id = '${PROD}';")
WINNERS=$(cat /tmp/conc_a.log /tmp/conc_b.log | grep -cE "^[AB]: t$" || true)
REJECTED=$(cat /tmp/conc_a.log /tmp/conc_b.log | grep -c "max_images_reached" || true)

echo "== resultado =="
echo "imagens finais: ${FINAL} (limite growth = 5)"
echo "aceitas: ${WINNERS} · recusadas por max_images_reached: ${REJECTED}"

$PSQL -c "drop table if exists public._conc_fixture;" >/dev/null

if [ "${FINAL}" != "5" ]; then
  echo "FAIL: o produto terminou com ${FINAL} imagens (esperado exatamente 5)"
  exit 1
fi
if [ "${REJECTED}" != "1" ]; then
  echo "FAIL: esperava exatamente 1 recusa por max_images_reached, houve ${REJECTED}"
  exit 1
fi
if [ "${WINNERS}" != "1" ]; then
  echo "FAIL: esperava exatamente 1 insercao aceita, houve ${WINNERS}"
  exit 1
fi
echo "PASS - a ultima vaga foi de UM so; a outra tentativa recebeu max_images_reached"
