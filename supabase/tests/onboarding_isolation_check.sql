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
-- 21 cenários (16 originais + 5 adicionados na correção pós-QA,
-- qa/reports/TASK-002.md) cobrindo: isolamento de onboarding_progress/
-- merchant_profiles/store_plans entre usuários e entre lojas, múltiplos
-- memberships, audit_log inacessível para anon/authenticated, escrita
-- direta forjada em stores/store_members bloqueada (sem GRANT), plano
-- forjado rejeitado pela função, slug bloqueado após conclusão,
-- idempotência do retry, anon bloqueado em TODAS as 7 funções
-- onboarding_* (Caso 16 — RESSALVA-T2-001), session_id de
-- recovery_grants protegido por CHECK contra o JWT (Casos 17–19), e
-- audit_log verdadeiramente append-only + funções de auditoria de conta
-- sem ator forjável (Casos 20–21 — BUG-T2-004).

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
-- Caso 17: recovery_grants — session_id é sempre preenchido a partir do
-- JWT da própria requisição (DEFAULT), nunca precisa vir do cliente
-- (correção do BUG-T2-002/003, qa/reports/TASK-002.md).
-- ------------------------------------------------------------
savepoint case_17;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('app.merchant_onboarding_id'),
    'session_id', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  )::text,
  true
);

do $$
declare
  v_session_id uuid;
begin
  insert into public.recovery_grants (user_id) values (current_setting('app.merchant_onboarding_id')::uuid);
  select session_id into v_session_id from public.recovery_grants where user_id = current_setting('app.merchant_onboarding_id')::uuid;

  if v_session_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' then
    raise notice 'PASS - Caso 17: session_id de recovery_grants preenchido automaticamente a partir do JWT';
  else
    raise exception 'FAIL - Caso 17: session_id esperado aaaaaaaa..., obtido %', v_session_id;
  end if;
end $$;
rollback to savepoint case_17;

-- ------------------------------------------------------------
-- Caso 18: tentativa de forjar session_id explicitamente no INSERT de
-- recovery_grants -> bloqueada pelo CHECK constraint, não pelo DEFAULT
-- sozinho (o DEFAULT só protege quando a coluna é omitida — testado
-- durante o desenvolvimento que um valor explícito o contorna sem o
-- CHECK).
-- ------------------------------------------------------------
savepoint case_18;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('app.merchant_onboarding_id'),
    'session_id', 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
  )::text,
  true
);

do $$
begin
  begin
    insert into public.recovery_grants (user_id, session_id)
      values (current_setting('app.merchant_onboarding_id')::uuid, 'cccccccc-3333-4333-8333-cccccccccccc');
    raise exception 'FAIL - Caso 18: insert com session_id forjado explicitamente foi aceito';
  exception
    when check_violation then
      raise notice 'PASS - Caso 18: CHECK constraint bloqueou session_id forjado (recovery_grants)';
  end;
end $$;
rollback to savepoint case_18;

-- ------------------------------------------------------------
-- Caso 19: anônimo não acessa recovery_grants (nem select nem insert)
-- ------------------------------------------------------------
savepoint case_19;
set local role anon;
select set_config('request.jwt.claims', '', true);

do $$
begin
  begin
    perform count(*) from public.recovery_grants;
    raise exception 'FAIL - Caso 19: anonimo leu recovery_grants';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 19: anonimo bloqueado em recovery_grants';
  end;
end $$;
rollback to savepoint case_19;

-- ------------------------------------------------------------
-- Caso 20: log_email_verification_completed()/log_password_recovery_completed()
-- gravam actor_user_id = auth.uid() da própria sessão — zero parâmetros,
-- nada para um cliente forjar (correção do BUG-T2-004,
-- qa/reports/TASK-002.md).
-- ------------------------------------------------------------
savepoint case_20;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);

do $$
begin
  perform public.log_email_verification_completed();
  perform public.log_password_recovery_completed();
end $$;

-- audit_log não tem SELECT para authenticated — confere como
-- postgres/superusuario, ainda dentro do savepoint case_20 (as linhas
-- gravadas acima continuam visíveis até o rollback no final do caso).
reset role;
do $$
declare
  qtd int;
begin
  select count(*) into qtd from public.audit_log
    where actor_user_id = current_setting('app.merchant_pending_id')::uuid
      and action in ('email_verification_completed', 'password_recovery_completed')
      and target_id = current_setting('app.merchant_pending_id');
  if qtd = 2 then
    raise notice 'PASS - Caso 20: as duas funcoes de auditoria de conta gravaram com actor_user_id = auth.uid(), sem parametro forjavel';
  else
    raise exception 'FAIL - Caso 20: esperado 2 eventos de auditoria de conta, obtido %', qtd;
  end if;
end $$;
rollback to savepoint case_20;

-- ------------------------------------------------------------
-- Caso 21: audit_log é append-only de verdade — nem authenticated nem
-- service_role conseguem UPDATE/DELETE (correção do BUG-T2-004: antes
-- service_role tinha UPDATE/DELETE, o que contradizia "append-only").
-- ------------------------------------------------------------
savepoint case_21;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);
do $$
begin
  begin
    update public.audit_log set metadata = '{}'::jsonb;
    raise exception 'FAIL - Caso 21a: authenticated conseguiu UPDATE em audit_log';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 21a: authenticated bloqueado em UPDATE audit_log';
  end;
end $$;
reset role;
set local role service_role;
do $$
begin
  begin
    update public.audit_log set metadata = '{}'::jsonb;
    raise exception 'FAIL - Caso 21b: service_role conseguiu UPDATE em audit_log';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 21b: service_role tambem bloqueado em UPDATE audit_log (append-only real, nem uso administrativo altera)';
  end;
  begin
    delete from public.audit_log;
    raise exception 'FAIL - Caso 21c: service_role conseguiu DELETE em audit_log';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 21c: service_role tambem bloqueado em DELETE audit_log';
  end;
end $$;
rollback to savepoint case_21;

-- Nenhuma alteração persiste: garante execução repetível a qualquer momento.
rollback;
