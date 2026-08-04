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
-- 41 cenários (16 originais + 5 da primeira correção pós-QA,
-- qa/reports/TASK-002.md, + 8 da segunda correção pós-QA,
-- qa/reports/TASK-002-RETEST.md, + 10 da terceira correção pós-QA,
-- revisão externa sobre qa/reports/TASK-002-CLAUDE-VERIFICATION.md, + 4
-- da quarta correção pós-QA, revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md, + 12 da quinta correção
-- pós-QA, revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md) cobrindo: isolamento de
-- onboarding_progress/merchant_profiles/ store_plans entre usuários e
-- entre lojas, múltiplos memberships, audit_log inacessível para
-- anon/authenticated, escrita direta forjada em stores/store_members
-- bloqueada (sem GRANT), plano forjado rejeitado pela função, slug
-- bloqueado após conclusão, idempotência do retry, anon bloqueado em
-- TODAS as 7 funções onboarding_* (Caso 16 — RESSALVA-T2-001).
--
-- Casos 17–26 (terceira correção pós-QA, revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-001):
-- `public.password_recovery_grants` (substitui `auth_flow_grants`) não
-- pode ser inserida/alterada diretamente por `authenticated`
-- (continuação de BUG-RT2-001); `issue_password_recovery_grant` — o
-- ÚNICO jeito de criar uma linha — não pode ser chamada por
-- anon/authenticated, nem para o próprio user_id nem para outro
-- (fecha BUG-CLAUDE-001: uma sessão comum não tem mais NENHUMA RPC
-- pública para se autoconceder recuperação); sem nenhum grant emitido,
-- is_current_session_recovery_grant() é sempre false; grant expirado é
-- rejeitado pelo claim; grant reivindicado uma vez não pode ser
-- reivindicado de novo (continuação de BUG-RT2-002); sessão de OUTRO
-- usuário não reivindica o grant; nonce incorreto é rejeitado (a
-- vinculação nova exigida pela revisão externa); session_id incorreto é
-- rejeitado; reivindicar sem nenhum grant emitido falha; falha
-- obrigatória de auditoria propaga a exceção e desfaz também o UPDATE
-- do grant (atomicidade real, continuação de BUG-RT2-005).
--
-- Caso 27: o evento de confirmação de e-mail (email_verification_completed)
-- não pode mais ser fabricado por nenhuma RPC — não existe mais nenhuma
-- função pública equivalente a consume_auth_flow_grant('email_confirmation')
-- para authenticated chamar (fecha BUG-CLAUDE-002); o trigger interno
-- que gera esse evento não tem EXECUTE concedido a ninguém.
--
-- Caso 28: `ON DELETE RESTRICT` bloqueia exclusão de loja com histórico
-- de auditoria associado (RESSALVA-RT2-001, antes `ON DELETE SET NULL`
-- alterava um evento histórico indiretamente).
--
-- Caso 29: audit_log verdadeiramente append-only (nem authenticated nem
-- service_role alteram/apagam — BUG-T2-004/BUG-RT2-006).
--
-- Casos 30-41 (quinta correção pós-QA, revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, BUG-CLAUDE-VERIF3-001):
-- a trigger automática on_auth_user_password_changed foi REMOVIDA por
-- completo (ela correlacionava só por user_id, sem expires_at/session_id/
-- janela temporal — provado fabricável nos três cenários daquele
-- relatório). A conclusão agora é a função explícita, server-only,
-- complete_password_recovery_attempt(attempt_id, capability):
-- fluxo feliz completo, com fingerprint de credencial realmente mudado
-- (Caso 30); completion sem alteração real da senha falha (fingerprint
-- igual — Caso 31); authenticated/anon não conseguem chamar a função
-- diretamente (Caso 32); tentativa já completed não pode ser
-- reivindicada de novo pelo claim (Caso 33); completion com attempt_id
-- incorreto falha (Caso 34); completion com capability incorreta falha
-- (Caso 35); completion duas vezes conclui exatamente uma vez,
-- idempotente (Caso 36); tentativa claimed cuja janela claim_expires_at
-- já passou não pode ser concluída mesmo com capability/attempt_id
-- corretos e senha realmente alterada (Caso 37 — a reprodução direta,
-- em SQL, do bloqueador original: nenhuma alteração de senha posterior
-- consegue "herdar" uma tentativa abandonada); nova emissão enquanto
-- existe uma tentativa pending revoga a anterior explicitamente e
-- preserva a linha (Caso 38); nova emissão enquanto existe uma
-- tentativa claimed revoga a anterior — a capability antiga nunca
-- conclui a tentativa nova, mesmo mesmo usuário (Caso 39); nova emissão
-- enquanto existe uma tentativa completed insere uma linha nova e
-- preserva a completed intacta (Caso 40); troca de senha sem nenhuma
-- tentativa de recuperação em andamento não fabrica
-- password_recovery_completed (Caso 41, mantém a cobertura do antigo
-- Caso 31 desta mesma seção antes da renumeração).
--
-- Troca de token_hash entre /auth/confirm e /auth/recovery
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
-- password_recovery_grants — nenhum GRANT de tabela concedido, mesmo
-- para a própria linha (continuação de BUG-RT2-001).
-- ------------------------------------------------------------
savepoint case_17;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_onboarding_id'))::text, true);

do $$
begin
  begin
    insert into public.password_recovery_grants (user_id, session_id, nonce_hash, expires_at)
      values (
        current_setting('app.merchant_onboarding_id')::uuid,
        gen_random_uuid(),
        encode(extensions.digest('forjado', 'sha256'), 'hex'),
        now() + interval '30 minutes'
      );
    raise exception 'FAIL - Caso 17: insert direto em password_recovery_grants deveria ter sido bloqueado';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 17: authenticated nao consegue inserir diretamente em password_recovery_grants (sem GRANT de tabela)';
  end;
end $$;
rollback to savepoint case_17;

-- ------------------------------------------------------------
-- Caso 18: NENHUMA sessão comum consegue chamar issue_password_recovery_grant
-- — nem anon, nem authenticated para o próprio user_id, nem
-- authenticated para OUTRO user_id. Este é o teste central do
-- BUG-CLAUDE-001 (qa/reports/TASK-002-CLAUDE-VERIFICATION.md): a versão
-- anterior permitia que uma sessão comum chamasse
-- request_password_recovery_grant + consume_auth_flow_grant e obtivesse
-- o privilégio sozinha; agora a ÚNICA função que cria uma linha em
-- password_recovery_grants não tem NENHUM GRANT de EXECUTE para
-- anon/authenticated — só service_role (nunca alcançável por um
-- cliente, que não possui a SUPABASE_SERVICE_ROLE_KEY).
-- ------------------------------------------------------------
savepoint case_18;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.issue_password_recovery_grant(
      current_setting('app.merchant_pending_id')::uuid, gen_random_uuid(), 'nonce-forjado-anon', 1800
    );
    raise exception 'FAIL - Caso 18a: anon conseguiu chamar issue_password_recovery_grant';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 18a: anon nao consegue chamar issue_password_recovery_grant (sem GRANT de EXECUTE)';
  end;
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', gen_random_uuid()::text)::text,
  true
);
do $$
begin
  begin
    -- Tentativa 1: emitir para SI MESMO.
    perform public.issue_password_recovery_grant(
      current_setting('app.merchant_pending_id')::uuid, gen_random_uuid(), 'nonce-forjado-self', 1800
    );
    raise exception 'FAIL - Caso 18b: authenticated conseguiu emitir grant para si mesmo';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 18b: authenticated nao consegue emitir grant para si mesmo (sem GRANT de EXECUTE)';
  end;
  begin
    -- Tentativa 2: emitir para OUTRO usuário.
    perform public.issue_password_recovery_grant(
      current_setting('app.admin_a_id')::uuid, gen_random_uuid(), 'nonce-forjado-outro', 1800
    );
    raise exception 'FAIL - Caso 18c: authenticated conseguiu emitir grant para outro usuario';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 18c: authenticated nao consegue emitir grant para outro usuario (sem GRANT de EXECUTE)';
  end;
end $$;
rollback to savepoint case_18;

-- ------------------------------------------------------------
-- Caso 19: sem NENHUM grant jamais emitido, is_current_session_recovery_grant()
-- é sempre false — não há "pedido pendente" que uma sessão comum possa
-- ativar sozinha, porque não existe mais o conceito de "pedido pendente
-- sem emissão real" (o desenho antigo, auto-fabricável, foi removido
-- por completo).
-- ------------------------------------------------------------
savepoint case_19;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.admin_a_id'), 'session_id', gen_random_uuid()::text)::text,
  true
);
do $$
declare
  v_result boolean;
begin
  select public.is_current_session_recovery_grant() into v_result;
  if v_result = false then
    raise notice 'PASS - Caso 19: is_current_session_recovery_grant() e false sem nenhum grant emitido (nada para uma sessao comum ativar sozinha)';
  else
    raise exception 'FAIL - Caso 19: deveria ter devolvido false';
  end if;
end $$;
rollback to savepoint case_19;

-- ------------------------------------------------------------
-- Caso 20: grant expirado é rejeitado pelo claim. Emissão passa pelo
-- caminho real (service_role), depois o expires_at é forçado para o
-- passado diretamente pelo teste (como postgres, dono da tabela) — a
-- própria função recusa TTLs <= 0, então não há como pedir um grant
-- "já nascido expirado" através dela; isso simula o relógio avançar.
-- ------------------------------------------------------------
savepoint case_20;
do $$
declare
  v_session_id uuid := gen_random_uuid();
begin
  perform set_config('app.case20_session_id', v_session_id::text, true);
  perform set_config('app.case20_nonce', 'nonce-de-teste-caso-20', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_multi_id')::uuid,
    current_setting('app.case20_session_id')::uuid,
    current_setting('app.case20_nonce'),
    1800
  );
end $$;
reset role;
update public.password_recovery_grants
  set expires_at = now() - interval '1 minute'
  where user_id = current_setting('app.merchant_multi_id')::uuid;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_multi_id'), 'session_id', current_setting('app.case20_session_id'))::text,
  true
);
do $$
declare
  v_result boolean;
begin
  select (public.claim_recovery_grant_for_password_change(current_setting('app.case20_nonce'))->>'claimed')::boolean into v_result;
  if v_result = false then
    raise notice 'PASS - Caso 20: grant expirado e rejeitado pelo claim';
  else
    raise exception 'FAIL - Caso 20: grant expirado deveria ter sido rejeitado';
  end if;
end $$;
rollback to savepoint case_20;

-- ------------------------------------------------------------
-- Caso 21: grant reivindicado uma vez não pode ser reivindicado de novo
-- — segunda chamada ao claim com o mesmo nonce devolve false
-- (continuação de BUG-RT2-002).
-- ------------------------------------------------------------
savepoint case_21;
do $$
begin
  perform set_config('app.case21_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case21_nonce', 'nonce-de-teste-caso-21', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_multi_id')::uuid,
    current_setting('app.case21_session_id')::uuid,
    current_setting('app.case21_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_multi_id'), 'session_id', current_setting('app.case21_session_id'))::text,
  true
);
do $$
declare
  v_first boolean;
  v_second boolean;
begin
  select (public.claim_recovery_grant_for_password_change(current_setting('app.case21_nonce'))->>'claimed')::boolean into v_first;
  select (public.claim_recovery_grant_for_password_change(current_setting('app.case21_nonce'))->>'claimed')::boolean into v_second;
  if v_first = true and v_second = false then
    raise notice 'PASS - Caso 21: grant reivindicado uma vez nao pode ser reivindicado de novo (segunda chamada devolve false)';
  else
    raise exception 'FAIL - Caso 21: esperado true depois false, obtido %/%', v_first, v_second;
  end if;
end $$;
rollback to savepoint case_21;

-- ------------------------------------------------------------
-- Caso 22: sessão de OUTRO usuário não consegue reivindicar o grant —
-- mesmo sabendo (por hipótese) o nonce correto, auth.uid() precisa
-- bater com o user_id do grant.
-- ------------------------------------------------------------
savepoint case_22;
do $$
begin
  perform set_config('app.case22_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case22_nonce', 'nonce-de-teste-caso-22', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_pending_id')::uuid,
    current_setting('app.case22_session_id')::uuid,
    current_setting('app.case22_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_onboarding_id'), 'session_id', current_setting('app.case22_session_id'))::text,
  true
);
do $$
declare
  v_result boolean;
begin
  select (public.claim_recovery_grant_for_password_change(current_setting('app.case22_nonce'))->>'claimed')::boolean into v_result;
  if v_result = false then
    raise notice 'PASS - Caso 22: sessao de um usuario nao consegue reivindicar o grant de outro usuario';
  else
    raise exception 'FAIL - Caso 22: reivindicacao deveria ter falhado (usuario incompativel)';
  end if;
end $$;
rollback to savepoint case_22;

-- ------------------------------------------------------------
-- Caso 23: nonce incorreto é rejeitado — a vinculação por nonce exigida
-- pela revisão externa (qa/reports/TASK-002-CLAUDE-VERIFICATION.md):
-- mesmo user_id/session_id corretos, um nonce errado não reivindica.
-- ------------------------------------------------------------
savepoint case_23;
do $$
begin
  perform set_config('app.case23_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case23_nonce', 'nonce-caso-23-correto', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_pending_id')::uuid,
    current_setting('app.case23_session_id')::uuid,
    current_setting('app.case23_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', current_setting('app.case23_session_id'))::text,
  true
);
do $$
declare
  v_wrong boolean;
  v_right boolean;
begin
  select (public.claim_recovery_grant_for_password_change('nonce-errado-completamente')->>'claimed')::boolean into v_wrong;
  select (public.claim_recovery_grant_for_password_change(current_setting('app.case23_nonce'))->>'claimed')::boolean into v_right;
  if v_wrong = false and v_right = true then
    raise notice 'PASS - Caso 23: nonce incorreto rejeitado; nonce correto reivindica normalmente';
  else
    raise exception 'FAIL - Caso 23: esperado false depois true, obtido %/%', v_wrong, v_right;
  end if;
end $$;
rollback to savepoint case_23;

-- ------------------------------------------------------------
-- Caso 24: session_id incorreto é rejeitado — mesmo user_id/nonce
-- corretos, uma sessão diferente (session_id diferente) do mesmo
-- usuário não reivindica.
-- ------------------------------------------------------------
savepoint case_24;
do $$
begin
  perform set_config('app.case24_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case24_other_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case24_nonce', 'nonce-de-teste-caso-24', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_pending_id')::uuid,
    current_setting('app.case24_session_id')::uuid,
    current_setting('app.case24_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', current_setting('app.case24_other_session_id'))::text,
  true
);
do $$
declare
  v_result boolean;
begin
  select (public.claim_recovery_grant_for_password_change(current_setting('app.case24_nonce'))->>'claimed')::boolean into v_result;
  if v_result = false then
    raise notice 'PASS - Caso 24: session_id incorreto (outra sessao do mesmo usuario) rejeitado pelo claim';
  else
    raise exception 'FAIL - Caso 24: reivindicacao deveria ter falhado (session_id incompativel)';
  end if;
end $$;
rollback to savepoint case_24;

-- ------------------------------------------------------------
-- Caso 25: reivindicar sem NENHUM grant jamais emitido falha —
-- equivalente ao antigo "reivindicar sem ter consumido antes".
-- ------------------------------------------------------------
savepoint case_25;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', gen_random_uuid()::text)::text,
  true
);
do $$
declare
  v_claim boolean;
begin
  select (public.claim_recovery_grant_for_password_change('qualquer-nonce')->>'claimed')::boolean into v_claim;
  if v_claim = false then
    raise notice 'PASS - Caso 25: reivindicar sem nenhum grant emitido falha';
  else
    raise exception 'FAIL - Caso 25: claim sem grant emitido deveria ter falhado';
  end if;
end $$;
rollback to savepoint case_25;

-- ------------------------------------------------------------
-- Caso 26: falha obrigatória de auditoria impede a operação sensível —
-- um gatilho de teste bloqueia o INSERT em audit_log; a chamada inteira
-- do claim precisa propagar a exceção (não engolir) E desfazer também
-- o UPDATE do grant (rollback completo da função, não só do insert) —
-- claimed_at precisa continuar null, não só "a linha ainda existe"
-- (desde a quarta correção pós-QA, a linha nunca é apagada pelo claim,
-- só atualizada — então checar apenas a contagem de linhas não provaria
-- mais rollback nenhum).
-- ------------------------------------------------------------
savepoint case_26;
do $$
begin
  perform set_config('app.case26_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case26_nonce', 'nonce-de-teste-caso-26', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_onboarding_id')::uuid,
    current_setting('app.case26_session_id')::uuid,
    current_setting('app.case26_nonce'),
    1800
  );
end $$;
reset role;

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
  json_build_object('sub', current_setting('app.merchant_onboarding_id'), 'session_id', current_setting('app.case26_session_id'))::text,
  true
);
do $$
begin
  begin
    perform public.claim_recovery_grant_for_password_change(current_setting('app.case26_nonce'));
    raise exception 'FAIL - Caso 26a: claim deveria ter falhado (gatilho de teste bloqueou o insert em audit_log)';
  exception
    when others then
      if sqlerrm = 'blocked_for_test' then
        raise notice 'PASS - Caso 26a: falha obrigatoria da auditoria propaga a excecao (nao e engolida)';
      else
        raise;
      end if;
  end;
end $$;

reset role;
do $$
declare
  qtd_claimed_null int;
  qtd_capability_null int;
begin
  select count(*) into qtd_claimed_null from public.password_recovery_grants
    where user_id = current_setting('app.merchant_onboarding_id')::uuid
      and claimed_at is null;
  select count(*) into qtd_capability_null from public.password_recovery_grants
    where user_id = current_setting('app.merchant_onboarding_id')::uuid
      and completion_secret_hash is null;
  if qtd_claimed_null = 1 and qtd_capability_null = 1 then
    raise notice 'PASS - Caso 26b: falha na auditoria desfez tambem o UPDATE do grant (claimed_at/completion_secret_hash continuam null — rollback completo, nao so do insert)';
  else
    raise exception 'FAIL - Caso 26b: esperado claimed_at/completion_secret_hash ainda null (rollback completo), obtido claimed_null=%, capability_null=%', qtd_claimed_null, qtd_capability_null;
  end if;
end $$;
-- rollback to savepoint desfaz o gatilho/funcao de teste tambem (DDL e transacional).
rollback to savepoint case_26;

-- ------------------------------------------------------------
-- Caso 27: nenhuma RPC pública fabrica email_verification_completed —
-- o desenho antigo (consume_auth_flow_grant('email_confirmation'))
-- foi removido por completo (BUG-CLAUDE-002). O trigger que gera este
-- evento (handle_email_confirmed_audit) não tem NENHUM GRANT de
-- EXECUTE — nem authenticated, nem PUBLIC, nem service_role — só o
-- próprio mecanismo de trigger do Postgres o invoca.
-- ------------------------------------------------------------
savepoint case_27;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_onboarding_id'), 'session_id', gen_random_uuid()::text)::text,
  true
);
do $$
begin
  begin
    perform public.handle_email_confirmed_audit();
    raise exception 'FAIL - Caso 27: authenticated conseguiu chamar handle_email_confirmed_audit diretamente';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 27: authenticated nao consegue chamar handle_email_confirmed_audit diretamente (sem GRANT de EXECUTE)';
  end;
end $$;
rollback to savepoint case_27;

-- ------------------------------------------------------------
-- Caso 28: ON DELETE RESTRICT bloqueia a exclusão de uma loja com
-- histórico de auditoria associado — não altera silenciosamente o
-- evento histórico (RESSALVA-RT2-001: antes, ON DELETE SET NULL
-- mutava store_id para NULL numa linha de auditoria já gravada).
-- ------------------------------------------------------------
savepoint case_28;
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
    raise exception 'FAIL - Caso 28: exclusao de loja com historico de auditoria deveria ter sido bloqueada (ON DELETE RESTRICT)';
  exception
    when foreign_key_violation then
      raise notice 'PASS - Caso 28: ON DELETE RESTRICT bloqueou a exclusao da loja — evento historico de auditoria nao pode ser alterado nem indiretamente';
  end;
end $$;
rollback to savepoint case_28;

-- ------------------------------------------------------------
-- Caso 29: audit_log é append-only de verdade — nem authenticated nem
-- service_role conseguem UPDATE/DELETE.
-- ------------------------------------------------------------
savepoint case_29;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.merchant_pending_id'))::text, true);
do $$
begin
  begin
    update public.audit_log set metadata = '{}'::jsonb;
    raise exception 'FAIL - Caso 29a: authenticated conseguiu UPDATE em audit_log';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 29a: authenticated bloqueado em UPDATE audit_log';
  end;
end $$;
reset role;
set local role service_role;
do $$
begin
  begin
    update public.audit_log set metadata = '{}'::jsonb;
    raise exception 'FAIL - Caso 29b: service_role conseguiu UPDATE em audit_log';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 29b: service_role tambem bloqueado em UPDATE audit_log (append-only real, nem uso administrativo altera)';
  end;
  begin
    delete from public.audit_log;
    raise exception 'FAIL - Caso 29c: service_role conseguiu DELETE em audit_log';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 29c: service_role tambem bloqueado em DELETE audit_log';
  end;
end $$;
rollback to savepoint case_29;

-- ------------------------------------------------------------
-- Caso 30 (quinta correção pós-QA, revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, BUG-CLAUDE-VERIF3-001):
-- fluxo feliz completo pela conclusão EXPLÍCITA — issue -> claim
-- (captura attempt_id/completion capability) -> alteração REAL da
-- credencial (simulada como postgres, exatamente como o GoTrue faz
-- internamente) -> complete_password_recovery_attempt (service_role,
-- attempt_id/capability corretos) -> completed_at preenchido,
-- exatamente 1 evento password_recovery_completed, com o attempt_id
-- correto em metadata (nunca "o grant claimed do usuário").
-- ------------------------------------------------------------
savepoint case_30;
do $$
begin
  perform set_config('app.case30_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case30_nonce', 'nonce-de-teste-caso-30', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_pending_id')::uuid,
    current_setting('app.case30_session_id')::uuid,
    current_setting('app.case30_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', current_setting('app.case30_session_id'))::text,
  true
);
do $$
declare
  v_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case30_nonce')) into v_claim;
  if (v_claim->>'claimed')::boolean <> true then
    raise exception 'FAIL - Caso 30 (setup): claim deveria ter tido sucesso, obtido %', v_claim;
  end if;
  perform set_config('app.case30_attempt_id', v_claim->>'attempt_id', true);
  perform set_config('app.case30_capability', v_claim->>'completion_capability', true);
end $$;
reset role;

-- Simula o que o GoTrue faz internamente ao processar updateUser({password}):
-- um UPDATE real em auth.users.encrypted_password, como postgres (superusuário
-- — equivalente ao papel que o próprio GoTrue usa contra o Postgres).
do $$
begin
  update auth.users set encrypted_password = 'fake-bcrypt-hash-caso-30-' || gen_random_uuid()::text
    where id = current_setting('app.merchant_pending_id')::uuid;
end $$;

set local role service_role;
do $$
declare
  v_completed boolean;
begin
  select public.complete_password_recovery_attempt(
    current_setting('app.case30_attempt_id')::uuid,
    current_setting('app.case30_capability')
  ) into v_completed;
  if v_completed <> true then
    raise exception 'FAIL - Caso 30: complete_password_recovery_attempt deveria ter tido sucesso, obtido %', v_completed;
  end if;
end $$;
reset role;

do $$
declare
  v_completed_at timestamptz;
  v_evento_qtd int;
  v_metadata_attempt_id text;
begin
  select completed_at into v_completed_at from public.password_recovery_grants
    where user_id = current_setting('app.merchant_pending_id')::uuid;
  select count(*) into v_evento_qtd from public.audit_log
    where actor_user_id = current_setting('app.merchant_pending_id')::uuid
      and action = 'password_recovery_completed';
  select metadata->>'attempt_id' into v_metadata_attempt_id from public.audit_log
    where actor_user_id = current_setting('app.merchant_pending_id')::uuid
      and action = 'password_recovery_completed';
  if v_completed_at is not null and v_evento_qtd = 1 and v_metadata_attempt_id = current_setting('app.case30_attempt_id') then
    raise notice 'PASS - Caso 30: complete_password_recovery_attempt concluiu a tentativa exata — completed_at preenchido, exatamente 1 evento password_recovery_completed com attempt_id correto';
  else
    raise exception 'FAIL - Caso 30: esperado completed_at preenchido/1 evento/attempt_id correto, obtido completed_at=%, eventos=%, metadata_attempt_id=% (esperado %)', v_completed_at, v_evento_qtd, v_metadata_attempt_id, current_setting('app.case30_attempt_id');
  end if;
end $$;
rollback to savepoint case_30;

-- ------------------------------------------------------------
-- Caso 31: completion sem alteração real da senha falha — claim captura
-- password_fingerprint_before, mas encrypted_password NUNCA muda (ex.:
-- updateUser nunca chamado, ou falhou) — complete_password_recovery_attempt
-- com attempt_id/capability corretos ainda assim retorna false, e
-- completed_at continua null (fecha a "PROVA DE ALTERAÇÃO REAL" exigida
-- pela revisão externa).
-- ------------------------------------------------------------
savepoint case_31;
do $$
begin
  perform set_config('app.case31_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case31_nonce', 'nonce-de-teste-caso-31', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_onboarding_id')::uuid,
    current_setting('app.case31_session_id')::uuid,
    current_setting('app.case31_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_onboarding_id'), 'session_id', current_setting('app.case31_session_id'))::text,
  true
);
do $$
declare
  v_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case31_nonce')) into v_claim;
  if (v_claim->>'claimed')::boolean <> true then
    raise exception 'FAIL - Caso 31 (setup): claim deveria ter tido sucesso, obtido %', v_claim;
  end if;
  perform set_config('app.case31_attempt_id', v_claim->>'attempt_id', true);
  perform set_config('app.case31_capability', v_claim->>'completion_capability', true);
end $$;
reset role;

set local role service_role;
do $$
declare
  v_completed boolean;
begin
  select public.complete_password_recovery_attempt(
    current_setting('app.case31_attempt_id')::uuid,
    current_setting('app.case31_capability')
  ) into v_completed;
  if v_completed = false then
    raise notice 'PASS - Caso 31: completion sem alteracao real da senha falha (fingerprint inalterado)';
  else
    raise exception 'FAIL - Caso 31: completion deveria ter falhado sem alteracao real da credencial';
  end if;
end $$;
reset role;

do $$
declare
  v_completed_at timestamptz;
begin
  select completed_at into v_completed_at from public.password_recovery_grants
    where user_id = current_setting('app.merchant_onboarding_id')::uuid;
  if v_completed_at is null then
    raise notice 'PASS - Caso 31b: completed_at continua null apos completion recusada';
  else
    raise exception 'FAIL - Caso 31b: completed_at nao deveria estar preenchido';
  end if;
end $$;
rollback to savepoint case_31;

-- ------------------------------------------------------------
-- Caso 32: nem authenticated nem anon conseguem chamar
-- complete_password_recovery_attempt() diretamente — EXECUTE só para
-- service_role (PUBLIC/anon/authenticated nunca podem executar a
-- função de conclusão).
-- ------------------------------------------------------------
savepoint case_32;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_onboarding_id'), 'session_id', gen_random_uuid()::text)::text,
  true
);
do $$
begin
  begin
    perform public.complete_password_recovery_attempt(gen_random_uuid(), 'qualquer-capability');
    raise exception 'FAIL - Caso 32a: authenticated conseguiu chamar complete_password_recovery_attempt diretamente';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 32a: authenticated nao consegue chamar complete_password_recovery_attempt diretamente (sem GRANT de EXECUTE)';
  end;
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.complete_password_recovery_attempt(gen_random_uuid(), 'qualquer-capability');
    raise exception 'FAIL - Caso 32b: anon conseguiu chamar complete_password_recovery_attempt diretamente';
  exception
    when insufficient_privilege then
      raise notice 'PASS - Caso 32b: anon nao consegue chamar complete_password_recovery_attempt diretamente (sem GRANT de EXECUTE)';
  end;
end $$;
rollback to savepoint case_32;

-- ------------------------------------------------------------
-- Caso 33: uma tentativa já completed não pode ser reivindicada de novo
-- pelo claim (completed_at is null é exigido no WHERE) — a conclusão
-- continua sendo um estado terminal para o claim.
-- ------------------------------------------------------------
savepoint case_33;
do $$
begin
  perform set_config('app.case33_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case33_nonce', 'nonce-de-teste-caso-33', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_multi_id')::uuid,
    current_setting('app.case33_session_id')::uuid,
    current_setting('app.case33_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_multi_id'), 'session_id', current_setting('app.case33_session_id'))::text,
  true
);
do $$
declare
  v_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case33_nonce')) into v_claim;
  if (v_claim->>'claimed')::boolean <> true then
    raise exception 'FAIL - Caso 33 (setup): claim deveria ter tido sucesso, obtido %', v_claim;
  end if;
  perform set_config('app.case33_attempt_id', v_claim->>'attempt_id', true);
  perform set_config('app.case33_capability', v_claim->>'completion_capability', true);
end $$;
reset role;

do $$
begin
  update auth.users set encrypted_password = 'fake-bcrypt-hash-caso-33-' || gen_random_uuid()::text
    where id = current_setting('app.merchant_multi_id')::uuid;
end $$;

set local role service_role;
do $$
declare
  v_completed boolean;
begin
  select public.complete_password_recovery_attempt(
    current_setting('app.case33_attempt_id')::uuid,
    current_setting('app.case33_capability')
  ) into v_completed;
  if v_completed <> true then
    raise exception 'FAIL - Caso 33 (setup): complete deveria ter tido sucesso, obtido %', v_completed;
  end if;
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_multi_id'), 'session_id', current_setting('app.case33_session_id'))::text,
  true
);
do $$
declare
  v_second_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case33_nonce')) into v_second_claim;
  if (v_second_claim->>'claimed')::boolean = false then
    raise notice 'PASS - Caso 33: tentativa ja completed nao pode ser reivindicada de novo pelo claim';
  else
    raise exception 'FAIL - Caso 33: reivindicacao de uma tentativa ja completed deveria ter falhado';
  end if;
end $$;
rollback to savepoint case_33;

-- ------------------------------------------------------------
-- Caso 34: completion com attempt_id incorreto falha, mesmo com a
-- capability correta e a senha realmente alterada.
-- ------------------------------------------------------------
savepoint case_34;
do $$
begin
  perform set_config('app.case34_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case34_nonce', 'nonce-de-teste-caso-34', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_pending_id')::uuid,
    current_setting('app.case34_session_id')::uuid,
    current_setting('app.case34_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', current_setting('app.case34_session_id'))::text,
  true
);
do $$
declare
  v_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case34_nonce')) into v_claim;
  perform set_config('app.case34_capability', v_claim->>'completion_capability', true);
end $$;
reset role;

do $$
begin
  update auth.users set encrypted_password = 'fake-bcrypt-hash-caso-34-' || gen_random_uuid()::text
    where id = current_setting('app.merchant_pending_id')::uuid;
end $$;

set local role service_role;
do $$
declare
  v_completed boolean;
begin
  select public.complete_password_recovery_attempt(
    gen_random_uuid(), -- attempt_id incorreto, nunca existiu
    current_setting('app.case34_capability')
  ) into v_completed;
  if v_completed = false then
    raise notice 'PASS - Caso 34: completion com attempt_id incorreto falha';
  else
    raise exception 'FAIL - Caso 34: completion com attempt_id incorreto deveria ter falhado';
  end if;
end $$;
reset role;
rollback to savepoint case_34;

-- ------------------------------------------------------------
-- Caso 35: completion com completion capability incorreta falha, mesmo
-- com o attempt_id correto e a senha realmente alterada.
-- ------------------------------------------------------------
savepoint case_35;
do $$
begin
  perform set_config('app.case35_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case35_nonce', 'nonce-de-teste-caso-35', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_pending_id')::uuid,
    current_setting('app.case35_session_id')::uuid,
    current_setting('app.case35_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', current_setting('app.case35_session_id'))::text,
  true
);
do $$
declare
  v_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case35_nonce')) into v_claim;
  perform set_config('app.case35_attempt_id', v_claim->>'attempt_id', true);
end $$;
reset role;

do $$
begin
  update auth.users set encrypted_password = 'fake-bcrypt-hash-caso-35-' || gen_random_uuid()::text
    where id = current_setting('app.merchant_pending_id')::uuid;
end $$;

set local role service_role;
do $$
declare
  v_completed boolean;
begin
  select public.complete_password_recovery_attempt(
    current_setting('app.case35_attempt_id')::uuid,
    'capability-completamente-errada-nunca-gerada-por-nenhum-claim'
  ) into v_completed;
  if v_completed = false then
    raise notice 'PASS - Caso 35: completion com capability incorreta falha';
  else
    raise exception 'FAIL - Caso 35: completion com capability incorreta deveria ter falhado';
  end if;
end $$;
reset role;
rollback to savepoint case_35;

-- ------------------------------------------------------------
-- Caso 36: completion chamada duas vezes com os mesmos attempt_id/
-- capability conclui exatamente uma vez — idempotente, sem duplicar
-- auditoria (a segunda chamada encontra completed_at já preenchido,
-- fora do WHERE, e retorna false).
-- ------------------------------------------------------------
savepoint case_36;
do $$
begin
  perform set_config('app.case36_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case36_nonce', 'nonce-de-teste-caso-36', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_pending_id')::uuid,
    current_setting('app.case36_session_id')::uuid,
    current_setting('app.case36_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', current_setting('app.case36_session_id'))::text,
  true
);
do $$
declare
  v_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case36_nonce')) into v_claim;
  perform set_config('app.case36_attempt_id', v_claim->>'attempt_id', true);
  perform set_config('app.case36_capability', v_claim->>'completion_capability', true);
end $$;
reset role;

do $$
begin
  update auth.users set encrypted_password = 'fake-bcrypt-hash-caso-36-' || gen_random_uuid()::text
    where id = current_setting('app.merchant_pending_id')::uuid;
end $$;

set local role service_role;
do $$
declare
  v_first boolean;
  v_second boolean;
begin
  select public.complete_password_recovery_attempt(
    current_setting('app.case36_attempt_id')::uuid, current_setting('app.case36_capability')
  ) into v_first;
  select public.complete_password_recovery_attempt(
    current_setting('app.case36_attempt_id')::uuid, current_setting('app.case36_capability')
  ) into v_second;
  if v_first = true and v_second = false then
    raise notice 'PASS - Caso 36: completion duas vezes conclui exatamente uma (idempotente)';
  else
    raise exception 'FAIL - Caso 36: esperado true depois false, obtido %/%', v_first, v_second;
  end if;
end $$;
reset role;

do $$
declare
  v_evento_qtd int;
begin
  select count(*) into v_evento_qtd from public.audit_log
    where actor_user_id = current_setting('app.merchant_pending_id')::uuid
      and action = 'password_recovery_completed';
  if v_evento_qtd = 1 then
    raise notice 'PASS - Caso 36b: exatamente 1 evento password_recovery_completed, sem duplicar na segunda chamada';
  else
    raise exception 'FAIL - Caso 36b: esperado exatamente 1 evento, obtido %', v_evento_qtd;
  end if;
end $$;
rollback to savepoint case_36;

-- ------------------------------------------------------------
-- Caso 37: uma tentativa CLAIMED cuja janela claim_expires_at já passou
-- não pode ser concluída, mesmo com attempt_id/capability corretos e a
-- senha realmente alterada — a reprodução direta, em SQL, do bloqueador
-- original (BUG-CLAUDE-VERIF3-001, Cenário 3): nenhuma alteração de
-- senha posterior consegue "herdar" uma tentativa abandonada além da
-- janela de conclusão.
-- ------------------------------------------------------------
savepoint case_37;
do $$
begin
  perform set_config('app.case37_session_id', gen_random_uuid()::text, true);
  perform set_config('app.case37_nonce', 'nonce-de-teste-caso-37', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_pending_id')::uuid,
    current_setting('app.case37_session_id')::uuid,
    current_setting('app.case37_nonce'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_pending_id'), 'session_id', current_setting('app.case37_session_id'))::text,
  true
);
do $$
declare
  v_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case37_nonce')) into v_claim;
  perform set_config('app.case37_attempt_id', v_claim->>'attempt_id', true);
  perform set_config('app.case37_capability', v_claim->>'completion_capability', true);
end $$;
reset role;

-- Força claim_expires_at para o passado, como postgres — simula o
-- relógio avançar além da janela de conclusão (ex.: updateUser demorou
-- demais, ou o processo travou entre o claim e o updateUser real).
update public.password_recovery_grants
  set claim_expires_at = now() - interval '1 minute'
  where id = current_setting('app.case37_attempt_id')::uuid;

do $$
begin
  update auth.users set encrypted_password = 'fake-bcrypt-hash-caso-37-' || gen_random_uuid()::text
    where id = current_setting('app.merchant_pending_id')::uuid;
end $$;

set local role service_role;
do $$
declare
  v_completed boolean;
begin
  select public.complete_password_recovery_attempt(
    current_setting('app.case37_attempt_id')::uuid,
    current_setting('app.case37_capability')
  ) into v_completed;
  if v_completed = false then
    raise notice 'PASS - Caso 37: tentativa claimed com janela de conclusao expirada nao pode ser concluida, mesmo com attempt_id/capability corretos e senha realmente alterada';
  else
    raise exception 'FAIL - Caso 37: completion apos claim_expires_at deveria ter falhado';
  end if;
end $$;
reset role;
rollback to savepoint case_37;

-- ------------------------------------------------------------
-- Caso 38: nova emissão enquanto existe uma tentativa PENDING (nunca
-- reivindicada) revoga a anterior explicitamente (revoked_at/
-- revoke_reason preenchidos, linha preservada) — nunca mais que uma
-- tentativa ativa por usuário (password_recovery_grants_one_active_per_user).
-- ------------------------------------------------------------
savepoint case_38;
do $$
declare
  v_first_id uuid;
begin
  select public.issue_password_recovery_grant(
    current_setting('app.merchant_onboarding_id')::uuid,
    gen_random_uuid(),
    'nonce-caso-38-primeiro',
    1800
  ) into v_first_id;
  perform set_config('app.case38_first_id', v_first_id::text, true);
end $$;

do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_onboarding_id')::uuid,
    gen_random_uuid(),
    'nonce-caso-38-segundo',
    1800
  );
end $$;

do $$
declare
  v_first_revoked timestamptz;
  v_first_reason text;
  v_active_count int;
begin
  select revoked_at, revoke_reason into v_first_revoked, v_first_reason
    from public.password_recovery_grants where id = current_setting('app.case38_first_id')::uuid;
  select count(*) into v_active_count from public.password_recovery_grants
    where user_id = current_setting('app.merchant_onboarding_id')::uuid
      and completed_at is null and revoked_at is null;
  if v_first_revoked is not null and v_first_reason = 'superseded_by_new_recovery' and v_active_count = 1 then
    raise notice 'PASS - Caso 38: nova emissao revoga explicitamente a tentativa pending anterior (linha preservada) e so 1 tentativa ativa permanece';
  else
    raise exception 'FAIL - Caso 38: esperado revoked_at preenchido/reason correto/1 ativa, obtido revoked_at=%, reason=%, ativas=%', v_first_revoked, v_first_reason, v_active_count;
  end if;
end $$;
rollback to savepoint case_38;

-- ------------------------------------------------------------
-- Caso 39: nova emissão enquanto existe uma tentativa CLAIMED (não
-- completed) revoga a anterior explicitamente — a capability antiga
-- nunca conclui a tentativa nova, mesmo sendo o mesmo usuário (reforça
-- que revoked é estado terminal, igual completed).
-- ------------------------------------------------------------
savepoint case_39;
do $$
begin
  perform set_config('app.case39_session_id_1', gen_random_uuid()::text, true);
  perform set_config('app.case39_nonce_1', 'nonce-caso-39-primeiro', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_onboarding_id')::uuid,
    current_setting('app.case39_session_id_1')::uuid,
    current_setting('app.case39_nonce_1'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_onboarding_id'), 'session_id', current_setting('app.case39_session_id_1'))::text,
  true
);
do $$
declare
  v_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case39_nonce_1')) into v_claim;
  if (v_claim->>'claimed')::boolean <> true then
    raise exception 'FAIL - Caso 39 (setup): claim deveria ter tido sucesso, obtido %', v_claim;
  end if;
  perform set_config('app.case39_attempt_id_1', v_claim->>'attempt_id', true);
  perform set_config('app.case39_capability_1', v_claim->>'completion_capability', true);
end $$;
reset role;

-- Nova recuperação para o MESMO usuário, enquanto a primeira ainda está
-- claimed (não completed) — revoga a primeira explicitamente.
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_onboarding_id')::uuid,
    gen_random_uuid(),
    'nonce-caso-39-segundo',
    1800
  );
end $$;
reset role;

do $$
begin
  update auth.users set encrypted_password = 'fake-bcrypt-hash-caso-39-' || gen_random_uuid()::text
    where id = current_setting('app.merchant_onboarding_id')::uuid;
end $$;

set local role service_role;
do $$
declare
  v_completed boolean;
begin
  select public.complete_password_recovery_attempt(
    current_setting('app.case39_attempt_id_1')::uuid,
    current_setting('app.case39_capability_1')
  ) into v_completed;
  if v_completed = false then
    raise notice 'PASS - Caso 39: capability da tentativa claimed anterior (revogada pela nova emissao) nunca conclui nada, mesmo apos alteracao real da senha';
  else
    raise exception 'FAIL - Caso 39: completion com capability de tentativa revogada deveria ter falhado';
  end if;
end $$;
reset role;

do $$
declare
  v_revoked_at timestamptz;
begin
  select revoked_at into v_revoked_at from public.password_recovery_grants
    where id = current_setting('app.case39_attempt_id_1')::uuid;
  if v_revoked_at is not null then
    raise notice 'PASS - Caso 39b: tentativa claimed anterior foi revogada explicitamente pela nova emissao (linha preservada, revoked_at preenchido)';
  else
    raise exception 'FAIL - Caso 39b: esperado revoked_at preenchido na tentativa anterior';
  end if;
end $$;
rollback to savepoint case_39;

-- ------------------------------------------------------------
-- Caso 40: nova emissão enquanto existe uma tentativa COMPLETED insere
-- uma linha nova — a linha completed anterior é preservada intacta
-- (nunca revogada nem sobrescrita — completed já é estado terminal por
-- si só, revoked_at continua null nela).
-- ------------------------------------------------------------
savepoint case_40;
do $$
begin
  perform set_config('app.case40_session_id_1', gen_random_uuid()::text, true);
  perform set_config('app.case40_nonce_1', 'nonce-caso-40-primeiro', true);
end $$;
set local role service_role;
do $$ begin
  perform public.issue_password_recovery_grant(
    current_setting('app.merchant_multi_id')::uuid,
    current_setting('app.case40_session_id_1')::uuid,
    current_setting('app.case40_nonce_1'),
    1800
  );
end $$;
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('app.merchant_multi_id'), 'session_id', current_setting('app.case40_session_id_1'))::text,
  true
);
do $$
declare
  v_claim jsonb;
begin
  select public.claim_recovery_grant_for_password_change(current_setting('app.case40_nonce_1')) into v_claim;
  if (v_claim->>'claimed')::boolean <> true then
    raise exception 'FAIL - Caso 40 (setup): claim deveria ter tido sucesso, obtido %', v_claim;
  end if;
  perform set_config('app.case40_attempt_id_1', v_claim->>'attempt_id', true);
  perform set_config('app.case40_capability_1', v_claim->>'completion_capability', true);
end $$;
reset role;

do $$
begin
  update auth.users set encrypted_password = 'fake-bcrypt-hash-caso-40-' || gen_random_uuid()::text
    where id = current_setting('app.merchant_multi_id')::uuid;
end $$;

set local role service_role;
do $$
declare
  v_completed boolean;
begin
  select public.complete_password_recovery_attempt(
    current_setting('app.case40_attempt_id_1')::uuid,
    current_setting('app.case40_capability_1')
  ) into v_completed;
  if v_completed <> true then
    raise exception 'FAIL - Caso 40 (setup): complete deveria ter tido sucesso, obtido %', v_completed;
  end if;
end $$;
reset role;

-- Nova recuperação para o MESMO usuário, DEPOIS de a primeira já estar
-- completed — insere uma linha nova (não reabre nem toca a completed).
set local role service_role;
do $$
declare
  v_second_id uuid;
begin
  select public.issue_password_recovery_grant(
    current_setting('app.merchant_multi_id')::uuid,
    gen_random_uuid(),
    'nonce-caso-40-segundo',
    1800
  ) into v_second_id;
  perform set_config('app.case40_second_id', v_second_id::text, true);
end $$;
reset role;

do $$
declare
  v_first_completed_at timestamptz;
  v_first_revoked_at timestamptz;
  v_second_exists boolean;
  v_active_count int;
begin
  select completed_at, revoked_at into v_first_completed_at, v_first_revoked_at
    from public.password_recovery_grants where id = current_setting('app.case40_attempt_id_1')::uuid;
  select exists(select 1 from public.password_recovery_grants where id = current_setting('app.case40_second_id')::uuid) into v_second_exists;
  select count(*) into v_active_count from public.password_recovery_grants
    where user_id = current_setting('app.merchant_multi_id')::uuid
      and completed_at is null and revoked_at is null;
  if v_first_completed_at is not null and v_first_revoked_at is null and v_second_exists and v_active_count = 1 then
    raise notice 'PASS - Caso 40: nova emissao apos tentativa completed insere linha nova; a completed anterior permanece intacta (nao revogada, nao sobrescrita)';
  else
    raise exception 'FAIL - Caso 40: esperado completed intacta + segunda linha nova + 1 ativa, obtido completed_at=%, revoked_at=%, segunda_existe=%, ativas=%', v_first_completed_at, v_first_revoked_at, v_second_exists, v_active_count;
  end if;
end $$;
rollback to savepoint case_40;

-- ------------------------------------------------------------
-- Caso 41: troca de senha sem NENHUMA tentativa de recuperação em
-- andamento não fabrica password_recovery_completed — sem trigger
-- automática nenhuma (removida nesta correção), não há absolutamente
-- nenhum caminho que reaja sozinho a uma alteração de auth.users.
-- ------------------------------------------------------------
savepoint case_41;
do $$
begin
  update auth.users set encrypted_password = 'fake-bcrypt-hash-caso-41-' || gen_random_uuid()::text
    where id = current_setting('app.merchant_onboarding_id')::uuid;
end $$;
do $$
declare
  v_evento_qtd int;
begin
  select count(*) into v_evento_qtd from public.audit_log
    where actor_user_id = current_setting('app.merchant_onboarding_id')::uuid
      and action = 'password_recovery_completed';
  if v_evento_qtd = 0 then
    raise notice 'PASS - Caso 41: troca de senha sem nenhuma tentativa de recuperacao em andamento nao fabrica password_recovery_completed';
  else
    raise exception 'FAIL - Caso 41: esperado 0 eventos fabricados, obtido %', v_evento_qtd;
  end if;
end $$;
rollback to savepoint case_41;

-- Nenhuma alteração persiste: garante execução repetível a qualquer momento.
rollback;
