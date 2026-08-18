-- TASK-012 — Regressão: nenhuma tabela nova pode conceder escrita
-- (nem TRUNCATE) a anon/authenticated.
--
-- Existe porque as nove migrations da TASK-012 esqueceram o
-- `revoke all ... from public, anon, authenticated, service_role` que
-- todas as migrations anteriores fazem, e o DEFAULT do Supabase
-- concedeu TRUNCATE — que **ignora RLS** — a qualquer conta autenticada.
-- Reproduzido: `truncate table public.app_sessions` funcionava para um
-- usuário sem vínculo com loja nenhuma.
--
-- Uso:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/table_grants_check.sql

\set ON_ERROR_STOP on
begin;

-- ============================================================
-- Caso 1: nenhum privilégio perigoso nas tabelas do TASK-012
-- ============================================================
do $t$
declare r record; v_bad integer := 0;
begin
  for r in
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      and table_name in (
        'platform_plans','workspaces','workspace_subscriptions','workspace_members',
        'workspace_invitations','app_sessions','app_session_policy','coupons','coupon_redemptions'
      )
  loop
    raise warning 'privilegio indevido: % tem % em %', r.grantee, r.privilege_type, r.table_name;
    v_bad := v_bad + 1;
  end loop;

  if v_bad > 0 then
    raise exception 'FAIL: % privilegio(s) de escrita/TRUNCATE em tabelas do TASK-012', v_bad;
  end if;
  raise notice 'PASS - tabelas do TASK-012 nao concedem INSERT/UPDATE/DELETE/TRUNCATE a anon nem authenticated';
end;
$t$;

-- ============================================================
-- Caso 2: as leituras que as telas dependem continuam funcionando
-- ============================================================
do $t$
declare r record; v_missing integer := 0;
begin
  for r in
    select * from (values
      ('platform_plans','anon'), ('platform_plans','authenticated'),
      ('workspaces','authenticated'), ('workspace_subscriptions','authenticated'),
      ('workspace_members','authenticated'), ('workspace_invitations','authenticated'),
      ('app_sessions','authenticated'), ('coupons','authenticated'),
      ('coupon_redemptions','authenticated')
    ) as t(tbl, role_name)
  loop
    if not exists (
      select 1 from information_schema.role_table_grants g
      where g.table_schema='public' and g.table_name=r.tbl
        and g.grantee=r.role_name and g.privilege_type='SELECT'
    ) then
      raise warning 'SELECT ausente: % em %', r.role_name, r.tbl;
      v_missing := v_missing + 1;
    end if;
  end loop;

  if v_missing > 0 then
    raise exception 'FAIL: % leitura(s) necessaria(s) foram revogadas junto', v_missing;
  end if;
  raise notice 'PASS - as leituras que as telas usam continuam concedidas';
end;
$t$;

-- ============================================================
-- Caso 3: TRUNCATE realmente recusado (o exploit original)
-- ============================================================
savepoint antes_truncate;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
do $t$
declare v_ok boolean;
begin
  -- Conta autenticada QUALQUER, sem vinculo com loja nenhuma.
  foreach v_ok in array array[true] loop
    begin
      execute 'truncate table public.app_sessions';
      raise exception 'FAIL: truncate em app_sessions passou (destruicao cross-tenant)';
    exception
      when insufficient_privilege then null;
    end;

    begin
      execute 'truncate table public.workspace_invitations';
      raise exception 'FAIL: truncate em workspace_invitations passou';
    exception
      when insufficient_privilege then null;
    end;

    begin
      execute 'insert into public.coupons (store_id, code, normalized_code, discount_type, discount_value)
               values (gen_random_uuid(), ''X'', ''XXX'', ''percentage'', 1000)';
      raise exception 'FAIL: INSERT direto em coupons passou';
    exception
      when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'PASS - TRUNCATE e INSERT diretos recusados para authenticated sem vinculo';
end;
$t$;
rollback to savepoint antes_truncate;

do $t$ begin raise notice 'OK: privilegios de tabela do TASK-012 conferidos'; end; $t$;

rollback;
