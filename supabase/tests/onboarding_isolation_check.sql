-- Validação manual das políticas de RLS e das funções de onboarding da
-- TASK-002 contra Postgres real. Mesmo padrão/estrutura de
-- supabase/tests/isolation_check.sql (TASK-001) — ver aquele arquivo para
-- a explicação completa de BEGIN/SAVEPOINT/ROLLBACK e por que isso é
-- necessário (BUG-002/RETEST-BUG-001, qa/reports/TASK-001*.md).
--
-- Diferente daquele arquivo, este NÃO precisa de substituição manual de
-- UUID colado do terminal: todos os IDs necessários são resolvidos UMA
-- vez, logo no início, enquanto a sessão ainda é `postgres`
-- (superusuário — enxerga auth.users e todas as lojas sem RLS), e
-- guardados em GUCs de transação (`set_config('app.*', ..., true)`).
-- Cada cenário lê esses valores via `current_setting('app.*')`, o que
-- funciona independente do role/RLS ativo no momento (GUC não é
-- permissão de tabela). Isso evita dois problemas: (a) psql não
-- interpola `:'variavel'` dentro de blocos `do $$ ... $$` (dollar-quoted)
-- e (b) depois de trocar para `authenticated`, consultas a auth.users ou
-- a lojas alheias esbarrariam em "permission denied"/RLS antes mesmo de
-- montar o cenário do teste.
--
-- Como rodar (requer Docker Desktop e os fixtures da TASK-002 já
-- seedados — ver scripts/seed-local.ts):
--   1. npx supabase start
--   2. npx supabase db reset
--   3. npm run seed:local
--   4. psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/onboarding_isolation_check.sql
--
-- 26 cenários (16 originais + 5 da primeira correção pós-QA,
-- qa/reports/TASK-002.md, + 10 da segunda correção pós-QA,
-- qa/reports/TASK-002-RETEST.md) cobrindo: isolamento de
-- onboarding_progress/merchant_profiles/store_plans entre usuários e
-- entre lojas, múltiplos memberships, audit_log inacessível para
-- anon/authenticated, escrita direta forjada em stores/store_members
-- bloqueada (sem GRANT), plano forjado rejeitado pela função, slug
-- bloqueado após conclusão, idempotência do retry, anon bloqueado em
-- TODAS as 7 funções onboarding_* (Caso 16 — RESSALVA-T2-001).
--
-- Casos 17–25 (segunda correção pós-QA, qa/reports/TASK-002-RETEST.md):
-- `public.auth_flow_grants` (substitui `recovery_grants`) não pode ser
-- inserida/alterada diretamente por `authenticated` (BUG-RT2-001);
-- pedido pendente sozinho não concede acesso; tentativa de
-- auto-fabricação via `consume_auth_flow_grant` sem pedido pendente
-- falha e não grava auditoria; grant expirado falha; grant consumido
-- não pode ser reutilizado (BUG-RT2-002); sessão de um usuário não
-- consome o grant de outro; reivindicar a troca de senha sem ter
-- consumido antes falha; ciclo completo pendente→consumido→reivindicado
-- confere em cada etapa; falha obrigatória de auditoria propaga exceção
-- e desfaz também o consumo do grant (atomicidade real, não
-- "consultar-depois-agir" — BUG-RT2-005); `ON DELETE RESTRICT` bloqueia
-- exclusão de loja com histórico de auditoria associado
-- (RESSALVA-RT2-001, antes `ON DELETE SET NULL` alterava um evento
-- histórico indiretamente).
--
-- Caso 26: audit_log verdadeiramente append-only (nem authenticated nem
-- service_role alteram/apagam — BUG-T2-004/BUG-RT2-006).
--
-- Trocas de código PKCE entre /auth/confirm e /auth/recovery
-- (BUG-RT2-003/004) e concorrência real de duas trocas de senha
-- simultâneas (BUG-RT2-002) exigem múltiplas sessões HTTP reais e
-- independentes — não cabem neste script de uma única sessão psql; ver
-- supabase/tests/auth-flow-purpose-check.ts e
-- supabase/tests/recovery-claim-concurrency-check.ts.

\set ON_ERROR_STOP on

begin;

-- Resolve todos os IDs necessários UMA vez, como postgres (superusuário),
-- antes de qualquer troca de role — ver explicação acima.
do $$
begin
  perform set_config('app.admin_a_id', (select id::text from auth.users where email = 'admin-a@example.test'), true);
  perform set_config('app.merchant_onboarding_id', (select id::text from auth.users where email = 'merchant-onboarding@example.test'), true);
  perform set_config('app.merchant_pending_id', (select id::text from auth.users where email = 'merchant-pending@example.test'), true);
  perform set_config('app.merchant_multi_id', (select id::text from auth.users where email = 'merchant-multi@example.test'), true);
  perform set_config('app.pending_store_id', (select id::text from public.stores where slug = 'loja-pendente-fixture'), true);

  if current_setting('app.admin_a_id', true) is null
    or current_setting('app.merchant_onboarding_id', true) is null
    or current_setting('app.merchant_pending_id', true) is null
    or current_setting('app.merchant_multi_id', true) is null
    or current_setting('app.pending_store_id', true) is null then
    raise exception 'SETUP FALHOU: rode "npm run seed:local" antes deste script (algum fixture da TASK-002 nao foi encontrado)';
  end if;
end $$;

-- ------------------------------------------------------------
-- Caso 1: merchant-onboarding lê o próprio onboarding_progress -> 1 linha
-- ------------------------------------------------------------
savepoint case_1;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_onboarding_id'))::text, true);

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.onboarding_progress;
  if qtd = 1 then
    raise notice 'PASS - Caso 1: usuario le o proprio onboarding_progress (1 linha)';
  else
    raise exception 'FAIL - Caso 1: esperado 1 linha, obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_1;

-- ------------------------------------------------------------
-- Caso 2: merchant-onboarding tenta ler onboarding_progress de
-- merchant-pending FILTRANDO EXPLICITAMENTE pelo user_id alheio -> 0
-- linhas (RLS bloqueia mesmo com o filtro "certo" no WHERE — prova que
-- um user_id forjado na consulta não basta para ver dado de outro
-- usuário)
-- ------------------------------------------------------------
savepoint case_2;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_onboarding_id'))::text, true);

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.onboarding_progress where user_id = current_setting('app.merchant_pending_id')::uuid;
  if qtd = 0 then
    raise notice 'PASS - Caso 2: onboarding_progress de outro usuario nao visivel mesmo filtrando pelo user_id dele';
  else
    raise exception 'FAIL - Caso 2: esperado 0, obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_2;

-- ------------------------------------------------------------
-- Caso 3: merchant-pending lê o próprio merchant_profiles -> 1 linha
-- ------------------------------------------------------------
savepoint case_3;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.merchant_profiles;
  if qtd = 1 then
    raise notice 'PASS - Caso 3: usuario le o proprio merchant_profiles (1 linha)';
  else
    raise exception 'FAIL - Caso 3: esperado 1 linha, obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_3;

-- ------------------------------------------------------------
-- Caso 4: merchant-onboarding NÃO lê merchant_profiles de merchant-pending
-- ------------------------------------------------------------
savepoint case_4;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_onboarding_id'))::text, true);

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.merchant_profiles where user_id = current_setting('app.merchant_pending_id')::uuid;
  if qtd = 0 then
    raise notice 'PASS - Caso 4: merchant_profiles de outro usuario nao visivel';
  else
    raise exception 'FAIL - Caso 4: esperado 0, obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_4;

-- ------------------------------------------------------------
-- Caso 5: merchant-pending (owner da loja-pendente-fixture) lê o
-- próprio store_plans -> 1 linha, plan_code = 30
-- ------------------------------------------------------------
savepoint case_5;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);

do $$
declare
  qtd int;
  plano int;
begin
  select count(*), max(plan_code) into qtd, plano from public.store_plans;
  if qtd = 1 and plano = 30 then
    raise notice 'PASS - Caso 5: owner le o plano da propria loja (plan_code=30)';
  else
    raise exception 'FAIL - Caso 5: esperado 1 linha com plan_code=30, obtido % linha(s), plano=%', qtd, plano;
  end if;
end $$;
rollback to savepoint case_5;

-- ------------------------------------------------------------
-- Caso 6: admin-a (membro de store-a, NAO de loja-pendente-fixture) NÃO
-- lê o store_plans da loja-pendente-fixture -> 0 linhas (isolamento
-- cross-tenant também vale para store_plans, não só para products)
-- ------------------------------------------------------------
savepoint case_6;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.admin_a_id'))::text, true);

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.store_plans where store_id = current_setting('app.pending_store_id')::uuid;
  if qtd = 0 then
    raise notice 'PASS - Caso 6: admin-a nao ve o plano da loja-pendente-fixture (loja alheia)';
  else
    raise exception 'FAIL - Caso 6: esperado 0, obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_6;

-- ------------------------------------------------------------
-- Caso 7: merchant-multi (owner da loja-multi-fixture E staff de
-- store-a) lê store_plans de AMBAS as lojas -> 2 linhas (múltiplos
-- memberships concedem acesso a cada loja vinculada, não só a uma)
-- ------------------------------------------------------------
savepoint case_7;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_multi_id'))::text, true);

do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.store_plans;
  if qtd = 2 then
    raise notice 'PASS - Caso 7: usuario com multiplos memberships ve o plano das 2 lojas vinculadas';
  else
    raise exception 'FAIL - Caso 7: esperado 2 linhas (loja propria + store-a como staff), obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_7;

-- ------------------------------------------------------------
-- Caso 8: anônimo não lê onboarding_progress, merchant_profiles,
-- store_plans nem audit_log (nenhum GRANT concedido a anon)
-- ------------------------------------------------------------
savepoint case_8;
set local role anon;
select set_config('request.jwt.claims', '', true);

do $$
declare
  qtd int;
begin
  begin
    select count(*) into qtd from public.onboarding_progress;
  exception when insufficient_privilege then qtd := 0; end;
  if qtd != 0 then raise exception 'FAIL - Caso 8a: anonimo leu onboarding_progress'; end if;

  begin
    select count(*) into qtd from public.merchant_profiles;
  exception when insufficient_privilege then qtd := 0; end;
  if qtd != 0 then raise exception 'FAIL - Caso 8b: anonimo leu merchant_profiles'; end if;

  begin
    select count(*) into qtd from public.store_plans;
  exception when insufficient_privilege then qtd := 0; end;
  if qtd != 0 then raise exception 'FAIL - Caso 8c: anonimo leu store_plans'; end if;

  begin
    select count(*) into qtd from public.audit_log;
  exception when insufficient_privilege then qtd := 0; end;
  if qtd != 0 then raise exception 'FAIL - Caso 8d: anonimo leu audit_log'; end if;

  raise notice 'PASS - Caso 8: anonimo bloqueado em onboarding_progress/merchant_profiles/store_plans/audit_log';
end $$;
rollback to savepoint case_8;

-- ------------------------------------------------------------
-- Caso 9: nem authenticated consegue ler audit_log, só service_role
-- (nenhum GRANT de select concedido)
-- ------------------------------------------------------------
savepoint case_9;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);

do $$
begin
  begin
    perform count(*) from public.audit_log;
    raise exception 'FAIL - Caso 9: authenticated conseguiu ler audit_log (deveria ser permission denied)';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 9: authenticated bloqueado em audit_log (sem GRANT de select)';
  end;
end $$;
rollback to savepoint case_9;

-- ------------------------------------------------------------
-- Caso 10: authenticated tenta INSERT direto em stores (bypass da
-- função onboarding_complete) -> bloqueado por falta de GRANT
-- ------------------------------------------------------------
savepoint case_10;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_onboarding_id'))::text, true);

do $$
begin
  begin
    insert into public.stores (slug, name, status) values ('loja-forjada-direto', 'Loja Forjada', 'active');
    raise exception 'FAIL - Caso 10: insert direto em stores deveria ter sido bloqueado';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 10: insert direto em stores bloqueado (sem GRANT insert para authenticated)';
  end;
end $$;
rollback to savepoint case_10;

-- ------------------------------------------------------------
-- Caso 11: authenticated tenta INSERT direto em store_members com
-- role='owner' e store_id de uma loja alheia -> bloqueado (owner_id/
-- role forjados não passam sem a função)
-- ------------------------------------------------------------
savepoint case_11;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_onboarding_id'))::text, true);

do $$
begin
  begin
    insert into public.store_members (store_id, user_id, role)
      values (current_setting('app.pending_store_id')::uuid, current_setting('app.merchant_onboarding_id')::uuid, 'owner');
    raise exception 'FAIL - Caso 11: insert direto em store_members deveria ter sido bloqueado';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 11: insert direto em store_members bloqueado (role/owner forjados sem efeito)';
  end;
end $$;
rollback to savepoint case_11;

-- ------------------------------------------------------------
-- Caso 12: authenticated tenta UPDATE direto em stores.status (ex.:
-- forjar ativação sem pagamento) -> bloqueado (sem GRANT update)
-- ------------------------------------------------------------
savepoint case_12;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);

do $$
begin
  begin
    update public.stores set status = 'active' where id = current_setting('app.pending_store_id')::uuid;
    raise exception 'FAIL - Caso 12: update direto de status deveria ter sido bloqueado';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 12: update direto de stores.status bloqueado (sem GRANT update para authenticated)';
  end;
end $$;
rollback to savepoint case_12;

-- ------------------------------------------------------------
-- Caso 13: onboarding_save_plan com código forjado fora de 30|50|80 ->
-- rejeitado (não é uma checagem só de UI, é validação no servidor/banco).
-- A função valida o FORMATO do plano antes de checar os pré-requisitos
-- da etapa anterior — por isso o erro observado na prática é
-- invalid_plan (não slug_required, apesar de merchant-onboarding ainda
-- não ter slug definido nesta fixture). O teste aceita qualquer um dos
-- dois códigos como PASS de propósito: o que este caso prova é que 999
-- é SEMPRE rejeitado, nunca aceito — não a ordem interna exata de
-- validação, que é detalhe de implementação e não deveria quebrar o
-- teste se mudar.
-- ------------------------------------------------------------
savepoint case_13;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_onboarding_id'))::text, true);

do $$
begin
  begin
    perform public.onboarding_save_plan(999);
    raise exception 'FAIL - Caso 13: onboarding_save_plan(999) deveria ter sido rejeitado';
  exception
    when others then
      if sqlerrm in ('slug_required', 'invalid_plan') then
        raise notice 'PASS - Caso 13: onboarding_save_plan(999) rejeitado (%)', sqlerrm;
      else
        raise;
      end if;
  end;
end $$;
rollback to savepoint case_13;

-- ------------------------------------------------------------
-- Caso 14: merchant-pending (onboarding já concluído) tenta alterar o
-- slug -> bloqueado por onboarding_already_completed (T2-DEC-009: slug
-- editável durante o onboarding, bloqueado após a conclusão)
-- ------------------------------------------------------------
savepoint case_14;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);

do $$
begin
  begin
    perform public.onboarding_save_slug('novo-slug-pos-conclusao');
    raise exception 'FAIL - Caso 14: alterar slug apos conclusao deveria ter sido bloqueado';
  exception
    when others then
      if sqlerrm = 'onboarding_already_completed' then
        raise notice 'PASS - Caso 14: slug bloqueado apos conclusao do onboarding';
      else
        raise;
      end if;
  end;
end $$;
rollback to savepoint case_14;

-- ------------------------------------------------------------
-- Caso 15: merchant-pending (já é owner) chama onboarding_complete()
-- de novo -> idempotente, devolve a MESMA loja, não cria uma segunda
-- ------------------------------------------------------------
savepoint case_15;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);

do $$
declare
  resultado_slug text;
  qtd_memberships int;
begin
  select slug into resultado_slug from public.onboarding_complete();
  select count(*) into qtd_memberships
    from public.store_members
    where user_id = current_setting('app.merchant_pending_id')::uuid and role = 'owner';

  if resultado_slug = 'loja-pendente-fixture' and qtd_memberships = 1 then
    raise notice 'PASS - Caso 15: retry de onboarding_complete() e idempotente (mesma loja, 1 membership owner)';
  else
    raise exception 'FAIL - Caso 15: esperado slug=loja-pendente-fixture e 1 membership, obtido slug=%, memberships=%', resultado_slug, qtd_memberships;
  end if;
end $$;
rollback to savepoint case_15;

-- ------------------------------------------------------------
-- Caso 16: anônimo não consegue executar NENHUMA das 7 funções
-- onboarding_* (sem GRANT EXECUTE) — testa as 7 de verdade, não só uma
-- (RESSALVA-T2-001, qa/reports/TASK-002.md: o comentário anterior
-- alegava cobrir "qualquer função onboarding_*" mas só chamava
-- onboarding_ensure_progress()).
-- ------------------------------------------------------------
savepoint case_16;
set local role anon;
select set_config('request.jwt.claims', '', true);

do $$
begin
  begin
    perform public.onboarding_ensure_progress();
    raise exception 'FAIL - Caso 16: anonimo executou onboarding_ensure_progress()';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 16a: anonimo bloqueado em onboarding_ensure_progress()';
  end;

  begin
    perform public.onboarding_save_profile('Forjado', '+5511900000000');
    raise exception 'FAIL - Caso 16: anonimo executou onboarding_save_profile()';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 16b: anonimo bloqueado em onboarding_save_profile()';
  end;

  begin
    perform public.onboarding_save_store_name('Loja Forjada');
    raise exception 'FAIL - Caso 16: anonimo executou onboarding_save_store_name()';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 16c: anonimo bloqueado em onboarding_save_store_name()';
  end;

  begin
    perform public.onboarding_save_slug('slug-forjado-anon');
    raise exception 'FAIL - Caso 16: anonimo executou onboarding_save_slug()';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 16d: anonimo bloqueado em onboarding_save_slug()';
  end;

  begin
    perform public.onboarding_save_plan(30);
    raise exception 'FAIL - Caso 16: anonimo executou onboarding_save_plan()';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 16e: anonimo bloqueado em onboarding_save_plan()';
  end;

  begin
    perform public.onboarding_complete();
    raise exception 'FAIL - Caso 16: anonimo executou onboarding_complete()';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 16f: anonimo bloqueado em onboarding_complete()';
  end;

  begin
    perform public.is_slug_available('qualquer-slug');
    raise exception 'FAIL - Caso 16: anonimo executou is_slug_available()';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 16g: anonimo bloqueado em is_slug_available()';
  end;
end $$;
rollback to savepoint case_16;

-- ------------------------------------------------------------
-- Caso 17: authenticated não consegue INSERT direto em
-- auth_flow_grants — nenhum GRANT de tabela concedido, mesmo para a
-- própria linha (BUG-RT2-001, qa/reports/TASK-002-RETEST.md: a versão
-- anterior concedia INSERT via RLS "user_id = auth.uid()", permitindo
-- que qualquer sessão comum fabricasse o próprio grant).
-- ------------------------------------------------------------
savepoint case_17;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_onboarding_id'))::text, true);

do $$
begin
  begin
    insert into public.auth_flow_grants (user_id, purpose, expires_at)
      values (current_setting('app.merchant_onboarding_id')::uuid, 'password_recovery', now() + interval '30 minutes');
    raise exception 'FAIL - Caso 17: insert direto em auth_flow_grants deveria ter sido bloqueado';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 17: authenticated nao consegue inserir diretamente em auth_flow_grants (sem GRANT de tabela)';
  end;
end $$;
rollback to savepoint case_17;

-- ------------------------------------------------------------
-- Caso 18: request_password_recovery_grant() sozinha NÃO concede acesso
-- a /reset-password — só marca um pedido pendente (consumed_at null).
-- ------------------------------------------------------------
savepoint case_18;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ begin perform public.request_password_recovery_grant('merchant-pending@example.test'); end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', '11111111-1111-4111-8111-111111111111')::text,
  true
);
do $$
declare
  v_active boolean;
begin
  select public.is_current_session_recovery_grant() into v_active;
  if v_active = false then
    raise notice 'PASS - Caso 18: pedido pendente sozinho nao concede acesso a reset-password (consumed_at continua null)';
  else
    raise exception 'FAIL - Caso 18: pedido pendente sozinho concedeu acesso indevidamente';
  end if;
end $$;
rollback to savepoint case_18;

-- ------------------------------------------------------------
-- Caso 19: tentativa de auto-fabricação — sessão comum chama
-- consume_auth_flow_grant('password_recovery') SEM nenhum pedido
-- pendente correspondente -> false, e nenhuma linha de auditoria é
-- gravada (BUG-RT2-001/BUG-RT2-005).
-- ------------------------------------------------------------
savepoint case_19;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.admin_a_id'), 'session_id', '22222222-2222-4222-8222-222222222222')::text,
  true
);
do $$
declare
  v_result boolean;
begin
  select public.consume_auth_flow_grant('password_recovery') into v_result;
  if v_result = false then
    raise notice 'PASS - Caso 19a: consume_auth_flow_grant sem pedido pendente correspondente devolve false (auto-fabricacao bloqueada)';
  else
    raise exception 'FAIL - Caso 19a: consume_auth_flow_grant deveria ter devolvido false';
  end if;
end $$;
reset role;
do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.audit_log
    where actor_user_id = current_setting('app.admin_a_id')::uuid and action = 'password_recovery_completed';
  if qtd = 0 then
    raise notice 'PASS - Caso 19b: nenhuma linha de auditoria fabricada por uma tentativa sem grant pendente';
  else
    raise exception 'FAIL - Caso 19b: esperado 0 eventos fabricados, obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_19;

-- ------------------------------------------------------------
-- Caso 20: grant expirado é rejeitado por consume_auth_flow_grant.
-- ------------------------------------------------------------
savepoint case_20;
insert into public.auth_flow_grants (user_id, purpose, expires_at)
  values (current_setting('app.merchant_multi_id')::uuid, 'password_recovery', now() - interval '1 minute')
  on conflict (user_id, purpose) do update
    set expires_at = excluded.expires_at, consumed_at = null, session_id = null, id = gen_random_uuid(), created_at = now();

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_multi_id'), 'session_id', '33333333-3333-4333-8333-333333333333')::text,
  true
);
do $$
declare
  v_result boolean;
begin
  select public.consume_auth_flow_grant('password_recovery') into v_result;
  if v_result = false then
    raise notice 'PASS - Caso 20: grant expirado e rejeitado por consume_auth_flow_grant';
  else
    raise exception 'FAIL - Caso 20: grant expirado deveria ter sido rejeitado';
  end if;
end $$;
rollback to savepoint case_20;

-- ------------------------------------------------------------
-- Caso 21: grant consumido não pode ser reutilizado — segunda chamada a
-- consume_auth_flow_grant com o mesmo pedido devolve false
-- (BUG-RT2-002).
-- ------------------------------------------------------------
savepoint case_21;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ begin perform public.request_password_recovery_grant('merchant-multi@example.test'); end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_multi_id'), 'session_id', '44444444-4444-4444-8444-444444444444')::text,
  true
);
do $$
declare
  v_first boolean;
  v_second boolean;
begin
  select public.consume_auth_flow_grant('password_recovery') into v_first;
  select public.consume_auth_flow_grant('password_recovery') into v_second;
  if v_first = true and v_second = false then
    raise notice 'PASS - Caso 21: grant consumido uma vez nao pode ser consumido de novo (segunda chamada devolve false)';
  else
    raise exception 'FAIL - Caso 21: esperado true depois false, obtido %/%', v_first, v_second;
  end if;
end $$;
rollback to savepoint case_21;

-- ------------------------------------------------------------
-- Caso 22: sessão de um usuário não consegue consumir o pedido pendente
-- de OUTRO usuário (usuário incompatível).
-- ------------------------------------------------------------
savepoint case_22;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ begin perform public.request_password_recovery_grant('merchant-pending@example.test'); end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_onboarding_id'), 'session_id', '55555555-5555-4555-8555-555555555555')::text,
  true
);
do $$
declare
  v_result boolean;
begin
  select public.consume_auth_flow_grant('password_recovery') into v_result;
  if v_result = false then
    raise notice 'PASS - Caso 22: sessao de um usuario nao consegue consumir o grant pendente de outro usuario';
  else
    raise exception 'FAIL - Caso 22: consumo deveria ter falhado (usuario incompativel)';
  end if;
end $$;
rollback to savepoint case_22;

-- ------------------------------------------------------------
-- Caso 23: reivindicar a troca de senha sem ter consumido o grant antes
-- falha; ciclo completo pendente(false) -> consumido(true) ->
-- reivindicado(false de novo, linha removida) confere em cada etapa.
-- ------------------------------------------------------------
savepoint case_23;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', '66666666-6666-4666-8666-666666666666')::text,
  true
);
do $$
declare
  v_claim boolean;
begin
  select public.claim_recovery_grant_for_password_change() into v_claim;
  if v_claim = false then
    raise notice 'PASS - Caso 23a: reivindicar a troca de senha sem ter consumido o grant antes falha';
  else
    raise exception 'FAIL - Caso 23a: claim sem consumo previo deveria ter falhado';
  end if;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ begin perform public.request_password_recovery_grant('merchant-pending@example.test'); end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', '66666666-6666-4666-8666-666666666666')::text,
  true
);
do $$
declare
  v_before boolean;
  v_consumed boolean;
  v_after boolean;
  v_claimed boolean;
  v_final boolean;
begin
  select public.is_current_session_recovery_grant() into v_before;
  select public.consume_auth_flow_grant('password_recovery') into v_consumed;
  select public.is_current_session_recovery_grant() into v_after;
  select public.claim_recovery_grant_for_password_change() into v_claimed;
  select public.is_current_session_recovery_grant() into v_final;

  if v_before = false and v_consumed = true and v_after = true and v_claimed = true and v_final = false then
    raise notice 'PASS - Caso 23b: ciclo completo pendente(false) -> consumido(true) -> reivindicado(false de novo) confere em cada etapa';
  else
    raise exception 'FAIL - Caso 23b: esperado false/true/true/true/false, obtido %/%/%/%/%', v_before, v_consumed, v_after, v_claimed, v_final;
  end if;
end $$;
rollback to savepoint case_23;

-- ------------------------------------------------------------
-- Caso 24: falha obrigatória de auditoria impede a operação sensível —
-- um gatilho de teste bloqueia o INSERT em audit_log; a chamada inteira
-- de consume_auth_flow_grant precisa propagar a exceção (não engolir) E
-- desfazer também o UPDATE do grant (rollback completo da função, não
-- só do insert). Reaproveita o pedido de confirmação de e-mail que já
-- nasce pendente para merchant-onboarding (criado automaticamente pelo
-- trigger em auth.users no momento do seed, nunca consumido).
-- ------------------------------------------------------------
savepoint case_24;
create or replace function public.__test_block_audit_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'blocked_for_test';
end;
$$;
create trigger __test_block_audit_insert_trigger
  before insert on public.audit_log
  for each row execute function public.__test_block_audit_insert();

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_onboarding_id'), 'session_id', '77777777-7777-4777-8777-777777777777')::text,
  true
);
do $$
begin
  begin
    perform public.consume_auth_flow_grant('email_confirmation');
    raise exception 'FAIL - Caso 24a: consume_auth_flow_grant deveria ter falhado (gatilho de teste bloqueou o insert em audit_log)';
  exception
    when others then
      if sqlerrm = 'blocked_for_test' then
        raise notice 'PASS - Caso 24a: falha obrigatoria da auditoria propaga a excecao (nao e engolida)';
      else
        raise;
      end if;
  end;
end $$;

reset role;
do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.auth_flow_grants
    where user_id = current_setting('app.merchant_onboarding_id')::uuid
      and purpose = 'email_confirmation'
      and consumed_at is null;
  if qtd = 1 then
    raise notice 'PASS - Caso 24b: falha na auditoria desfez tambem o UPDATE do grant (consumed_at continua null — rollback completo, nao so do insert)';
  else
    raise exception 'FAIL - Caso 24b: esperado 1 grant ainda pendente (rollback completo), obtido %', qtd;
  end if;
end $$;
-- rollback to savepoint desfaz o gatilho/funcao de teste tambem (DDL e transacional).
rollback to savepoint case_24;

-- ------------------------------------------------------------
-- Caso 25: ON DELETE RESTRICT bloqueia a exclusão de uma loja com
-- histórico de auditoria associado — não altera silenciosamente o
-- evento histórico (RESSALVA-RT2-001: antes, ON DELETE SET NULL
-- mutava store_id para NULL numa linha de auditoria já gravada).
-- ------------------------------------------------------------
savepoint case_25;
do $$
declare
  v_temp_store_id uuid;
begin
  insert into public.stores (slug, name, status)
    values ('loja-teste-restrict-fk', 'Loja Teste Restrict FK', 'onboarding')
    returning id into v_temp_store_id;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (current_setting('app.merchant_onboarding_id')::uuid, v_temp_store_id, 'store_created', 'store', v_temp_store_id::text, '{}'::jsonb);

  begin
    delete from public.stores where id = v_temp_store_id;
    raise exception 'FAIL - Caso 25: exclusao de loja com historico de auditoria deveria ter sido bloqueada (ON DELETE RESTRICT)';
  exception
    when foreign_key_violation then
      raise notice 'PASS - Caso 25: ON DELETE RESTRICT bloqueou a exclusao da loja — evento historico de auditoria nao pode ser alterado nem indiretamente';
  end;
end $$;
rollback to savepoint case_25;

-- ------------------------------------------------------------
-- Caso 26: audit_log é append-only de verdade — nem authenticated nem
-- service_role conseguem UPDATE/DELETE.
-- ------------------------------------------------------------
savepoint case_26;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);
do $$
begin
  begin
    update public.audit_log set metadata = '{}'::jsonb;
    raise exception 'FAIL - Caso 26a: authenticated conseguiu UPDATE em audit_log';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 26a: authenticated bloqueado em UPDATE audit_log';
  end;
end $$;
reset role;
set local role service_role;
do $$
begin
  begin
    update public.audit_log set metadata = '{}'::jsonb;
    raise exception 'FAIL - Caso 26b: service_role conseguiu UPDATE em audit_log';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 26b: service_role tambem bloqueado em UPDATE audit_log (append-only real, nem uso administrativo altera)';
  end;
  begin
    delete from public.audit_log;
    raise exception 'FAIL - Caso 26c: service_role conseguiu DELETE em audit_log';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 26c: service_role tambem bloqueado em DELETE audit_log';
  end;
end $$;
rollback to savepoint case_26;

-- Nenhuma alteração persiste: garante execução repetível a qualquer momento.
rollback;
