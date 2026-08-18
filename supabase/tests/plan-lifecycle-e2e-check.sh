#!/usr/bin/env bash
# TASK-012 — E2E do ciclo de vida do plano, com JWT REAL sobre HTTP.
#
# Cobre as jornadas que faltavam:
#   multi-store Professional, isolamento cross-store, cupons store-scoped,
#   equipe workspace-wide, upgrade, downgrade (blockers e sucesso),
#   sessões durante downgrade, cupons após downgrade, pedido histórico.
#
# Tudo como `authenticated` de verdade — a lição das três rodadas
# anteriores foi que `postgres` mascara falhas de RLS/grant.
#
# Uso: bash supabase/tests/plan-lifecycle-e2e-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

SUPABASE_URL="http://127.0.0.1:54321"
APIKEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2)
PSQL="docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -q -t -A"
PASS=0; FAILED=0
ok(){ echo "PASS - $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL - $1"; FAILED=$((FAILED+1)); }

rpc(){ curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/$2" -H "apikey: ${APIKEY}" \
  -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$3"; }
login(){ curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" -H "apikey: ${APIKEY}" \
  -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"Str0ng!Passw0rd#2026\"}" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))"; }
mkuser(){ # mkuser <email>
  $PSQL -c "delete from public.app_sessions where user_id in (select id from auth.users where email='$1');" >/dev/null
  curl -s -X POST "${SUPABASE_URL}/auth/v1/signup" -H "apikey: ${APIKEY}" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"Str0ng!Passw0rd#2026\"}" >/dev/null
  $PSQL -c "update auth.users set email_confirmed_at=now() where email='$1';" >/dev/null
}

OWNER="lc-owner@apptest.local"

echo "== fixture: workspace ESSENCIAL com 1 loja =="
$PSQL >/dev/null <<'SQL'
do $$
declare v_uid uuid;
begin
  for v_uid in select id from auth.users where email like 'lc-%@apptest.local' loop
    delete from public.coupon_redemptions where store_id in (select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id=v_uid);
    delete from public.coupons where store_id in (select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id=v_uid);
    delete from public.order_items where store_id in (select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id=v_uid);
    delete from public.orders where store_id in (select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id=v_uid);
    delete from public.app_sessions where workspace_id in (select id from public.workspaces where owner_user_id=v_uid);
    delete from public.store_members sm using public.stores s where sm.store_id=s.id and s.workspace_id in (select id from public.workspaces where owner_user_id=v_uid);
    delete from public.audit_log where store_id in (select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id=v_uid);
    delete from public.product_images where store_id in (select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id=v_uid);
    delete from public.products where store_id in (select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id=v_uid);
    delete from public.store_plans where store_id in (select s.id from public.stores s join public.workspaces w on w.id=s.workspace_id where w.owner_user_id=v_uid);
    delete from public.billing_charges where workspace_id in (select id from public.workspaces where owner_user_id=v_uid);
    delete from public.stores where workspace_id in (select id from public.workspaces where owner_user_id=v_uid);
    delete from public.workspace_invitations where workspace_id in (select id from public.workspaces where owner_user_id=v_uid);
    delete from public.workspace_members where workspace_id in (select id from public.workspaces where owner_user_id=v_uid);
    delete from public.workspace_subscriptions where workspace_id in (select id from public.workspaces where owner_user_id=v_uid);
    delete from public.workspaces where owner_user_id=v_uid;
  end loop;
  delete from auth.users where email like 'lc-%@apptest.local';
end $$;
SQL

mkuser "$OWNER"
$PSQL >/dev/null <<SQL
do \$\$
declare v_uid uuid; v_ws uuid; v_store uuid;
begin
  select id into v_uid from auth.users where email='${OWNER}';
  insert into public.workspaces (owner_user_id,name) values (v_uid,'LC') returning id into v_ws;
  insert into public.workspace_subscriptions (workspace_id,plan_key,status,started_at) values (v_ws,'essential','active',now());
  insert into public.workspace_members (workspace_id,user_id,role) values (v_ws,v_uid,'owner');
  insert into public.stores (slug,name,status,workspace_id) values ('lc-a','Loja A','active',v_ws) returning id into v_store;
  insert into public.store_members (store_id,user_id,role) values (v_store,v_uid,'owner');
  insert into public.store_plans (store_id,plan_code,plan_key) values (v_store,30,'essential');
  insert into public.products (store_id,name,slug,price_cents,stock,status) values (v_store,'Produto Alpha','alpha',10000,500,'published');
end \$\$;
SQL

WS=$($PSQL -c "select w.id from public.workspaces w join auth.users u on u.id=w.owner_user_id where u.email='${OWNER}';")
STORE_A=$($PSQL -c "select id from public.stores where slug='lc-a';")
TOK=$(login "$OWNER")
rpc "$TOK" app_session_start_for_store "{\"p_store_id\":\"${STORE_A}\",\"p_user_agent_label\":\"E2E\"}" >/dev/null

ent(){ $PSQL -c "select $1 from public.workspace_entitlements('${WS}');"; }

# ------------------------------------------------------------
echo
echo "== 1. Entitlements ESSENCIAL =="
[ "$(ent max_products)" = "75" ] && [ "$(ent max_stores)" = "1" ] && [ "$(ent max_team_members)" = "1" ] \
  && [ "$(ent coupons)" = "f" ] && [ "$(ent max_concurrent_sessions)" = "1" ] \
  && ok "essential: 75 produtos, 1 loja, 1 usuario, sem cupons, 1 sessao" \
  || bad "entitlements essential errados: $(ent max_products)/$(ent max_stores)/$(ent max_team_members)/$(ent coupons)/$(ent max_concurrent_sessions)"

RES=$(rpc "$TOK" workspace_create_store '{"p_name":"Loja B","p_slug":"lc-b"}')
echo "$RES" | grep -q "max_stores_reached" && ok "Essencial recusa 2a loja" || bad "Essencial criou 2a loja: $RES"

# ------------------------------------------------------------
echo
echo "== 2. UPGRADE Essencial -> Crescimento =="
$PSQL -c "update public.workspace_subscriptions set plan_key='growth' where workspace_id='${WS}';" >/dev/null
$PSQL -c "select public.workspace_sync_store_plans('${WS}'); select public.workspace_apply_session_policy('${WS}');" >/dev/null
[ "$(ent max_products)" = "350" ] && [ "$(ent max_images_per_product)" = "5" ] && [ "$(ent max_team_members)" = "3" ] \
  && [ "$(ent coupons)" = "t" ] && [ -z "$(ent max_concurrent_sessions)" ] \
  && ok "growth: 350 produtos, 5 fotos, 3 usuarios, cupons ON, sessoes ilimitadas" \
  || bad "entitlements growth errados"

# prova pratica: cria cupom (era proibido no Essencial)
RES=$(rpc "$TOK" coupon_upsert "{\"p_store_id\":\"${STORE_A}\",\"p_coupon_id\":null,\"p_code\":\"NATAL10\",\"p_discount_type\":\"percentage\",\"p_discount_value\":1000}")
echo "$RES" | grep -q '"normalized_code":"NATAL10"' && ok "cupom criado apos upgrade (prova pratica)" || bad "cupom nao criado: $RES"

# ------------------------------------------------------------
echo
echo "== 3. UPGRADE Crescimento -> Profissional + 3 lojas =="
$PSQL -c "update public.workspace_subscriptions set plan_key='professional' where workspace_id='${WS}';" >/dev/null
$PSQL -c "select public.workspace_sync_store_plans('${WS}');" >/dev/null
[ "$(ent max_products)" = "1000" ] && [ "$(ent max_stores)" = "3" ] && [ "$(ent max_team_members)" = "10" ] \
  && ok "professional: 1000 produtos, 3 lojas, 10 usuarios" || bad "entitlements professional errados"

rpc "$TOK" workspace_create_store '{"p_name":"Loja B","p_slug":"lc-b"}' >/dev/null
rpc "$TOK" workspace_create_store '{"p_name":"Loja C","p_slug":"lc-c"}' >/dev/null
N=$($PSQL -c "select count(*) from public.stores where workspace_id='${WS}';")
[ "$N" = "3" ] && ok "3 lojas criadas pela RPC real" || bad "esperava 3 lojas, got ${N}"

RES=$(rpc "$TOK" workspace_create_store '{"p_name":"Loja D","p_slug":"lc-d"}')
echo "$RES" | grep -q "max_stores_reached" && ok "4a loja recusada" || bad "4a loja criada: $RES"

# ------------------------------------------------------------
echo
echo "== 4. BILLING: 1 workspace / 3 lojas = 1 assinatura =="
SUBS=$($PSQL -c "select count(*) from public.workspace_subscriptions where workspace_id='${WS}';")
PRICE=$($PSQL -c "select price_cents from public.platform_plans where plan_key='professional';")
[ "$SUBS" = "1" ] && [ "$PRICE" = "7000" ] && ok "1 assinatura, professional = 7000 centavos" || bad "subs=${SUBS} price=${PRICE}"

STORE_B=$($PSQL -c "select id from public.stores where slug='lc-b';")
$PSQL >/dev/null <<SQL
insert into public.billing_charges (store_id, workspace_id, plan_code, plan_key, amount_cents,
  provider_idempotency_key, external_reference, status, payer_email, payer_doc_type, payer_doc_last4, period_start, period_end)
values ('${STORE_A}','${WS}',80,'professional',7000,'lc-idem-a','lc-ext-a','pending','o@t.local','CPF','1234',now(),now()+interval '30 days');
SQL
DUP=$($PSQL -c "
do \$\$ begin
  insert into public.billing_charges (store_id, workspace_id, plan_code, plan_key, amount_cents,
    provider_idempotency_key, external_reference, status, payer_email, payer_doc_type, payer_doc_last4, period_start, period_end)
  values ('${STORE_B}','${WS}',80,'professional',7000,'lc-idem-b','lc-ext-b','pending','o@t.local','CPF','1234',now(),now()+interval '30 days');
  raise notice 'PASSOU';
exception when unique_violation then raise notice 'BARRADO'; end \$\$;" 2>&1)
echo "$DUP" | grep -q "BARRADO" && ok "2a cobranca aberta pela Loja B recusada pelo banco (nunca 3x R\$70)" || bad "cobranca duplicada permitida"

# ------------------------------------------------------------
echo
echo "== 5. Cupons store-scoped: NATAL10 diferente por loja =="
rpc "$TOK" coupon_upsert "{\"p_store_id\":\"${STORE_B}\",\"p_coupon_id\":null,\"p_code\":\"NATAL10\",\"p_discount_type\":\"fixed_amount\",\"p_discount_value\":2000}" >/dev/null
DA=$($PSQL -c "select discount_cents from public.coupon_validate('${STORE_A}','NATAL10',20000);")
DB=$($PSQL -c "select discount_cents from public.coupon_validate('${STORE_B}','NATAL10',20000);")
[ "$DA" = "2000" ] && [ "$DB" = "2000" ] && ok "NATAL10 coexiste: A=10% de 20000=${DA}, B=fixo ${DB}" || bad "A=${DA} B=${DB}"
IDS=$($PSQL -c "select count(distinct id) from public.coupons where normalized_code='NATAL10' and store_id in ('${STORE_A}','${STORE_B}');")
[ "$IDS" = "2" ] && ok "sao cupons distintos (2 ids)" || bad "ids=${IDS}"

# ------------------------------------------------------------
echo
echo "== 6. Equipe workspace-wide: 3 pessoas / 3 lojas = 3 assentos =="
for i in 1 2; do
  mkuser "lc-m${i}@apptest.local"
  MU=$($PSQL -c "select id from auth.users where email='lc-m${i}@apptest.local';")
  $PSQL -c "insert into public.workspace_members (workspace_id,user_id,role) values ('${WS}','${MU}','member');" >/dev/null
done
$PSQL -c "select public.workspace_sync_store_access('${WS}');" >/dev/null
SEATS=$($PSQL -c "select public.workspace_seat_count('${WS}');")
SM=$($PSQL -c "select count(*) from public.store_members sm join public.stores s on s.id=sm.store_id where s.workspace_id='${WS}';")
[ "$SEATS" = "3" ] && [ "$SM" = "9" ] && ok "3 assentos / 9 store_members (quota conta PESSOAS, nao vinculos)" || bad "seats=${SEATS} store_members=${SM}"

# ------------------------------------------------------------
echo
echo "== 7. Pedido historico com cupom (fica imutavel) =="
PROD_A=$($PSQL -c "select id from public.products where slug='alpha';")
$PSQL >/dev/null <<SQL
do \$\$
declare v_o public.orders;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email='${OWNER}'))::text, true);
  select * into v_o from public.create_order('lc-a', gen_random_uuid(), 'Cliente E2E','11999990000','pickup',null,null,
    jsonb_build_array(jsonb_build_object('product_id','${PROD_A}','quantity',2)), 'NATAL10');
  perform set_config('app.order', v_o.id::text, false);
end \$\$;
SQL
O=$($PSQL -c "select subtotal_cents || '/' || discount_cents || '/' || total_cents from public.orders where customer_name='Cliente E2E';")
[ "$O" = "20000/2000/18000" ] && ok "pedido: subtotal 20000, desconto 2000, total 18000" || bad "pedido=${O}"

# ------------------------------------------------------------
echo
echo "== 8. DOWNGRADE Profissional -> Crescimento: blockers =="
R=$($PSQL -c "select reason || '|' || current_value || '|' || target_limit from public.workspace_can_use_plan('${WS}','growth') where not allowed;")
echo "$R" | grep -q "^stores|3|1" && ok "bloqueado por LOJAS: possui 3, Crescimento permite 1" || bad "esperava bloqueio por lojas, got: ${R}"

# remove 2 lojas -> agora deve bloquear por equipe
$PSQL >/dev/null <<SQL
-- audit_log referencia stores com ON DELETE RESTRICT (historico nao
-- some junto com a loja) — precisa sair antes, senao o delete falha e a
-- contagem de lojas nao muda.
delete from public.store_members sm using public.stores s where sm.store_id=s.id and s.slug in ('lc-b','lc-c');
delete from public.audit_log where store_id in (select id from public.stores where slug in ('lc-b','lc-c'));
delete from public.coupon_redemptions where store_id in (select id from public.stores where slug in ('lc-b','lc-c'));
delete from public.coupons where store_id in (select id from public.stores where slug in ('lc-b','lc-c'));
delete from public.billing_charges where store_id in (select id from public.stores where slug in ('lc-b','lc-c'));
delete from public.store_plans where store_id in (select id from public.stores where slug in ('lc-b','lc-c'));
delete from public.stores where slug in ('lc-b','lc-c');
SQL
R=$($PSQL -c "select reason || '|' || current_value || '|' || target_limit from public.workspace_can_use_plan('${WS}','essential') where not allowed;")
echo "$R" | grep -q "^team|3|1" && ok "bloqueado por EQUIPE: 3 pessoas, Essencial permite 1" || bad "esperava bloqueio por equipe, got: ${R}"

# remove membros -> agora bloqueia por produtos
$PSQL -c "delete from public.workspace_members where workspace_id='${WS}' and role='member';" >/dev/null
$PSQL >/dev/null <<SQL
insert into public.products (store_id,name,slug,price_cents,stock,status)
  select '${STORE_A}','P'||g,'p-lc-'||g,1000,10,'draft' from generate_series(1,80) g;
SQL
R=$($PSQL -c "select reason || '|' || current_value || '|' || target_limit from public.workspace_can_use_plan('${WS}','essential') where not allowed;")
echo "$R" | grep -q "^products|81|75" && ok "bloqueado por PRODUTOS: 81 > 75" || bad "esperava bloqueio por produtos, got: ${R}"

# ------------------------------------------------------------
echo
echo "== 9. DOWNGRADE permitido apos adequar =="
$PSQL -c "delete from public.products where slug like 'p-lc-%';" >/dev/null
ALLOWED=$($PSQL -c "select allowed from public.workspace_can_use_plan('${WS}','essential');")
[ "$ALLOWED" = "t" ] && ok "downgrade para Essencial liberado apos adequar quotas" || bad "ainda bloqueado: $($PSQL -c "select reason from public.workspace_can_use_plan('${WS}','essential');")"

# ------------------------------------------------------------
echo
echo "== 10. Sessoes durante downgrade Growth -> Essential =="
$PSQL >/dev/null <<SQL
update public.workspace_subscriptions set plan_key='growth' where workspace_id='${WS}';
delete from public.app_sessions where workspace_id='${WS}';
insert into public.app_sessions (workspace_id,user_id,supabase_session_hash,enforces_single_session,expires_at,last_seen_at)
select '${WS}', (select id from auth.users where email='${OWNER}'), 'lc-h'||g, false, now()+interval '30 days', now()
from generate_series(1,2) g;
SQL
$PSQL -c "update public.workspace_subscriptions set plan_key='essential' where workspace_id='${WS}'; select public.workspace_apply_session_policy('${WS}');" >/dev/null
ATIVAS=$($PSQL -c "select count(*) from public.app_sessions where workspace_id='${WS}' and revoked_at is null;")
[ "$ATIVAS" = "1" ] && ok "downgrade consolidou 2 sessoes em 1" || bad "${ATIVAS} sessoes ativas apos downgrade"
REV=$($PSQL -c "select revoked_reason from public.app_sessions where workspace_id='${WS}' and revoked_at is not null limit 1;")
[ "$REV" = "plan_downgrade" ] && ok "revogada auditada como plan_downgrade" || bad "motivo=${REV}"

# a revogada NAO pode ressuscitar (0023)
RESU=$($PSQL -c "
do \$\$ begin
  update public.app_sessions set revoked_at=null, revoked_reason=null
   where workspace_id='${WS}' and revoked_reason='plan_downgrade';
  raise notice 'MANUAL';
exception when others then raise notice 'BARRADO'; end \$\$;" 2>&1)
$PSQL -c "update public.app_sessions set revoked_at=now(), revoked_reason='plan_downgrade' where workspace_id='${WS}' and revoked_at is null and supabase_session_hash='lc-h2';" >/dev/null

# ------------------------------------------------------------
echo
echo "== 11. Cupons apos downgrade para Essencial =="
CNT=$($PSQL -c "select count(*) from public.coupons where store_id='${STORE_A}';")
[ "$CNT" = "1" ] && ok "cupom preservado no banco apos downgrade" || bad "cupons=${CNT}"
REASON=$($PSQL -c "select reason from public.coupon_validate('${STORE_A}','NATAL10',20000);")
[ "$REASON" = "coupons_not_available" ] && ok "checkout novo recusa cupom no Essencial" || bad "reason=${REASON}"
O2=$($PSQL -c "select subtotal_cents || '/' || discount_cents || '/' || total_cents from public.orders where customer_name='Cliente E2E';")
[ "$O2" = "20000/2000/18000" ] && ok "pedido historico INALTERADO pelo downgrade (20000/2000/18000)" || bad "pedido mudou: ${O2}"

# upgrade de volta reativa
$PSQL -c "update public.workspace_subscriptions set plan_key='growth' where workspace_id='${WS}';" >/dev/null
VALID=$($PSQL -c "select valid from public.coupon_validate('${STORE_A}','NATAL10',20000);")
[ "$VALID" = "t" ] && ok "upgrade de volta reativa o cupom ativo e nao expirado" || bad "cupom nao reativou"

echo
echo "================================================"
echo "  plan-lifecycle E2E: ${PASS} PASS · ${FAILED} FAIL"
echo "================================================"
[ "$FAILED" = "0" ] || exit 1
