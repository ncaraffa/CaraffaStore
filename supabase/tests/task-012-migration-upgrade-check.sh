#!/usr/bin/env bash
# TASK-012 — Upgrade real de um banco LEGADO (pós-0011) para o modelo de
# planos/entitlements. Mesmo padrão de migration-upgrade-check.sh: não
# basta `supabase db reset` e concluir que a migration está boa; o que
# importa é aplicá-la SOBRE um banco já populado com clientes reais.
#
#   1. Move 0012/0013/0014 para fora de supabase/migrations/.
#   2. `supabase db reset` — aplica 0001..0011 (estado "histórico").
#   3. Insere três comerciantes legados (plan_code 30/50/80) e uma
#      cobrança APROVADA de R$70 do cliente do código 80.
#   4. Devolve 0012/0013/0014.
#   5. `supabase migration up` — upgrade sobre o banco populado.
#   6. Verifica: mapeamento 30/50/80 -> essential/growth/professional,
#      Profissional continua R$70, cobrança histórica INTACTA, uma
#      assinatura por workspace, entitlements corretos, e o cadastro
#      NOVO (onboarding_complete) funcionando com workspace_id NOT NULL.
#
# Uso: bash supabase/tests/task-012-migration-upgrade-check.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

MIGRATIONS_DIR="supabase/migrations"
STASH_DIR="$(mktemp -d)"
PSQL="docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -v ON_ERROR_STOP=1"

NEW_MIGRATIONS="0012_plan_entitlements.sql 0013_workspace_subscription.sql 0014_quota_enforcement.sql 0015_workspace_team.sql 0016_app_sessions.sql 0017_app_session_by_store.sql 0018_session_fail_closed.sql"

restore_migrations() {
  for f in $NEW_MIGRATIONS; do
    if [ -f "$STASH_DIR/$f" ]; then mv "$STASH_DIR/$f" "$MIGRATIONS_DIR/"; fi
  done
  rm -rf "$STASH_DIR"
}
trap restore_migrations EXIT

echo "==> Movendo 0012..0018 para fora (simula estado pós-0011)"
for f in $NEW_MIGRATIONS; do mv "$MIGRATIONS_DIR/$f" "$STASH_DIR/"; done

echo "==> supabase db reset (aplica 0001..0011)"
npx supabase db reset --local >/dev/null

echo "==> Inserindo comerciantes legados (plan_code 30/50/80) + cobrança aprovada de R\$70"
$PSQL -q <<'SQL'
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy-ess@upgrade.test','x',now(),now(),now()),
  ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy-gro@upgrade.test','x',now(),now(),now()),
  ('33333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy-pro@upgrade.test','x',now(),now(),now());

insert into public.stores (id, slug, name, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001','legacy-ess','Legado Essencial','active'),
  ('aaaaaaaa-0000-4000-8000-000000000002','legacy-gro','Legado Crescimento','active'),
  ('aaaaaaaa-0000-4000-8000-000000000003','legacy-pro','Legado Profissional','active');

insert into public.store_members (store_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','owner'),
  ('aaaaaaaa-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','owner'),
  ('aaaaaaaa-0000-4000-8000-000000000003','33333333-3333-4333-8333-333333333333','owner');

insert into public.store_plans (store_id, plan_code) values
  ('aaaaaaaa-0000-4000-8000-000000000001',30),
  ('aaaaaaaa-0000-4000-8000-000000000002',50),
  ('aaaaaaaa-0000-4000-8000-000000000003',80);

insert into public.billing_charges (
  store_id, plan_code, amount_cents, provider_idempotency_key, external_reference,
  status, payer_email, payer_doc_type, payer_doc_last4, period_start, period_end, approved_at
) values (
  'aaaaaaaa-0000-4000-8000-000000000003', 80, 7000, 'idem-upgrade-1', 'ext-upgrade-1',
  'approved','legacy-pro@upgrade.test','CPF','4321', now() - interval '10 days', now() + interval '20 days', now() - interval '10 days'
);
SQL

CHARGE_BEFORE=$($PSQL -q -t -A -c "select amount_cents || '|' || status || '|' || approved_at from public.billing_charges where external_reference='ext-upgrade-1';")
echo "    cobrança histórica antes do upgrade: $CHARGE_BEFORE"

echo "==> Devolvendo 0012..0018 e aplicando migration up (SEM reset)"
for f in $NEW_MIGRATIONS; do mv "$STASH_DIR/$f" "$MIGRATIONS_DIR/"; done
npx supabase migration up --local >/dev/null

echo "==> Verificando"
$PSQL -q <<'SQL'
do $t$
declare v_key text; v int; v_ws uuid;
begin
  -- mapeamento legado
  select plan_key into v_key from public.store_plans where store_id='aaaaaaaa-0000-4000-8000-000000000001';
  if v_key <> 'essential' then raise exception 'FAIL: 30 -> % (esperado essential)', v_key; end if;
  select plan_key into v_key from public.store_plans where store_id='aaaaaaaa-0000-4000-8000-000000000002';
  if v_key <> 'growth' then raise exception 'FAIL: 50 -> %', v_key; end if;
  select plan_key into v_key from public.store_plans where store_id='aaaaaaaa-0000-4000-8000-000000000003';
  if v_key <> 'professional' then raise exception 'FAIL: 80 -> %', v_key; end if;
  raise notice 'PASS - 30/50/80 -> essential/growth/professional';

  -- Profissional continua R$70
  if public.platform_plan_price_cents('professional') <> 7000 then
    raise exception 'FAIL: professional deixou de custar R$70';
  end if;
  raise notice 'PASS - Profissional continua R$70 (7000 centavos)';

  -- uma assinatura por workspace, plano preservado
  select workspace_id into v_ws from public.stores where id='aaaaaaaa-0000-4000-8000-000000000003';
  select count(*) into v from public.workspace_subscriptions where workspace_id = v_ws;
  if v <> 1 then raise exception 'FAIL: % assinaturas para o workspace', v; end if;
  select plan_key into v_key from public.workspace_subscriptions where workspace_id = v_ws;
  if v_key <> 'professional' then raise exception 'FAIL: assinatura migrada errada (%)', v_key; end if;
  raise notice 'PASS - uma assinatura por workspace, plano preservado';

  -- entitlements batem com a tabela comercial
  select max_products into v from public.store_entitlements('aaaaaaaa-0000-4000-8000-000000000001');
  if v <> 75 then raise exception 'FAIL: essential max_products=%', v; end if;
  select max_products into v from public.store_entitlements('aaaaaaaa-0000-4000-8000-000000000002');
  if v <> 350 then raise exception 'FAIL: growth max_products=%', v; end if;
  select max_images_per_product into v from public.store_entitlements('aaaaaaaa-0000-4000-8000-000000000003');
  if v <> 10 then raise exception 'FAIL: professional max_images=%', v; end if;
  raise notice 'PASS - entitlements conferem com a tabela comercial';

  -- backfill de equipe: cada owner legado vira UM assento, nunca vários
  select count(*) into v from public.workspace_members;
  if v <> 3 then raise exception 'FAIL: esperava 3 assentos (um por comerciante legado), got %', v; end if;
  select count(*) into v from public.workspace_members where role = 'owner';
  if v <> 3 then raise exception 'FAIL: owners legados nao viraram owner do workspace'; end if;
  raise notice 'PASS - backfill de equipe: 1 assento por comerciante legado, todos owner';

  -- Sessões: a tabela nasce vazia e NINGUÉM perde acesso por causa dela.
  -- app_session_denied() nega apenas quem TEM linha revogada; os JWTs em
  -- circulação no momento do deploy não têm linha nenhuma, então o
  -- upgrade não vira logout global.
  select count(*) into v from public.app_sessions;
  if v <> 0 then raise exception 'FAIL: upgrade criou % sessoes do nada', v; end if;

  -- O cutover é gravado NA APLICAÇÃO da migration, não hardcoded.
  if public.app_session_enforced_from() is null then
    raise exception 'FAIL: cutover da sessao nao foi registrado';
  end if;
  if public.app_session_enforced_from() > now() then
    raise exception 'FAIL: cutover no futuro — a compatibilidade nunca fecharia';
  end if;

  -- Compatibilidade de rollout: um JWT emitido ANTES do cutover ainda
  -- passa (para o deploy não deslogar quem estava no meio de algo);
  -- um emitido DEPOIS, sem sessão registrada, é negado. Como todo
  -- refresh emite iat novo, o primeiro caso deixa de existir sozinho
  -- em no máximo um ciclo de token.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111',
    'session_id', gen_random_uuid()::text,
    'iat', extract(epoch from public.app_session_enforced_from())::bigint - 60
  )::text, true);
  if public.app_session_denied() then
    raise exception 'FAIL: JWT anterior ao cutover foi negado (viraria logout global no deploy)';
  end if;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', '11111111-1111-4111-8111-111111111111',
    'session_id', gen_random_uuid()::text,
    'iat', extract(epoch from now())::bigint
  )::text, true);
  if not public.app_session_denied() then
    raise exception 'FAIL: JWT posterior ao cutover SEM sessao foi permitido (bypass)';
  end if;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS - cutover: JWT pre-corte tolerado, JWT pos-corte sem sessao NEGADO';
  select max_concurrent_sessions into v from public.platform_plans where plan_key='essential';
  if v <> 1 then raise exception 'FAIL: essential max_concurrent_sessions=%', v; end if;
  if (select max_concurrent_sessions from public.platform_plans where plan_key='growth') is not null then
    raise exception 'FAIL: growth ganhou limite de sessao (restricao inventada)';
  end if;
  raise notice 'PASS - app_sessions nao derruba quem ja estava logado; so o Essencial limita sessao';
end;
$t$;
SQL

CHARGE_AFTER=$($PSQL -q -t -A -c "select amount_cents || '|' || status || '|' || approved_at from public.billing_charges where external_reference='ext-upgrade-1';")
echo "    cobrança histórica depois do upgrade: $CHARGE_AFTER"
if [ "$CHARGE_BEFORE" != "$CHARGE_AFTER" ]; then
  echo "FAIL: a cobrança histórica foi alterada pelo upgrade"
  exit 1
fi
echo "PASS - cobrança histórica INTACTA (valor, status e data de aprovação idênticos)"

echo "==> Cadastro NOVO após o upgrade (regressão workspace_id NOT NULL)"
$PSQL -q <<'SQL'
do $t$
declare v_store public.stores; v_ws uuid; v_sub public.workspace_subscriptions;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values ('44444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','novo@upgrade.test','x',now(),now(),now());

  perform set_config('request.jwt.claims', json_build_object('sub','44444444-4444-4444-8444-444444444444')::text, true);

  perform public.onboarding_ensure_progress();
  perform public.onboarding_save_profile('Comerciante Novo', '11999998888');
  perform public.onboarding_save_store_name('Loja Nova');
  perform public.onboarding_save_slug('loja-nova-upgrade');
  perform public.onboarding_save_plan(50);
  select * into v_store from public.onboarding_complete();

  if v_store.workspace_id is null then
    raise exception 'FAIL: loja nova nasceu sem workspace_id';
  end if;
  select * into v_sub from public.workspace_subscriptions where workspace_id = v_store.workspace_id;
  if v_sub.id is null then raise exception 'FAIL: cadastro novo nao criou assinatura'; end if;
  if v_sub.plan_key <> 'growth' then raise exception 'FAIL: assinatura nova com plano % (esperado growth)', v_sub.plan_key; end if;
  if v_sub.status <> 'pending_payment' then raise exception 'FAIL: assinatura nova ja nasceu %', v_sub.status; end if;
  raise notice 'PASS - cadastro novo cria workspace + assinatura (pending_payment) + loja';
end;
$t$;
SQL

echo
echo "==> Restaurando ambiente de teste (reset + reseed)"
npx supabase db reset --local >/dev/null
npm run seed:local --silent >/dev/null 2>&1 || true

echo "OK: upgrade legado -> TASK-012 validado de ponta a ponta"
