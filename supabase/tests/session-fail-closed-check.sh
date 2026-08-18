#!/usr/bin/env bash
# TASK-012 — Gate final da camada de sessão: FAIL-CLOSED.
#
# O teste definitivo:
#
#   JWT do Supabase válido + membership válida + NENHUMA app_session
#   registrada  ->  o banco tem que responder NÃO.
#
# Este arquivo nunca chama requireStoreStatus nem app_session_start: o
# JWT é obtido direto do GoTrue e usado direto no PostgREST, exatamente
# como faria um cliente customizado que ignora o frontend.
#
# Uso: bash supabase/tests/session-fail-closed-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

SUPABASE_URL="http://127.0.0.1:54321"
APIKEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2)
PSQL="docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -q -t -A"
PASS=0
FAILED=0

ok()  { echo "PASS - $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL - $1"; FAILED=$((FAILED+1)); }

rpc() { curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/$2" \
  -H "apikey: ${APIKEY}" -H "Authorization: Bearer $1" \
  -H "Content-Type: application/json" -d "$3"; }

login() { curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${APIKEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Str0ng!Passw0rd#2026\"}"; }

access_of() { python -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))"; }
refresh_of() { python -c "import sys,json;print(json.load(sys.stdin).get('refresh_token',''))"; }
claim_of() { python -c "
import sys,base64,json
t=sys.stdin.read().strip(); p=t.split('.')[1]; p+='='*(-len(p)%4)
print(json.loads(base64.urlsafe_b64decode(p)).get('$1',''))"; }

# Uma operação de cada família administrativa. Todas têm que recusar.
probe_all() { # probe_all <token> <rotulo> <esperado: reject|allow>
  local tok="$1" label="$2" expect="$3" rejected=0 allowed=0 out
  for spec in \
    "catalog_create_product|{\"p_store_id\":\"${STORE}\",\"p_name\":\"X\",\"p_slug\":\"x-$RANDOM\",\"p_price_cents\":100,\"p_stock\":1}" \
    "catalog_adjust_stock|{\"p_product_id\":\"${PROD}\",\"p_delta\":1,\"p_reason\":\"probe\"}" \
    "workspace_create_store|{\"p_name\":\"Loja X\",\"p_slug\":\"loja-x-$RANDOM\"}" \
    "workspace_invite_member|{\"p_email\":\"x$RANDOM@probe.test\",\"p_token_hash\":\"$(printf 'a%.0s' $(seq 64))\"}" \
    "workspace_team|{\"p_store_id\":\"${STORE}\"}" \
    "billing_get_subscription|{\"p_store_id\":\"${STORE}\"}" \
    "store_quota_usage|{\"p_store_id\":\"${STORE}\"}" ; do
    out=$(rpc "$tok" "${spec%%|*}" "${spec#*|}")
    if echo "$out" | grep -qi "insufficient_privilege\|permission denied"; then
      rejected=$((rejected+1))
    else
      allowed=$((allowed+1))
      echo "      [PASSOU] ${spec%%|*} -> $(echo "$out" | head -c 110)"
    fi
  done
  echo "   ${label}: ${rejected} recusadas / ${allowed} permitidas"
  if [ "$expect" = "reject" ]; then
    [ "$allowed" = "0" ] && ok "$label — todas recusadas" || bad "$label — ${allowed} operacao(oes) passaram"
  else
    [ "$rejected" = "0" ] && ok "$label — todas permitidas" || bad "$label — ${rejected} recusadas indevidamente"
  fi
}

# Operações que um MEMBER legitimamente executa. Convidar e criar loja
# são exclusivas do owner, então recusá-las para um membro é o
# comportamento correto e não pode contar como falha de sessão.
probe_member() { # probe_member <token> <rotulo> <esperado>
  local tok="$1" label="$2" expect="$3" rejected=0 allowed=0 out
  for spec in     "catalog_create_product|{\"p_store_id\":\"${STORE}\",\"p_name\":\"M$RANDOM\",\"p_slug\":\"m-$RANDOM\",\"p_price_cents\":100,\"p_stock\":1}"     "workspace_team|{\"p_store_id\":\"${STORE}\"}"     "store_quota_usage|{\"p_store_id\":\"${STORE}\"}" ; do
    out=$(rpc "$tok" "${spec%%|*}" "${spec#*|}")
    if echo "$out" | grep -qi "insufficient_privilege\|permission denied"; then
      rejected=$((rejected+1))
    else
      allowed=$((allowed+1))
    fi
  done
  echo "   ${label}: ${rejected} recusadas / ${allowed} permitidas"
  if [ "$expect" = "reject" ]; then
    [ "$allowed" = "0" ] && ok "$label — todas recusadas" || bad "$label — ${allowed} passaram"
  else
    [ "$rejected" = "0" ] && ok "$label — todas permitidas" || bad "$label — ${rejected} recusadas indevidamente"
  fi
}

EMAIL="failclosed-owner@apptest.local"

echo "== fixture: workspace ESSENCIAL, owner com membership válida =="
$PSQL >/dev/null <<SQL
do \$\$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where email = '${EMAIL}';
  if v_uid is null then return; end if;
  delete from public.app_sessions where user_id = v_uid;
  delete from public.store_members sm using public.stores s
    where sm.store_id = s.id and s.workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.audit_log where store_id in (
    select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id = v_uid);
  delete from public.products where store_id in (
    select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id = v_uid);
  delete from public.store_plans where store_id in (
    select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id = v_uid);
  delete from public.stores where workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.workspace_invitations where workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.workspace_members where workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.workspace_subscriptions where workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.workspaces where owner_user_id = v_uid;
  delete from auth.users where id = v_uid;
end \$\$;
SQL

curl -s -X POST "${SUPABASE_URL}/auth/v1/signup" -H "apikey: ${APIKEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"Str0ng!Passw0rd#2026\"}" >/dev/null
$PSQL -c "update auth.users set email_confirmed_at = now() where email = '${EMAIL}';" >/dev/null

$PSQL >/dev/null <<SQL
do \$\$
declare v_uid uuid; v_ws uuid; v_store uuid; v_prod uuid;
begin
  select id into v_uid from auth.users where email = '${EMAIL}';
  insert into public.workspaces (owner_user_id, name) values (v_uid,'WS failclosed') returning id into v_ws;
  insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
    values (v_ws,'essential','active',now());
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');
  insert into public.stores (slug, name, status, workspace_id)
    values ('loja-failclosed','Loja failclosed','active', v_ws) returning id into v_store;
  insert into public.store_members (store_id, user_id, role) values (v_store, v_uid, 'owner');
  insert into public.products (store_id, name, slug, price_cents, stock, status)
    values (v_store,'P','p-failclosed',1000,50,'draft') returning id into v_prod;
  create table if not exists public._fc_fixture (ws uuid, store uuid, product uuid);
  delete from public._fc_fixture;
  insert into public._fc_fixture values (v_ws, v_store, v_prod);
end \$\$;
SQL

WS=$($PSQL -c "select ws from public._fc_fixture;")
STORE=$($PSQL -c "select store from public._fc_fixture;")
PROD=$($PSQL -c "select product from public._fc_fixture;")

# ------------------------------------------------------------
echo
echo "== 1. JWT válido + membership válida + SEM app_session  =>  REJECT =="
R=$(login "$EMAIL"); TOK=$(echo "$R" | access_of); REF=$(echo "$R" | refresh_of)
SID=$(echo "$TOK" | claim_of session_id)
ROWS=$($PSQL -c "select count(*) from public.app_sessions where supabase_session_hash = encode(extensions.digest('${SID}','sha256'),'hex');")
echo "   sessões registradas para este JWT: ${ROWS} (tem que ser 0)"
[ "$ROWS" = "0" ] || bad "fixture inválida: já existe app_session para este JWT"
probe_all "$TOK" "sem app_session" reject

# ------------------------------------------------------------
echo
echo "== 2. Mesma conta, agora COM app_session registrada  =>  ALLOW =="
rpc "$TOK" app_session_start_for_store "{\"p_store_id\":\"${STORE}\",\"p_user_agent_label\":\"Probe\"}" >/dev/null
probe_all "$TOK" "com app_session ativa" allow

# ------------------------------------------------------------
echo
echo "== 3. Refresh da sessão ATIVA  =>  ALLOW, sem criar segunda sessão =="
BEFORE=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
R2=$(curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token" -H "apikey: ${APIKEY}" \
  -H "Content-Type: application/json" -d "{\"refresh_token\":\"${REF}\"}")
TOK2=$(echo "$R2" | access_of); REF2=$(echo "$R2" | refresh_of)
AFTER=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$BEFORE" = "$AFTER" ] && ok "refresh não criou segunda app_session (${BEFORE} -> ${AFTER})" \
                         || bad "refresh criou sessão nova (${BEFORE} -> ${AFTER})"
probe_all "$TOK2" "após refresh, sessão ativa" allow

# ------------------------------------------------------------
echo
echo "== 4. Sessão REVOGADA  =>  REJECT, mesmo após refresh =="
$PSQL -c "update public.app_sessions set revoked_at = now(), revoked_reason='admin' where workspace_id='${WS}';" >/dev/null
probe_all "$TOK2" "sessão revogada" reject
R3=$(curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token" -H "apikey: ${APIKEY}" \
  -H "Content-Type: application/json" -d "{\"refresh_token\":\"${REF2}\"}")
TOK3=$(echo "$R3" | access_of)
if [ -n "$TOK3" ]; then probe_all "$TOK3" "refresh de sessão revogada" reject; else ok "refresh de sessão revogada nem emite token"; fi

# ------------------------------------------------------------
echo
echo "== 5. Row REMOVIDA do banco  =>  continua REJECT (fail-closed) =="
# O cenário de bypass: se apagar a linha devolvesse acesso, bastaria uma
# rota legítima (ou um bug) que apagasse sessões para ressuscitar um JWT.
$PSQL -c "delete from public.app_sessions where workspace_id='${WS}';" >/dev/null
ROWS=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}';")
echo "   linhas restantes: ${ROWS}"
probe_all "$TOK2" "row removida" reject

# ------------------------------------------------------------
echo
echo "== 6. Membro removido: nem com JWT válido, nem apagando a própria row =="
MEMBER="failclosed-member@apptest.local"
$PSQL >/dev/null <<SQL
delete from public.app_sessions where user_id in (select id from auth.users where email='${MEMBER}');
delete from public.store_members where user_id in (select id from auth.users where email='${MEMBER}');
delete from public.workspace_members where user_id in (select id from auth.users where email='${MEMBER}');
delete from auth.users where email='${MEMBER}';
update public.workspace_subscriptions set plan_key='growth' where workspace_id='${WS}';
SQL
curl -s -X POST "${SUPABASE_URL}/auth/v1/signup" -H "apikey: ${APIKEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${MEMBER}\",\"password\":\"Str0ng!Passw0rd#2026\"}" >/dev/null
$PSQL -c "update auth.users set email_confirmed_at = now() where email = '${MEMBER}';" >/dev/null
$PSQL >/dev/null <<SQL
insert into public.workspace_members (workspace_id, user_id, role)
  select '${WS}', id, 'member' from auth.users where email='${MEMBER}';
select public.workspace_sync_store_access('${WS}');
SQL
MTOK=$(login "$MEMBER" | access_of)
rpc "$MTOK" app_session_start_for_store "{\"p_store_id\":\"${STORE}\",\"p_user_agent_label\":\"Membro\"}" >/dev/null
probe_member "$MTOK" "membro ativo" allow

MUID=$($PSQL -c "select id from auth.users where email='${MEMBER}';")
$PSQL >/dev/null <<SQL
delete from public.workspace_members where workspace_id='${WS}' and user_id='${MUID}';
select public.workspace_sync_store_access('${WS}');
update public.app_sessions set revoked_at=now(), revoked_reason='member_removed'
  where workspace_id='${WS}' and user_id='${MUID}' and revoked_at is null;
SQL
probe_member "$MTOK" "membro removido" reject
# e apagando a própria linha, que seria o bypass grave
$PSQL -c "delete from public.app_sessions where user_id='${MUID}';" >/dev/null
probe_member "$MTOK" "membro removido + row apagada" reject

# ------------------------------------------------------------
echo
echo "== 7. Sessão de RECUPERAÇÃO de senha não é sessão administrativa =="
# A recuperação existe para redefinir a senha, nunca para operar a loja.
# O Supabase emite um session_id NOVO ao trocar o token de recuperação,
# e essa sessão jamais passa pelo bootstrap administrativo — logo, sob a
# política fail-closed, ela simplesmente não tem sessão registrada.
#
# Note que NÃO dependemos de farejar o claim `amr`: numa recuperação ele
# vem como {"method":"otp"}, indistinguível de um login OTP legítimo.
# Depender disso seria frágil; a ausência de registro é o sinal correto.
curl -s -X POST "${SUPABASE_URL}/auth/v1/recover" -H "apikey: ${APIKEY}"   -H "Content-Type: application/json" -d "{\"email\":\"${EMAIL}\"}" -o /dev/null
sleep 1
MSG_ID=$(curl -s "http://127.0.0.1:54324/api/v1/messages" | python -c "
import sys,json
d=json.load(sys.stdin)
msgs=[m for m in d.get('messages',[])]
print(msgs[0]['ID'] if msgs else '')" 2>/dev/null)

if [ -n "$MSG_ID" ]; then
  TH=$(curl -s "http://127.0.0.1:54324/api/v1/message/${MSG_ID}" | python -c "
import sys,json,re
d=json.load(sys.stdin); body=(d.get('Text') or '') + (d.get('HTML') or '')
m=re.search(r'token_hash=([A-Za-z0-9_-]+)', body)
print(m.group(1) if m else '')" 2>/dev/null)

  if [ -n "$TH" ]; then
    RSESS=$(curl -s -X POST "${SUPABASE_URL}/auth/v1/verify" -H "apikey: ${APIKEY}"       -H "Content-Type: application/json" -d "{\"type\":\"recovery\",\"token_hash\":\"${TH}\"}")
    RTOK=$(echo "$RSESS" | access_of)
    if [ -n "$RTOK" ]; then
      RSID=$(echo "$RTOK" | claim_of session_id)
      echo "   session_id da recuperação: ${RSID}"
      echo "   amr: $(echo "$RTOK" | claim_of amr)"
      RROWS=$($PSQL -c "select count(*) from public.app_sessions where supabase_session_hash = encode(extensions.digest('${RSID}','sha256'),'hex');")
      echo "   sessões registradas para o JWT de recuperação: ${RROWS}"
      probe_all "$RTOK" "sessão de recuperação" reject
    else
      bad "não foi possível trocar o token de recuperação por sessão: $(echo "$RSESS" | head -c 120)"
    fi
  else
    bad "token_hash de recuperação não encontrado no e-mail"
  fi
else
  bad "Mailpit sem mensagens — não deu para testar recuperação"
fi

# ------------------------------------------------------------
echo
echo "== 8. Sessão revogada NÃO ressuscita ao recarregar (regressão 0023) =="
# O upsert de app_session_start fazia `revoked_at = null` no ON CONFLICT,
# então o browser revogado voltava a ter sessão só carregando uma página.
# Só aparecia quando a revogada era a ÚNICA sessão — com outra ativa, o
# ramo de conflito retornava antes.
$PSQL >/dev/null <<SQL
delete from public.app_sessions where workspace_id = '${WS}';
update public.workspace_subscriptions set plan_key='essential' where workspace_id='${WS}';
SQL
R_TOK=$(login "$EMAIL" | access_of)
rpc "$R_TOK" app_session_start_for_store "{\"p_store_id\":\"${STORE}\",\"p_user_agent_label\":\"Ressurreicao\"}" >/dev/null
ATIVAS=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$ATIVAS" = "1" ] && ok "sessão aberta antes do teste" || bad "esperava 1 sessão, got ${ATIVAS}"

# revoga por DECISÃO (takeover) e deixa como única
$PSQL -c "update public.app_sessions set revoked_at=now(), revoked_reason='takeover' where workspace_id='${WS}';" >/dev/null

# o mesmo JWT tenta reabrir: tem que ser NEGADO, não ressuscitado
RES=$(rpc "$R_TOK" app_session_start_for_store "{\"p_store_id\":\"${STORE}\",\"p_user_agent_label\":\"Ressurreicao\"}")
echo "$RES" | grep -q "session_revoked" && ok "reabrir sessão revogada devolve session_revoked"                                         || bad "sessão revogada foi reaberta: $RES"
ATIVAS=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$ATIVAS" = "0" ] && ok "continua 0 sessões ativas (sem ressurreição)" || bad "${ATIVAS} ativa(s) após tentativa"
probe_all "$R_TOK" "após tentativa de ressurreição" reject

# ------------------------------------------------------------
echo
echo "== 9. Lease vencido (stale) PODE ser reocupado pelo mesmo browser =="
# Contraponto: 'stale' é abandono, não punição. Se o mesmo browser volta
# com token válido, tem que seguir trabalhando — senão um almoço longo
# viraria logout.
$PSQL >/dev/null <<SQL
update public.app_sessions set revoked_reason='stale' where workspace_id='${WS}';
SQL
RES=$(rpc "$R_TOK" app_session_start_for_store "{\"p_store_id\":\"${STORE}\",\"p_user_agent_label\":\"Voltou\"}")
echo "$RES" | grep -q '"conflict":false' && ok "sessão stale reocupada pelo mesmo browser" || bad "stale não pôde voltar: $RES"

$PSQL -c "drop table if exists public._fc_fixture;" >/dev/null

echo
echo "================================================"
echo "  fail-closed: ${PASS} PASS · ${FAILED} FAIL"
echo "================================================"
[ "$FAILED" = "0" ] || exit 1
