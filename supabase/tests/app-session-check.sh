#!/usr/bin/env bash
# TASK-012 commit 3 — Sessão única do Essencial, provada com JWT REAL
# sobre HTTP, sem passar pelo Next.js.
#
# Este é o teste que separa "parece deslogado" de "não tem mais
# autorização". Todas as chamadas vão direto ao PostgREST com o Bearer
# token do Supabase — exatamente o que um atacante faria para contornar
# o middleware.
#
# Critério de aceitação (requisito 10/24):
#   1. A tem JWT válido e app_session ativa
#   2. B autentica e faz takeover
#   3. app_session de A é revogada
#   4. o JWT de A AINDA está dentro da validade
#   5. A tenta mutation direto no PostgREST
#   6. BACKEND REJEITA
#
# Uso: bash supabase/tests/app-session-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

SUPABASE_URL="http://127.0.0.1:54321"
APIKEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2)
PSQL="docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -q -t -A"
PASS_COUNT=0
FAIL_COUNT=0

ok()   { echo "PASS - $1"; PASS_COUNT=$((PASS_COUNT+1)); }
bad()  { echo "FAIL - $1"; FAIL_COUNT=$((FAIL_COUNT+1)); }

rpc() { # rpc <token> <fn> <json>
  curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/$2" \
    -H "apikey: ${APIKEY}" -H "Authorization: Bearer $1" \
    -H "Content-Type: application/json" -d "$3"
}

login() { # login <email> -> access_token (novo session_id a cada chamada)
  curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${APIKEY}" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"Str0ng!Passw0rd#2026\"}" \
    | python -c "import sys,json;d=json.load(sys.stdin);print(d.get('access_token',''))"
}

sid_of() { python -c "
import sys,base64,json
t=sys.stdin.read().strip()
p=t.split('.')[1]; p+='='*(-len(p)%4)
print(json.loads(base64.urlsafe_b64decode(p))['session_id'])"; }

echo "== fixture: workspace ESSENCIAL com owner, loja ativa e produto =="
EMAIL="sess-owner@apptest.local"

# O usuário é criado pela API de signup do GoTrue, não por INSERT em
# auth.users: uma linha montada à mão passa pelo NOT NULL mas quebra o
# scan interno do GoTrue ("Database error querying schema"). Só a
# confirmação de e-mail é feita via SQL, para não depender de Mailpit.
# Teardown idempotente: as FKs são ON DELETE RESTRICT de propósito
# (apagar comerciante com histórico deve falhar alto), então a ordem
# importa — loja, workspace, usuário.
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
    select s.id from public.stores s join public.workspaces w on w.id = s.workspace_id where w.owner_user_id = v_uid);
  delete from public.product_images where store_id in (
    select s.id from public.stores s join public.workspaces w on w.id = s.workspace_id where w.owner_user_id = v_uid);
  delete from public.products where store_id in (
    select s.id from public.stores s join public.workspaces w on w.id = s.workspace_id where w.owner_user_id = v_uid);
  delete from public.store_plans where store_id in (
    select s.id from public.stores s join public.workspaces w on w.id = s.workspace_id where w.owner_user_id = v_uid);
  delete from public.billing_charges where workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.stores where workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.workspace_invitations where workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.workspace_members where workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.workspace_subscriptions where workspace_id in (select id from public.workspaces where owner_user_id = v_uid);
  delete from public.workspaces where owner_user_id = v_uid;
  delete from auth.users where id = v_uid;
end \$\$;
SQL
curl -s -X POST "${SUPABASE_URL}/auth/v1/signup" -H "apikey: ${APIKEY}"   -H "Content-Type: application/json"   -d "{\"email\":\"${EMAIL}\",\"password\":\"Str0ng!Passw0rd#2026\"}" >/dev/null
$PSQL -c "update auth.users set email_confirmed_at = now() where email = '${EMAIL}';" >/dev/null

$PSQL >/dev/null <<SQL
do \$\$
declare v_uid uuid; v_ws uuid; v_store uuid; v_prod uuid;
begin
  select id into v_uid from auth.users where email = '${EMAIL}';
  insert into public.workspaces (owner_user_id, name) values (v_uid,'WS sessao') returning id into v_ws;
  insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
    values (v_ws,'essential','active',now());
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');
  insert into public.stores (slug, name, status, workspace_id)
    values ('loja-sessao','Loja sessao','active', v_ws) returning id into v_store;
  insert into public.store_members (store_id, user_id, role) values (v_store, v_uid, 'owner');
  insert into public.products (store_id, name, slug, price_cents, stock, status)
    values (v_store,'Produto sessao','produto-sessao',1000,5,'draft') returning id into v_prod;
  create table if not exists public._sess_fixture (ws uuid, store uuid, product uuid);
  delete from public._sess_fixture;
  insert into public._sess_fixture values (v_ws, v_store, v_prod);
end \$\$;
SQL

WS=$($PSQL -c "select ws from public._sess_fixture;")
STORE=$($PSQL -c "select store from public._sess_fixture;")
PROD=$($PSQL -c "select product from public._sess_fixture;")

# ------------------------------------------------------------
echo
echo "== 1. Browser A faz login e abre a sessão =="
A_TOK=$(login "$EMAIL")
[ -n "$A_TOK" ] || { echo "FAIL: login A nao retornou token"; exit 1; }
A_SID=$(echo "$A_TOK" | sid_of)
RES=$(rpc "$A_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Chrome (PC)\"}")
echo "   $RES"
echo "$RES" | grep -q '"conflict":false' && ok "A abriu app_session" || bad "A nao abriu sessao"

# ------------------------------------------------------------
echo
echo "== 2. A opera normalmente (mutation direta no PostgREST) =="
RES=$(rpc "$A_TOK" catalog_set_product_status "{\"p_product_id\":\"${PROD}\",\"p_status\":\"published\"}")
echo "$RES" | grep -q '"status":"published"' && ok "A publica produto" || bad "A nao conseguiu operar: $RES"

# ------------------------------------------------------------
echo
echo "== 3. Três abas do MESMO browser = UMA sessão =="
# abas compartilham o mesmo access token/session_id
for _ in 1 2 3; do rpc "$A_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\"}" >/dev/null; done
N=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$N" = "1" ] && ok "3 aberturas do mesmo browser = 1 sessao ativa (abas nao consomem sessoes)" \
                || bad "3 abas viraram ${N} sessoes ativas"

# ------------------------------------------------------------
echo
echo "== 4. Browser B tenta entrar com A ativa =="
B_TOK=$(login "$EMAIL")
B_SID=$(echo "$B_TOK" | sid_of)
[ "$A_SID" != "$B_SID" ] && ok "login B gerou session_id distinto de A" || bad "B reusou o session_id de A"
RES=$(rpc "$B_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Safari (celular)\"}")
echo "   $RES"
echo "$RES" | grep -q '"conflict":true' && ok "B bloqueado: conta ja ativa em outro dispositivo" || bad "B entrou sem takeover"

# ------------------------------------------------------------
echo
echo "== 5. A continua funcional enquanto B esta bloqueado =="
RES=$(rpc "$A_TOK" catalog_set_product_status "{\"p_product_id\":\"${PROD}\",\"p_status\":\"draft\"}")
echo "$RES" | grep -q '"status":"draft"' && ok "A segue operando (B nao derrubou A)" || bad "A perdeu acesso indevidamente: $RES"

# ------------------------------------------------------------
echo
echo "== 6. B faz takeover explicito =="
RES=$(rpc "$B_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Safari (celular)\",\"p_takeover\":true}")
echo "   $RES"
echo "$RES" | grep -q '"conflict":false' && ok "B assumiu a sessao" || bad "takeover de B falhou"

N=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$N" = "1" ] && ok "existe exatamente 1 sessao ativa apos o takeover" || bad "${N} sessoes ativas apos takeover"

# ------------------------------------------------------------
echo
echo "== 7. TESTE DECISIVO — JWT de A ainda valido, mas sem autorizacao =="
EXP=$(echo "$A_TOK" | python -c "
import sys,base64,json,time
t=sys.stdin.read().strip(); p=t.split('.')[1]; p+='='*(-len(p)%4)
d=json.loads(base64.urlsafe_b64decode(p))
print('valido por mais', int(d['exp']-time.time()), 'segundos')")
echo "   JWT de A: $EXP"

FAILED_ANY=0
attempt() { # attempt <descricao> <fn> <json>
  local out; out=$(rpc "$A_TOK" "$2" "$3")
  if echo "$out" | grep -qi "insufficient_privilege\|PGRST\|permission denied"; then
    echo "   [REJEITADO] $1"
  else
    echo "   [PASSOU!!] $1 -> $out"
    FAILED_ANY=1
  fi
}
attempt "publicar produto"        catalog_set_product_status "{\"p_product_id\":\"${PROD}\",\"p_status\":\"published\"}"
attempt "criar produto"           catalog_create_product     "{\"p_store_id\":\"${STORE}\",\"p_name\":\"Bypass\",\"p_slug\":\"bypass\",\"p_price_cents\":100,\"p_stock\":1}"
attempt "ajustar estoque"         catalog_adjust_stock       "{\"p_product_id\":\"${PROD}\",\"p_delta\":10,\"p_reason\":\"bypass\"}"
attempt "adicionar imagem"        catalog_add_product_image  "{\"p_product_id\":\"${PROD}\",\"p_storage_path\":\"${STORE}/${PROD}/x.jpg\"}"
attempt "criar loja"              workspace_create_store     "{\"p_name\":\"Loja bypass\",\"p_slug\":\"loja-bypass\"}"
attempt "convidar membro"         workspace_invite_member    "{\"p_email\":\"x@bypass.test\",\"p_token_hash\":\"$(printf 'a%.0s' {1..64})\"}"
attempt "ler equipe"              workspace_team             "{\"p_store_id\":\"${STORE}\"}"
attempt "ler assinatura"          billing_get_subscription   "{\"p_store_id\":\"${STORE}\"}"
attempt "ler quota"               store_quota_usage          "{\"p_store_id\":\"${STORE}\"}"

if [ "$FAILED_ANY" = "0" ]; then
  ok "TODAS as operacoes administrativas de A foram rejeitadas pelo BACKEND com JWT ainda valido"
else
  bad "alguma operacao de A passou apos a revogacao (sessao unica burlavel)"
fi

# ------------------------------------------------------------
echo
echo "== 8. B opera normalmente =="
RES=$(rpc "$B_TOK" catalog_set_product_status "{\"p_product_id\":\"${PROD}\",\"p_status\":\"published\"}")
echo "$RES" | grep -q '"status":"published"' && ok "B opera apos o takeover" || bad "B nao consegue operar: $RES"

# ------------------------------------------------------------
echo
echo "== 9. Heartbeat de A avisa que a sessao morreu =="
RES=$(rpc "$A_TOK" app_session_heartbeat "{}")
[ "$RES" = "false" ] && ok "heartbeat de A devolve false (frontend encerra)" || bad "heartbeat de A devolveu $RES"
RES=$(rpc "$B_TOK" app_session_heartbeat "{}")
[ "$RES" = "true" ] && ok "heartbeat de B devolve true" || bad "heartbeat de B devolveu $RES"

# ------------------------------------------------------------
echo
echo "== 10. Logout revoga imediatamente =="
rpc "$B_TOK" app_session_logout "{}" >/dev/null
RES=$(rpc "$B_TOK" catalog_set_product_status "{\"p_product_id\":\"${PROD}\",\"p_status\":\"draft\"}")
echo "$RES" | grep -qi "insufficient_privilege" && ok "apos logout, B perde autorizacao no backend" || bad "B ainda opera apos logout: $RES"

# ------------------------------------------------------------
echo
echo "== 11. Sessao stale libera a vaga para um login novo =="
# Limpa e monta o cenario: UMA sessao ativa, abandonada ha 45 minutos
# (alem da janela de 30). Nao da para so "des-revogar" varias linhas —
# o indice unico parcial impede duas ativas, que e exatamente a garantia
# sob teste.
$PSQL >/dev/null <<SQL
delete from public.app_sessions where workspace_id = '${WS}';
SQL
C_TOK=$(login "$EMAIL")
rpc "$C_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Chrome abandonado\"}" >/dev/null
$PSQL >/dev/null <<SQL
update public.app_sessions set last_seen_at = now() - interval '45 minutes' where workspace_id = '${WS}';
SQL
D_TOK=$(login "$EMAIL")
RES=$(rpc "$D_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Edge\"}")
echo "$RES" | grep -q '"conflict":false' && ok "sessao abandonada (>30min) nao bloqueia login novo" || bad "stale ainda bloqueia: $RES"
N=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$N" = "1" ] && ok "continua 1 sessao ativa apos ocupar a vaga stale" || bad "${N} ativas apos stale"
STALE=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_reason='stale';")
[ "$STALE" = "1" ] && ok "a abandonada ficou auditada como stale" || bad "motivo stale ausente (${STALE})"

# ------------------------------------------------------------
echo
echo "== 12. Upgrade para Growth remove a restricao de sessao unica =="
$PSQL >/dev/null <<SQL
update public.workspace_subscriptions set plan_key='growth' where workspace_id='${WS}';
select public.workspace_apply_session_policy('${WS}');
SQL
E_TOK=$(login "$EMAIL")
RES=$(rpc "$E_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Firefox\"}")
echo "$RES" | grep -q '"conflict":false' && ok "no Growth uma segunda sessao e permitida" || bad "Growth ainda restringe sessao: $RES"
N=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$N" = "2" ] && ok "Growth mantem 2 sessoes ativas simultaneas" || bad "Growth ficou com ${N} sessoes"

# ------------------------------------------------------------
echo
echo "== 13. Downgrade para Essencial consolida em UMA sessao =="
$PSQL >/dev/null <<SQL
update public.workspace_subscriptions set plan_key='essential' where workspace_id='${WS}';
select public.workspace_apply_session_policy('${WS}');
SQL
N=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$N" = "1" ] && ok "downgrade preserva a sessao mais recente e revoga as demais (1 ativa)" || bad "Essencial nasceu com ${N} sessoes ativas"
KEPT=$($PSQL -c "select revoked_reason from public.app_sessions where workspace_id='${WS}' and revoked_reason='plan_downgrade' limit 1;")
[ "$KEPT" = "plan_downgrade" ] && ok "as revogadas ficam auditadas como plan_downgrade" || bad "motivo de revogacao ausente"

# ------------------------------------------------------------
echo
echo "== 14. Login CONCORRENTE de A e B: so uma sessao sobrevive =="
$PSQL >/dev/null <<SQL
update public.workspace_subscriptions set plan_key='essential' where workspace_id='${WS}';
delete from public.app_sessions where workspace_id = '${WS}';
SQL
R1_TOK=$(login "$EMAIL"); R2_TOK=$(login "$EMAIL")
# takeover=true nos dois: e a disputa mais agressiva possivel pela vaga
rpc "$R1_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Race1\",\"p_takeover\":true}" > /tmp/race1.log 2>&1 &
P1=$!
rpc "$R2_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Race2\",\"p_takeover\":true}" > /tmp/race2.log 2>&1 &
P2=$!
wait $P1; wait $P2
N=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$N" = "1" ] && ok "login simultaneo de dois browsers deixa exatamente 1 sessao ativa"                 || bad "login concorrente deixou ${N} sessoes ativas"

# ------------------------------------------------------------
echo
echo "== 15. Membro removido perde acesso no backend imediatamente =="
MEMBER="sess-member@apptest.local"
$PSQL -c "delete from public.app_sessions where user_id in (select id from auth.users where email='${MEMBER}');" >/dev/null
$PSQL -c "delete from public.store_members where user_id in (select id from auth.users where email='${MEMBER}');" >/dev/null
$PSQL -c "delete from public.workspace_members where user_id in (select id from auth.users where email='${MEMBER}');" >/dev/null
$PSQL -c "delete from auth.users where email='${MEMBER}';" >/dev/null
curl -s -X POST "${SUPABASE_URL}/auth/v1/signup" -H "apikey: ${APIKEY}" -H "Content-Type: application/json"   -d "{\"email\":\"${MEMBER}\",\"password\":\"Str0ng!Passw0rd#2026\"}" >/dev/null
$PSQL -c "update auth.users set email_confirmed_at = now() where email = '${MEMBER}';" >/dev/null
# Growth para caber owner + membro, e sem restricao de sessao unica
$PSQL >/dev/null <<SQL
update public.workspace_subscriptions set plan_key='growth' where workspace_id='${WS}';
select public.workspace_apply_session_policy('${WS}');
insert into public.workspace_members (workspace_id, user_id, role)
  select '${WS}', id, 'member' from auth.users where email='${MEMBER}';
select public.workspace_sync_store_access('${WS}');
SQL
M_TOK=$(login "$MEMBER")
rpc "$M_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"PC do funcionario\"}" >/dev/null
RES=$(rpc "$M_TOK" catalog_set_product_status "{\"p_product_id\":\"${PROD}\",\"p_status\":\"draft\"}")
echo "$RES" | grep -q '"status":"draft"' && ok "membro opera a loja antes da remocao" || bad "membro nao conseguiu operar: $RES"

# owner remove o membro
OWNER_TOK=$(login "$EMAIL")
rpc "$OWNER_TOK" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Owner\"}" >/dev/null
MUID=$($PSQL -c "select id from auth.users where email='${MEMBER}';")
rpc "$OWNER_TOK" workspace_remove_member "{\"p_user_id\":\"${MUID}\"}" >/dev/null

# o JWT do removido continua valido — mas nao autoriza mais nada
RES=$(rpc "$M_TOK" catalog_set_product_status "{\"p_product_id\":\"${PROD}\",\"p_status\":\"published\"}")
echo "$RES" | grep -qi "insufficient_privilege" && ok "removido perde autorizacao no backend com JWT ainda valido"                                                  || bad "ex-membro ainda opera: $RES"
REV=$($PSQL -c "select count(*) from public.app_sessions where user_id='${MUID}' and revoked_reason='member_removed';")
[ "$REV" = "1" ] && ok "sessao do removido fica auditada como member_removed" || bad "sessao do removido nao revogada (${REV})"

# ------------------------------------------------------------
echo
echo "== 14. PROFESSIONAL tambem aceita multiplas sessoes =="
# Growth ja foi testado acima. Professional usa o mesmo
# max_concurrent_sessions = NULL, mas confirmar explicitamente evita que
# uma mudanca futura no catalogo aplique a regra do Essencial por engano.
$PSQL >/dev/null <<SQL
update public.workspace_subscriptions set plan_key='professional' where workspace_id='${WS}';
select public.workspace_apply_session_policy('${WS}');
delete from public.app_sessions where workspace_id='${WS}';
SQL
P1=$(login "$EMAIL"); P2=$(login "$EMAIL")
rpc "$P1" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Pro A\"}" >/dev/null
RES=$(rpc "$P2" app_session_start "{\"p_workspace_id\":\"${WS}\",\"p_user_agent_label\":\"Pro B\"}")
echo "$RES" | grep -q '"conflict":false' && ok "Professional: 2a sessao permitida sem takeover" || bad "Professional restringiu sessao: $RES"
N=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$N" = "2" ] && ok "Professional mantem 2 sessoes ativas simultaneas" || bad "Professional ficou com ${N} sessoes"

# as duas operam de verdade
RES=$(rpc "$P1" store_quota_usage "{\"p_store_id\":\"${STORE}\"}")
echo "$RES" | grep -q "plan_key" && ok "sessao Pro A opera" || bad "Pro A nao opera: $RES"
RES=$(rpc "$P2" store_quota_usage "{\"p_store_id\":\"${STORE}\"}")
echo "$RES" | grep -q "plan_key" && ok "sessao Pro B opera simultaneamente" || bad "Pro B nao opera: $RES"

$PSQL -c "drop table if exists public._sess_fixture;" >/dev/null

echo
echo "================================================"
echo "  app-session: ${PASS_COUNT} PASS · ${FAIL_COUNT} FAIL"
echo "================================================"
[ "$FAIL_COUNT" = "0" ] || exit 1
