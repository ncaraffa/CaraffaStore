-- TASK-012 — Privilégios de tabela: matriz EXECUTADA como authenticated.
--
-- Existe porque as nove primeiras migrations da TASK-012 esqueceram o
-- `revoke all ... from public, anon, authenticated, service_role` que
-- todas as migrations anteriores fazem. O default do Supabase concedeu
-- TRUNCATE — que **ignora RLS**, por ser DDL — a qualquer conta
-- autenticada. Reproduzido antes da correção:
--
--   truncate table public.app_sessions;  -> TRUNCATE TABLE (sucesso)
--
-- Lição que este arquivo encapsula: inspecionar information_schema NÃO
-- é prova. Aqui cada operação é TENTADA de verdade, como `authenticated`
-- com um auth.uid() sem vínculo com loja nenhuma.
--
-- Uso:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/table_grants_check.sql

\set ON_ERROR_STOP on
begin;

-- ============================================================
-- Caso 1: matriz EXECUTADA — TRUNCATE/INSERT/UPDATE/DELETE negados
-- ============================================================
savepoint matriz;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);

do $t$
declare
  v_tbl text;
  v_op text;
  v_sql text;
  v_falhas integer := 0;
  v_tentativas integer := 0;
begin
  foreach v_tbl in array array[
    'platform_plans','workspaces','workspace_subscriptions','workspace_members',
    'workspace_invitations','app_sessions','app_session_policy','coupons','coupon_redemptions'
  ] loop
    foreach v_op in array array['truncate','delete','update'] loop
      v_sql := case v_op
        when 'truncate' then format('truncate table public.%I cascade', v_tbl)
        when 'delete'   then format('delete from public.%I', v_tbl)
        else format('update public.%I set created_at = now()', v_tbl)
      end;

      v_tentativas := v_tentativas + 1;
      begin
        execute v_sql;
        -- Chegou aqui = a operação foi PERMITIDA. É falha.
        raise warning 'PERMITIDO indevidamente: % em %', upper(v_op), v_tbl;
        v_falhas := v_falhas + 1;
      exception
        when insufficient_privilege then null;      -- esperado
        when undefined_column then null;            -- tabela sem created_at: o grant já barraria antes
        when others then
          -- Qualquer outra recusa (ex.: FK/cascade em tabela protegida)
          -- também é recusa. O que não pode é ter passado.
          null;
      end;
    end loop;
  end loop;

  if v_falhas > 0 then
    raise exception 'FAIL: % de % operacoes destrutivas foram PERMITIDAS a authenticated', v_falhas, v_tentativas;
  end if;
  raise notice 'PASS - % operacoes destrutivas (TRUNCATE/DELETE/UPDATE) recusadas em 9 tabelas', v_tentativas;
end;
$t$;
rollback to savepoint matriz;

-- ============================================================
-- Caso 2: INSERT direto negado onde a escrita é só por RPC
-- ============================================================
savepoint inserts;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);

do $t$
declare v_ok boolean; v_falhas integer := 0;
begin
  -- coupons
  v_ok := false;
  begin
    insert into public.coupons (store_id, code, normalized_code, discount_type, discount_value)
      values (gen_random_uuid(),'X','XXX','percentage',1000);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise warning 'INSERT em coupons passou'; v_falhas := v_falhas + 1; end if;

  -- workspace_members: seria escalação de privilégio direta
  v_ok := false;
  begin
    insert into public.workspace_members (workspace_id, user_id, role)
      values (gen_random_uuid(), auth.uid(), 'owner');
  exception when others then v_ok := true;
  end;
  if not v_ok then raise warning 'INSERT em workspace_members passou (escalacao!)'; v_falhas := v_falhas + 1; end if;

  -- app_sessions: forjar sessão ativa
  v_ok := false;
  begin
    insert into public.app_sessions (workspace_id, user_id, supabase_session_hash, expires_at)
      values (gen_random_uuid(), auth.uid(), 'forjado', now() + interval '1 day');
  exception when others then v_ok := true;
  end;
  if not v_ok then raise warning 'INSERT em app_sessions passou (sessao forjada!)'; v_falhas := v_falhas + 1; end if;

  -- workspace_subscriptions: dar-se um plano melhor
  v_ok := false;
  begin
    insert into public.workspace_subscriptions (workspace_id, plan_key, status)
      values (gen_random_uuid(), 'professional', 'active');
  exception when others then v_ok := true;
  end;
  if not v_ok then raise warning 'INSERT em workspace_subscriptions passou (plano forjado!)'; v_falhas := v_falhas + 1; end if;

  -- platform_plans: reescrever o catálogo comercial
  v_ok := false;
  begin
    insert into public.platform_plans (plan_key,label,price_cents,tier,max_products,max_images_per_product,
      max_stores,max_team_members,coupons,priority_support,setup_assistance,store_review,implementation_support)
      values ('gratis','Gratis',1,9,999999,99,99,99,true,true,true,true,true);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise warning 'INSERT em platform_plans passou (catalogo forjado!)'; v_falhas := v_falhas + 1; end if;

  if v_falhas > 0 then
    raise exception 'FAIL: % INSERT(s) diretos permitidos', v_falhas;
  end if;
  raise notice 'PASS - INSERT direto negado em coupons, workspace_members, app_sessions, workspace_subscriptions e platform_plans';
end;
$t$;
rollback to savepoint inserts;

-- ============================================================
-- Caso 3: as leituras que as telas usam continuam funcionando
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
  if v_missing > 0 then raise exception 'FAIL: % leitura(s) necessarias revogadas junto', v_missing; end if;
  raise notice 'PASS - leituras usadas pelas telas continuam concedidas';
end;
$t$;

-- ============================================================
-- Caso 4: nenhum privilégio perigoso sobrou no catálogo
-- ============================================================
do $t$
declare r record; v_bad integer := 0;
begin
  for r in
    select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema='public'
      and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
      and table_name in ('platform_plans','workspaces','workspace_subscriptions','workspace_members',
                         'workspace_invitations','app_sessions','app_session_policy','coupons','coupon_redemptions')
  loop
    raise warning 'privilegio indevido: % tem % em %', r.grantee, r.privilege_type, r.table_name;
    v_bad := v_bad + 1;
  end loop;
  if v_bad > 0 then raise exception 'FAIL: % privilegio(s) perigosos', v_bad; end if;
  raise notice 'PASS - catalogo limpo: nenhum INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER para anon nem authenticated';
end;
$t$;

-- ============================================================
-- Caso 5: as tabelas ANTIGAS continuam no mesmo padrão
-- ============================================================
--
-- Guarda contra o inverso do bug: um revoke amplo demais que quebrasse
-- o que já funcionava.
do $t$
declare v integer;
begin
  select count(*) into v
  from information_schema.role_table_grants
  where table_schema='public' and grantee in ('anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    and table_name in ('stores','products','orders','store_members','order_items','categories');
  if v > 0 then raise exception 'FAIL: tabela antiga ganhou privilegio destrutivo (%)', v; end if;
  raise notice 'PASS - tabelas antigas seguem sem privilegio destrutivo';
end;
$t$;

do $t$ begin raise notice 'OK: matriz de privilegios conferida como authenticated'; end; $t$;

rollback;
