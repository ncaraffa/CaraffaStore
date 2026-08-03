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

# Sempre devolve 0003/0004 para o lugar antes de limpar o diretório
# temporário, mesmo se o script falhar no meio — nunca deixa os
# arquivos de migração "presos" só no stash.
restore_migrations() {
  if [ -f "$STASH_DIR/0003_recovery_session.sql" ]; then
    mv "$STASH_DIR/0003_recovery_session.sql" "$MIGRATIONS_DIR/"
  fi
  if [ -f "$STASH_DIR/0004_account_audit.sql" ]; then
    mv "$STASH_DIR/0004_account_audit.sql" "$MIGRATIONS_DIR/"
  fi
  rm -rf "$STASH_DIR"
}
trap restore_migrations EXIT

echo "==> Movendo 0003/0004 para fora de supabase/migrations/ (simula estado pós-0002)"
mv "$MIGRATIONS_DIR/0003_recovery_session.sql" "$STASH_DIR/"
mv "$MIGRATIONS_DIR/0004_account_audit.sql" "$STASH_DIR/"

echo "==> supabase db reset (só 0001+0002)"
npx supabase db reset --local

echo "==> Inserindo linha histórica real (action='signup_completed', só válida sob a 0002)"
HISTORICAL_ID=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -q -t -A -c "
  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (null, null, 'signup_completed', 'auth_user', 'historico-teste-upgrade', '{}'::jsonb)
  returning id;
" | head -1)
echo "    id da linha histórica: $HISTORICAL_ID"

echo "==> Devolvendo 0003/0004 para supabase/migrations/"
mv "$STASH_DIR/0003_recovery_session.sql" "$MIGRATIONS_DIR/"
mv "$STASH_DIR/0004_account_audit.sql" "$MIGRATIONS_DIR/"

echo "==> supabase migration up (aplica 0003+0004 SOBRE o banco com dado histórico, sem reset)"
npx supabase migration up --local

echo "==> Verificando: linha histórica sobreviveu intacta"
SURVIVED=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from public.audit_log
    where id = '$HISTORICAL_ID' and action = 'signup_completed' and target_id = 'historico-teste-upgrade';
")
if [ "$SURVIVED" != "1" ]; then
  echo "FAIL - linha histórica não sobreviveu intacta ao upgrade (esperado 1, obtido $SURVIVED)"
  exit 1
fi
echo "PASS - linha histórica com action='signup_completed' sobreviveu intacta ao upgrade da 0002 para o schema final"

echo "==> Verificando: schema final (auth_flow_grants, funções) existe e responde"
FUNCS_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select count(*) from pg_proc
    where proname in ('consume_auth_flow_grant', 'claim_recovery_grant_for_password_change', 'is_current_session_recovery_grant', 'request_password_recovery_grant');
")
if [ "$FUNCS_OK" != "4" ]; then
  echo "FAIL - nem todas as funções da 0003 existem após o upgrade (esperado 4, obtido $FUNCS_OK)"
  exit 1
fi
echo "PASS - as 4 funções de auth_flow_grants existem após o upgrade"

RESTRICT_OK=$(docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -t -A -c "
  select confdeltype from pg_constraint where conname = 'audit_log_store_id_fkey';
")
if [ "$(echo "$RESTRICT_OK" | tr -d '[:space:]')" != "r" ]; then
  echo "FAIL - audit_log_store_id_fkey não está como ON DELETE RESTRICT após o upgrade (confdeltype='$RESTRICT_OK', esperado 'r')"
  exit 1
fi
echo "PASS - audit_log.store_id está ON DELETE RESTRICT após o upgrade"

echo "==> Restaurando o ambiente para o estado normal de teste (reset completo + reseed)"
npx supabase db reset --local
npm run seed:local

echo ""
echo "PASS - upgrade real desde a migration 0002 (com dados históricos) até o schema final: sem erro, dado histórico preservado, schema final funcional."
