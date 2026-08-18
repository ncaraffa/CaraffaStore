#!/usr/bin/env bash
# TASK-012 commit 3 — Concorrência do ÚLTIMO assento de equipe.
#
# Cenário obrigatório: Crescimento em 2/3, DOIS convites diferentes
# aceitos ao mesmo tempo, por duas conexões independentes.
#
#   resultado exigido: 3/3
#   nunca:             4/3
#
# O que protege é o lock na linha do WORKSPACE dentro de
# workspace_accept_invitation — o lock no convite sozinho não bastaria,
# porque são convites (e linhas) diferentes.
#
# Uso: bash supabase/tests/seat-concurrency-check.sh
set -uo pipefail

CONTAINER="${PG_CONTAINER:-supabase_db_commerce-platform-local}"
PSQL="docker exec -i ${CONTAINER} psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -t -A"

echo "== preparando: workspace growth em 2/3 com dois convites pendentes =="
$PSQL <<'SQL'
drop table if exists public._seat_fixture;
create table public._seat_fixture (owner uuid, ws uuid, u1 uuid, u2 uuid, t1 text, t2 text);
do $$
declare
  v_owner uuid := gen_random_uuid(); v_ws uuid; v_store uuid;
  v_m1 uuid := gen_random_uuid(); v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid();
  v_t1 text := encode(digest('seat-race-1','sha256'),'hex');
  v_t2 text := encode(digest('seat-race-2','sha256'),'hex');
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','race-owner@seat.test','x',now(),now(),now()),
    (v_m1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','race-m1@seat.test','x',now(),now(),now()),
    (v_u1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','race-a@seat.test','x',now(),now(),now()),
    (v_u2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','race-b@seat.test','x',now(),now(),now());

  insert into public.workspaces (owner_user_id, name) values (v_owner,'WS race') returning id into v_ws;
  insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
    values (v_ws,'growth','active',now());
  insert into public.stores (slug, name, status, workspace_id)
    values ('loja-race','Loja race','active', v_ws) returning id into v_store;

  -- 2/3 ocupados: owner + um membro já dentro
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_owner, 'owner'), (v_ws, v_m1, 'member');
  perform public.workspace_sync_store_access(v_ws);

  -- dois convites PENDENTES para a última vaga. Inseridos direto para
  -- montar exatamente o cenário da corrida (a reserva de assento de
  -- workspace_invite_member impediria criar os dois pela RPC).
  insert into public.workspace_invitations (workspace_id, email, token_hash, invited_by, expires_at)
  values
    (v_ws,'race-a@seat.test', v_t1, v_owner, now() + interval '7 days'),
    (v_ws,'race-b@seat.test', v_t2, v_owner, now() + interval '7 days');

  insert into public._seat_fixture values (v_owner, v_ws, v_u1, v_u2, v_t1, v_t2);
end $$;
SQL

WS=$($PSQL -c "select ws from public._seat_fixture;")
U1=$($PSQL -c "select u1 from public._seat_fixture;")
U2=$($PSQL -c "select u2 from public._seat_fixture;")
T1=$($PSQL -c "select t1 from public._seat_fixture;")
T2=$($PSQL -c "select t2 from public._seat_fixture;")

echo "    assentos antes: $($PSQL -c "select public.workspace_seat_count('${WS}'::uuid);")/3"

accept() {
  local tag="$1" uid="$2" tok="$3"
  $PSQL <<SQL 2>&1 | sed "s/^/${tag}: /"
select set_config('request.jwt.claims', json_build_object('sub','${uid}')::text, false);
select public.workspace_accept_invitation('${tok}') is not null as joined;
SQL
}

echo "== A e B aceitam SIMULTANEAMENTE a última vaga =="
accept A "$U1" "$T1" > /tmp/seat_a.log 2>&1 &
PID_A=$!
accept B "$U2" "$T2" > /tmp/seat_b.log 2>&1 &
PID_B=$!
wait $PID_A; wait $PID_B

cat /tmp/seat_a.log /tmp/seat_b.log

FINAL=$($PSQL -c "select public.workspace_seat_count('${WS}'::uuid);")
JOINED=$(cat /tmp/seat_a.log /tmp/seat_b.log | grep -cE "^[AB]: t$" || true)
REJECTED=$(cat /tmp/seat_a.log /tmp/seat_b.log | grep -c "max_team_members_reached" || true)

echo "== resultado =="
echo "assentos finais: ${FINAL}/3"
echo "aceitos: ${JOINED} · recusados por max_team_members_reached: ${REJECTED}"

$PSQL -c "drop table if exists public._seat_fixture;" >/dev/null

if [ "${FINAL}" != "3" ]; then
  echo "FAIL: terminou em ${FINAL}/3 (o limite do plano foi estourado)"
  exit 1
fi
if [ "${JOINED}" != "1" ] || [ "${REJECTED}" != "1" ]; then
  echo "FAIL: esperava exatamente 1 aceito e 1 recusado (got ${JOINED}/${REJECTED})"
  exit 1
fi
echo "PASS - 2/3 + dois aceites simultaneos = 3/3, nunca 4/3"
