#!/usr/bin/env bash
# Teste real de upgrade para o bloqueador 6 (BUG-RT2-006,
# qa/reports/TASK-002-RETEST.md): a migração 0004 anterior narrava
# audit_log_action_check (removia 'signup_completed'/
# 'password_recovery_requested' do conjunto permitido), e um banco com
# linhas históricas gravadas sob a 0002 (que já permitia esses valores)
# quebrava com check_violation ao aplicá-la — reproduzido pelo Júnior
# inserindo uma linha histórica válida e então aplicando a 0004 antiga.
#
# Este script reproduz o cenário real de ponta a ponta:
#   1. Move 0003/0004 para fora de supabase/migrations/ temporariamente.
#   2. `supabase db reset` — aplica só 0001+0002 (estado "histórico").
#   3. Insere uma linha real em audit_log com action='signup_completed'
#      (valor que só a 0002 permitia originalmente).
#   4. Devolve 0003/0004 para o lugar.
#   5. `supabase migration up` — aplica 0003+0004 (versão corrigida)
#      SOBRE o banco já populado, sem resetar (o caminho real de
#      upgrade, não um banco vazio).
#   6. Confirma: nenhum erro; a linha histórica sobrevive INTACTA (nunca
#      apagada/alterada); as tabelas/funções da 0003/0004 existem e
#      funcionam.
#   7. Restaura o ambiente para o estado normal de teste (reset completo
#      + reseed), para não deixar as outras suítes num estado parcial.
#
# Como rodar (requer Docker Desktop e Supabase CLI):
#   bash supabase/tests/migration-upgrade-check.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

MIGRATIONS_DIR="supabase/migrations"
STASH_DIR="$(mktemp -d)"

# Sempre devolve 0003/0004/0005/0006 para o lugar antes de limpar o
# diretório temporário, mesmo se o script falhar no meio — nunca deixa
# os arquivos de migração "presos" só no stash.
restore_migrations() {
  for f in 0003_recovery_session.sql 0004_account_audit.sql 0005_catalog.sql 0006_orders.sql; do
    if [ -f "$STASH_DIR/$f" ]; then
      mv "$STASH_DIR/$f" "$MIGRATIONS_DIR/"
    fi
  done
  rm -rf "$STASH_DIR"
}
trap restore_migrations EXIT

echo "==> Movendo 0003/0004/0005/0006 para fora de supabase/migrations/ (simula estado pós-0002)"
mv "$MIGRATIONS_DIR/0003_recovery_session.sql" "$STASH_DIR/"
mv "$MIGRATIONS_DIR/0004_account_audit.sql" "$STASH_DIR/"
mv "$MIGRATIONS_DIR/0005_catalog.sql" "$STASH_DIR/"
mv "$MIGRATIONS_DIR/0006_orders.sql" "$STASH_DIR/"

echo "==> supabase db reset (só 0001+0002)"
npx supabase db reset --local

echo "==> Inserindo múltiplos eventos históricos variados (todos os action/combinações permitidos pela 0002)"
# Quarta correção pós-QA (revisão externa sobre
# qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md, Ponto 10): "eventos
# históricos variados, não somente uma linha" — cobre store_id
# preenchido/nulo, actor_id preenchido/nulo, details vazio/preenchido,
# e os principais action values que a 0002 já permitia (inclusive os
# dois que a aplicação nunca escreveu, signup_completed/
# password_recovery_requested, mas que precisam continuar válidos para
# uma linha histórica pré-existente).
docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  insert into public.stores (id, slug, name, status)
  values ('11111111-1111-4111-8111-111111111111', 'loja-historica-upgrade', 'Loja Histórica Upgrade', 'active');
"
HISTORICAL_IDS_RAW=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -q -t -A -c "
  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata, created_at) values
    (null, null, 'signup_completed', 'auth_user', 'historico-signup-1', '{}'::jsonb, now() - interval '10 days'),
    (null, null, 'password_recovery_requested', 'auth_user', 'historico-recovery-req-1', '{}'::jsonb, now() - interval '9 days'),
    ('22222222-2222-4222-8222-222222222222', null, 'email_verification_completed', 'auth_user', '22222222-2222-4222-8222-222222222222', '{}'::jsonb, now() - interval '8 days'),
    ('22222222-2222-4222-8222-222222222222', null, 'password_recovery_completed', 'auth_user', '22222222-2222-4222-8222-222222222222', '{\"note\":\"historico com details preenchido\"}'::jsonb, now() - interval '7 days'),
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'store_created', 'store', '11111111-1111-4111-8111-111111111111', '{}'::jsonb, now() - interval '6 days'),
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'owner_assigned', 'store', '11111111-1111-4111-8111-111111111111', '{}'::jsonb, now() - interval '5 days'),
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'plan_selected', 'store', '11111111-1111-4111-8111-111111111111', '{\"plan_code\":50}'::jsonb, now() - interval '4 days'),
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'onboarding_completed', 'store', '11111111-1111-4111-8111-111111111111', '{}'::jsonb, now() - interval '3 days'),
    (null, null, 'access_denied', 'store', 'historico-access-denied-1', '{\"reason\":\"nao_autenticado\"}'::jsonb, now() - interval '2 days')
  returning id;
")
HISTORICAL_IDS=$(echo "$HISTORICAL_IDS_RAW" | tr -d ' ')
HISTORICAL_COUNT=$(echo "$HISTORICAL_IDS_RAW" | grep -c '.')
echo "    $HISTORICAL_COUNT linhas históricas inseridas (9 action values distintos, store_id/actor_id/details variados)"

echo "==> Devolvendo 0003/0004 para supabase/migrations/ (0005 continua fora por enquanto)"
mv "$STASH_DIR/0003_recovery_session.sql" "$MIGRATIONS_DIR/"
mv "$STASH_DIR/0004_account_audit.sql" "$MIGRATIONS_DIR/"

echo "==> supabase migration up (aplica 0003+0004 SOBRE o banco com dado histórico, sem reset)"
npx supabase migration up --local

echo "==> Verificando: TODAS as 9 linhas históricas variadas sobreviveram intactas (actions/store_id/actor_id/details/timestamps inalterados)"
SURVIVED_COUNT=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from public.audit_log where id::text = any(string_to_array('$HISTORICAL_IDS', E'\n'));
")
if [ "$SURVIVED_COUNT" != "$HISTORICAL_COUNT" ]; then
  echo "FAIL - nem todas as linhas históricas sobreviveram intactas (esperado $HISTORICAL_COUNT, obtido $SURVIVED_COUNT)"
  exit 1
fi
echo "PASS - todas as $SURVIVED_COUNT linhas históricas variadas sobreviveram intactas ao upgrade da 0002 para o schema final"

SPECIFIC_CHECK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from public.audit_log
    where target_id = 'historico-signup-1' and action = 'signup_completed' and actor_user_id is null and store_id is null
  union all
  select count(*) from public.audit_log
    where target_id = '11111111-1111-4111-8111-111111111111' and action = 'plan_selected' and metadata = '{\"plan_code\":50}'::jsonb;
" | tr '\n' ',')
if [ "$SPECIFIC_CHECK" != "1,1," ]; then
  echo "FAIL - valores específicos (action/actor_user_id/store_id/metadata) de linhas históricas mudaram silenciosamente (esperado 1,1, obtido $SPECIFIC_CHECK)"
  exit 1
fi
echo "PASS - actions/actor_user_id/store_id/metadata das linhas históricas conferem exatamente (nenhuma alteração silenciosa)"

echo "==> Verificando: schema final (password_recovery_grants, funções) existe e responde"
# Terceira correção pós-QA (qa/reports/TASK-002-CLAUDE-VERIFICATION.md,
# BUG-CLAUDE-001): auth_flow_grants/consume_auth_flow_grant/
# request_password_recovery_grant foram removidos por completo —
# substituídos por issue_password_recovery_grant (só service_role) +
# claim_recovery_grant_for_password_change(nonce) +
# is_current_session_recovery_grant(). Quinta correção pós-QA (revisão
# externa sobre qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md,
# BUG-CLAUDE-VERIF3-001): a trigger automática
# handle_password_recovery_completion()/on_auth_user_password_changed foi
# REMOVIDA por completo — substituída por complete_password_recovery_attempt(),
# explícita/server-only, que também precisa sobreviver ao upgrade.
FUNCS_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from pg_proc
    where proname in ('issue_password_recovery_grant', 'claim_recovery_grant_for_password_change', 'is_current_session_recovery_grant', 'handle_email_confirmed_audit', 'complete_password_recovery_attempt');
")
if [ "$FUNCS_OK" != "5" ]; then
  echo "FAIL - nem todas as funções da 0003/0004 existem após o upgrade (esperado 5, obtido $FUNCS_OK)"
  exit 1
fi
echo "PASS - as 5 funções de password_recovery_grants/auditoria de confirmação/conclusão existem após o upgrade"

OLD_TRIGGER_GONE=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from pg_trigger where tgname = 'on_auth_user_password_changed' and not tgisinternal;
")
if [ "$OLD_TRIGGER_GONE" != "0" ]; then
  echo "FAIL - trigger antiga on_auth_user_password_changed (BUG-CLAUDE-VERIF3-001, removida nesta correção) ainda existe após o upgrade (esperado 0, obtido $OLD_TRIGGER_GONE)"
  exit 1
fi
echo "PASS - trigger antiga on_auth_user_password_changed não sobrevive ao upgrade (conclusão automática removida)"

ACTIVE_INDEX_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from pg_indexes where indexname = 'password_recovery_grants_one_active_per_user';
")
if [ "$ACTIVE_INDEX_OK" != "1" ]; then
  echo "FAIL - indice unico parcial password_recovery_grants_one_active_per_user nao existe apos o upgrade (esperado 1, obtido $ACTIVE_INDEX_OK)"
  exit 1
fi
echo "PASS - indice unico parcial password_recovery_grants_one_active_per_user existe apos o upgrade"

ACTION_CHECK_WIDENED=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select pg_get_constraintdef(oid) from pg_constraint where conname = 'audit_log_action_check';
")
for expected_action in password_recovery_authorization_claimed password_recovery_grant_issued password_recovery_revoked signup_completed; do
  if ! echo "$ACTION_CHECK_WIDENED" | grep -q "$expected_action"; then
    echo "FAIL - audit_log_action_check não inclui $expected_action após o upgrade"
    exit 1
  fi
done
echo "PASS - audit_log_action_check foi alargado (password_recovery_grant_issued/password_recovery_revoked) sem perder nenhum valor histórico"

OLD_FUNCS_GONE=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from pg_proc
    where proname in ('consume_auth_flow_grant', 'request_password_recovery_grant', 'handle_new_user_confirmation_grant', 'handle_password_recovery_completion');
")
if [ "$OLD_FUNCS_GONE" != "0" ]; then
  echo "FAIL - funções antigas do desenho vulnerável (BUG-CLAUDE-001/BUG-CLAUDE-VERIF3-001) ainda existem após o upgrade (esperado 0, obtido $OLD_FUNCS_GONE)"
  exit 1
fi
echo "PASS - nenhuma função antiga (consume_auth_flow_grant/request_password_recovery_grant/handle_new_user_confirmation_grant/handle_password_recovery_completion) sobrevive ao upgrade"

RESTRICT_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select confdeltype from pg_constraint where conname = 'audit_log_store_id_fkey';
")
if [ "$(echo "$RESTRICT_OK" | tr -d '[:space:]')" != "r" ]; then
  echo "FAIL - audit_log_store_id_fkey não está como ON DELETE RESTRICT após o upgrade (confdeltype='$RESTRICT_OK', esperado 'r')"
  exit 1
fi
echo "PASS - audit_log.store_id está ON DELETE RESTRICT após o upgrade"

echo "==> TASK-003: simulando o estado real da master atual (0001-0004 aplicadas, TASK-002 concluída)"
# Insere eventos históricos no estilo TASK-002 (0004 já aplicada nesta
# altura) ANTES de trazer a 0005 — é exatamente o estado real da
# master no momento em que a TASK-003 começou (b7e10c3, ver
# docs/handoff.md).
TASK002_STYLE_IDS_RAW=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -q -t -A -c "
  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata, created_at) values
    ('22222222-2222-4222-8222-222222222222', null, 'password_recovery_grant_issued', 'auth_user', 'historico-recovery-issued-1', '{}'::jsonb, now() - interval '1 day'),
    ('22222222-2222-4222-8222-222222222222', null, 'password_recovery_authorization_claimed', 'auth_user', 'historico-recovery-claimed-1', '{}'::jsonb, now() - interval '1 day')
  returning id;
")
TASK002_STYLE_IDS=$(echo "$TASK002_STYLE_IDS_RAW" | tr -d ' ')
TASK002_STYLE_COUNT=$(echo "$TASK002_STYLE_IDS_RAW" | grep -c '.')
echo "    $TASK002_STYLE_COUNT linhas históricas adicionais (estilo TASK-002, pós-0004) inseridas"

echo "==> Devolvendo 0005 para supabase/migrations/"
mv "$STASH_DIR/0005_catalog.sql" "$MIGRATIONS_DIR/"

echo "==> supabase migration up (aplica 0005 SOBRE o banco com TODO o histórico anterior, sem reset)"
npx supabase migration up --local

echo "==> Verificando: histórico completo (0002 + TASK-002) sobrevive intacto ao upgrade da TASK-003"
ALL_HISTORICAL_IDS="$HISTORICAL_IDS
$TASK002_STYLE_IDS"
ALL_HISTORICAL_COUNT=$((HISTORICAL_COUNT + TASK002_STYLE_COUNT))
SURVIVED_ALL=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from public.audit_log where id::text = any(string_to_array('$ALL_HISTORICAL_IDS', E'\n'));
")
if [ "$SURVIVED_ALL" != "$ALL_HISTORICAL_COUNT" ]; then
  echo "FAIL - histórico incompleto sobreviveu ao upgrade da TASK-003 (esperado $ALL_HISTORICAL_COUNT, obtido $SURVIVED_ALL)"
  exit 1
fi
echo "PASS - todo o histórico (0002 + TASK-002, $SURVIVED_ALL linhas) sobreviveu intacto ao upgrade da TASK-003"

CATALOG_SCHEMA_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from pg_proc
    where proname in ('catalog_create_category', 'catalog_update_category', 'catalog_set_category_active',
      'catalog_create_product', 'catalog_update_product', 'catalog_set_product_status', 'catalog_adjust_stock',
      'catalog_add_product_image', 'catalog_remove_product_image', 'catalog_set_cover_image', 'catalog_move_product_image');
")
if [ "$CATALOG_SCHEMA_OK" != "11" ]; then
  echo "FAIL - nem todas as 11 funções catalog_* existem após o upgrade (esperado 11, obtido $CATALOG_SCHEMA_OK)"
  exit 1
fi
echo "PASS - as 11 funções catalog_* existem após o upgrade"

CATALOG_TABLES_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('categories', 'product_images');
")
if [ "$CATALOG_TABLES_OK" != "2" ]; then
  echo "FAIL - tabelas categories/product_images não existem após o upgrade (esperado 2, obtido $CATALOG_TABLES_OK)"
  exit 1
fi
echo "PASS - tabelas categories/product_images existem após o upgrade"

BUCKET_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from storage.buckets where id = 'product-images' and public = true;
")
if [ "$BUCKET_OK" != "1" ]; then
  echo "FAIL - bucket product-images não existe/não está público após o upgrade (esperado 1, obtido $BUCKET_OK)"
  exit 1
fi
echo "PASS - bucket product-images existe e está público após o upgrade"

CATALOG_ACTION_CHECK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select pg_get_constraintdef(oid) from pg_constraint where conname = 'audit_log_action_check';
")
for expected_action in category_created product_created product_stock_adjusted product_image_added password_recovery_authorization_claimed signup_completed; do
  if ! echo "$CATALOG_ACTION_CHECK" | grep -q "$expected_action"; then
    echo "FAIL - audit_log_action_check não inclui $expected_action após o upgrade da TASK-003"
    exit 1
  fi
done
echo "PASS - audit_log_action_check inclui os eventos de catálogo sem perder nenhum valor histórico anterior"

PRODUCTS_EXTENDED_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name in ('category_id', 'slug', 'price_cents', 'sku', 'status');
")
if [ "$PRODUCTS_EXTENDED_OK" != "5" ]; then
  echo "FAIL - products não foi estendida corretamente após o upgrade (esperado 5 colunas novas, obtido $PRODUCTS_EXTENDED_OK)"
  exit 1
fi
echo "PASS - public.products foi estendida em ALTER TABLE (nunca recriada) — colunas novas presentes após o upgrade"

echo "==> TASK-004: simulando o estado real da master atual (0001-0005 aplicadas, TASK-003 concluída)"
# Insere eventos históricos no estilo TASK-003 (0005 já aplicada nesta
# altura) ANTES de trazer a 0006 — é exatamente o estado real da master
# no momento em que a TASK-004 começou (66d9760, ver docs/handoff.md).
TASK003_STYLE_IDS_RAW=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -q -t -A -c "
  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata, created_at) values
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'product_created', 'product', 'historico-produto-1', '{}'::jsonb, now() - interval '12 hours'),
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'product_stock_adjusted', 'product', 'historico-produto-1', '{\"delta\":-3,\"new_stock\":7}'::jsonb, now() - interval '11 hours')
  returning id;
")
TASK003_STYLE_IDS=$(echo "$TASK003_STYLE_IDS_RAW" | tr -d ' ')
TASK003_STYLE_COUNT=$(echo "$TASK003_STYLE_IDS_RAW" | grep -c '.')
echo "    $TASK003_STYLE_COUNT linhas históricas adicionais (estilo TASK-003, pós-0005) inseridas"

echo "==> Devolvendo 0006 para supabase/migrations/"
mv "$STASH_DIR/0006_orders.sql" "$MIGRATIONS_DIR/"

echo "==> supabase migration up (aplica 0006 SOBRE o banco com TODO o histórico anterior, sem reset)"
npx supabase migration up --local

echo "==> Verificando: histórico completo (0002 + TASK-002 + TASK-003) sobrevive intacto ao upgrade da TASK-004"
ALL_HISTORICAL_IDS_V2="$ALL_HISTORICAL_IDS
$TASK003_STYLE_IDS"
ALL_HISTORICAL_COUNT_V2=$((ALL_HISTORICAL_COUNT + TASK003_STYLE_COUNT))
SURVIVED_ALL_V2=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from public.audit_log where id::text = any(string_to_array('$ALL_HISTORICAL_IDS_V2', E'\n'));
")
if [ "$SURVIVED_ALL_V2" != "$ALL_HISTORICAL_COUNT_V2" ]; then
  echo "FAIL - histórico incompleto sobreviveu ao upgrade da TASK-004 (esperado $ALL_HISTORICAL_COUNT_V2, obtido $SURVIVED_ALL_V2)"
  exit 1
fi
echo "PASS - todo o histórico (0002 + TASK-002 + TASK-003, $SURVIVED_ALL_V2 linhas) sobreviveu intacto ao upgrade da TASK-004"

ORDERS_SCHEMA_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from pg_proc
    where proname in ('can_view_store_orders', 'can_manage_store_orders', 'create_order', 'order_advance_status', 'order_cancel');
")
if [ "$ORDERS_SCHEMA_OK" != "5" ]; then
  echo "FAIL - nem todas as 5 funções de pedidos existem após o upgrade (esperado 5, obtido $ORDERS_SCHEMA_OK)"
  exit 1
fi
echo "PASS - as 5 funções de pedidos (can_view_store_orders/can_manage_store_orders/create_order/order_advance_status/order_cancel) existem após o upgrade"

ORDERS_TABLES_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('orders', 'order_items');
")
if [ "$ORDERS_TABLES_OK" != "2" ]; then
  echo "FAIL - tabelas orders/order_items não existem após o upgrade (esperado 2, obtido $ORDERS_TABLES_OK)"
  exit 1
fi
echo "PASS - tabelas orders/order_items existem após o upgrade"

ORDERS_ACTION_CHECK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select pg_get_constraintdef(oid) from pg_constraint where conname = 'audit_log_action_check';
")
for expected_action in order_created order_status_changed order_cancelled order_stock_reserved order_stock_restored category_created product_stock_adjusted signup_completed; do
  if ! echo "$ORDERS_ACTION_CHECK" | grep -q "$expected_action"; then
    echo "FAIL - audit_log_action_check não inclui $expected_action após o upgrade da TASK-004"
    exit 1
  fi
done
echo "PASS - audit_log_action_check inclui os eventos de pedido sem perder nenhum valor histórico anterior"

ORDERS_NO_DIRECT_GRANT=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from information_schema.role_table_grants
    where table_schema='public' and table_name in ('orders','order_items') and grantee='authenticated'
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
")
if [ "$ORDERS_NO_DIRECT_GRANT" != "0" ]; then
  echo "FAIL - authenticated tem GRANT de escrita direta em orders/order_items após o upgrade (esperado 0, obtido $ORDERS_NO_DIRECT_GRANT)"
  exit 1
fi
echo "PASS - authenticated não tem nenhum GRANT de escrita direta em orders/order_items após o upgrade"

echo "==> Restaurando o ambiente para o estado normal de teste (reset completo + reseed)"
npx supabase db reset --local
npm run seed:local

echo ""
echo "PASS - upgrade real desde a migration 0002 (com dados históricos, TASK-002, TASK-003 e TASK-004) até o schema final: sem erro, dado histórico preservado, schema final funcional."
