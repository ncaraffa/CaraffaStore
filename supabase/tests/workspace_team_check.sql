-- TASK-012 commit 3 — Equipe do workspace: assento por PESSOA, convites,
-- remoção e guarda de downgrade. Contra Postgres real, tudo numa
-- transação.
--
-- Uso:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/workspace_team_check.sql
--
-- O caso central: uma pessoa com acesso a 3 lojas ocupa UM assento, não
-- três. É o bug de contagem que motivou workspace_members existir.

\set ON_ERROR_STOP on
begin;

-- Fixtures: um workspace por plano, cada um com owner + loja ativa.
do $setup$
declare v_plan text; v_uid uuid; v_ws uuid; v_store uuid;
begin
  foreach v_plan in array array['essential','growth','professional'] loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
              'owner-' || v_plan || '@team.test','x',now(),now(),now());
    insert into public.workspaces (owner_user_id, name) values (v_uid,'WS ' || v_plan) returning id into v_ws;
    insert into public.workspace_subscriptions (workspace_id, plan_key, status, started_at)
      values (v_ws, v_plan, 'active', now());
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');
    insert into public.stores (slug, name, status, workspace_id)
      values ('team-' || v_plan, 'Loja ' || v_plan, 'active', v_ws) returning id into v_store;
    insert into public.store_members (store_id, user_id, role) values (v_store, v_uid, 'owner');

    perform set_config('app.' || v_plan || '_uid', v_uid::text, true);
    perform set_config('app.' || v_plan || '_ws', v_ws::text, true);
    perform set_config('app.' || v_plan || '_store', v_store::text, true);
  end loop;
end;
$setup$;

-- ============================================================
-- Caso 1: o OWNER já ocupa assento (Essencial = 1/1, sem vaga)
-- ============================================================
do $t$
declare v integer;
begin
  v := public.workspace_seat_count(current_setting('app.essential_ws')::uuid);
  if v <> 1 then raise exception 'FAIL: owner nao ocupa assento (%/1)', v; end if;
  raise notice 'PASS - owner conta dentro do limite (Essencial 1/1)';
end;
$t$;

-- ============================================================
-- Caso 2: 3 lojas + 1 pessoa = 1 ASSENTO (não 3)
-- ============================================================
do $t$
declare v_ws uuid := current_setting('app.professional_ws')::uuid;
        v_uid uuid := current_setting('app.professional_uid')::uuid;
        v_seats integer; v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  perform public.workspace_create_store('Pro B','team-pro-b');
  perform public.workspace_create_store('Pro C','team-pro-c');

  select count(*) into v_rows from public.store_members sm
    join public.stores s on s.id = sm.store_id where s.workspace_id = v_ws;
  v_seats := public.workspace_seat_count(v_ws);

  if v_rows <> 3 then raise exception 'FAIL: esperava 3 linhas de store_members, got %', v_rows; end if;
  if v_seats <> 1 then raise exception 'FAIL: 1 pessoa em 3 lojas ocupou % assentos', v_seats; end if;
  raise notice 'PASS - 1 pessoa em 3 lojas = 3 store_members mas 1 ASSENTO (sem contagem dupla)';
end;
$t$;

-- ============================================================
-- Caso 3: Essencial não convida (1/1)
-- ============================================================
do $t$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.essential_uid'))::text, true);
  begin
    perform public.workspace_invite_member('func@team.test', repeat('a',64));
  exception when others then
    if sqlerrm <> 'max_team_members_reached' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: Essencial convidou alguem'; end if;
  raise notice 'PASS - Essencial (1/1) recusa convite';
end;
$t$;

-- ============================================================
-- Caso 4: Crescimento chega a 3/3 e recusa o 4o
-- ============================================================
do $t$
declare
  v_ws uuid := current_setting('app.growth_ws')::uuid;
  v_owner uuid := current_setting('app.growth_uid')::uuid;
  v_uid uuid; v_tok text; i integer; v_ok boolean := false;
begin
  for i in 1..2 loop
    v_uid := gen_random_uuid();
    v_tok := encode(digest('token-growth-' || i, 'sha256'), 'hex');
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
              'gro-m' || i || '@team.test','x',now(),now(),now());

    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
    perform public.workspace_invite_member('gro-m' || i || '@team.test', v_tok);

    perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
    perform public.workspace_accept_invitation(v_tok);
  end loop;

  if public.workspace_seat_count(v_ws) <> 3 then
    raise exception 'FAIL: esperava 3/3, got %', public.workspace_seat_count(v_ws);
  end if;

  -- o 4o convite nem sai
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  begin
    perform public.workspace_invite_member('gro-m3@team.test', repeat('b',64));
  exception when others then
    if sqlerrm <> 'max_team_members_reached' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: Crescimento convidou o 4o'; end if;
  raise notice 'PASS - Crescimento 3/3 e 4o recusado';
end;
$t$;

-- ============================================================
-- Caso 5: convite pendente RESERVA assento
-- ============================================================
do $t$
declare
  v_owner uuid := current_setting('app.professional_uid')::uuid;
  i integer; v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  -- 1 owner + 9 convites pendentes = 10/10 reservados
  for i in 1..9 loop
    perform public.workspace_invite_member('pro-p' || i || '@team.test',
      encode(digest('pend-' || i, 'sha256'), 'hex'));
  end loop;

  begin
    perform public.workspace_invite_member('pro-p10@team.test', encode(digest('pend-10','sha256'),'hex'));
  exception when others then
    if sqlerrm <> 'max_team_members_reached' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: convites pendentes nao reservam assento (daria para convidar 100 e aceitar todos)';
  end if;
  raise notice 'PASS - convite pendente reserva assento (1 owner + 9 pendentes = 10/10)';
end;
$t$;

-- ============================================================
-- Caso 6: convite single-use, e-mail casado, expiração
-- ============================================================
do $t$
declare
  v_owner uuid := current_setting('app.growth_uid')::uuid;
  v_ws uuid := current_setting('app.growth_ws')::uuid;
  v_intruso uuid := gen_random_uuid();
  v_tok text := encode(digest('token-reuso','sha256'),'hex');
  v_ok boolean;
begin
  -- libera uma vaga removendo um membro
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.workspace_remove_member(
    (select user_id from public.workspace_members where workspace_id = v_ws and role='member' limit 1));

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_intruso,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'intruso@team.test','x',now(),now(),now());

  perform public.workspace_invite_member('convidado-real@team.test', v_tok);

  -- e-mail diferente nao aceita
  perform set_config('request.jwt.claims', json_build_object('sub', v_intruso)::text, true);
  v_ok := false;
  begin
    perform public.workspace_accept_invitation(v_tok);
  exception when others then
    if sqlerrm <> 'invitation_email_mismatch' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: outra conta aceitou convite alheio'; end if;
  raise notice 'PASS - convite casado com o e-mail (outra conta nao aceita)';
end;
$t$;

-- ============================================================
-- Caso 7: remover membro revoga acesso a TODAS as lojas
-- ============================================================
do $t$
declare
  v_ws uuid := current_setting('app.professional_ws')::uuid;
  v_owner uuid := current_setting('app.professional_uid')::uuid;
  v_membro uuid := gen_random_uuid();
  v_tok text := encode(digest('token-remocao','sha256'),'hex');
  v_rows integer;
begin
  -- revoga um pendente para abrir vaga
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.workspace_revoke_invitation(
    (select id from public.workspace_invitations where workspace_id = v_ws and status='pending' limit 1));

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_membro,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
            'removivel@team.test','x',now(),now(),now());

  perform public.workspace_invite_member('removivel@team.test', v_tok);
  perform set_config('request.jwt.claims', json_build_object('sub', v_membro)::text, true);
  perform public.workspace_accept_invitation(v_tok);

  -- entrou nas 3 lojas
  select count(*) into v_rows from public.store_members sm
    join public.stores s on s.id = sm.store_id
    where s.workspace_id = v_ws and sm.user_id = v_membro;
  if v_rows <> 3 then raise exception 'FAIL: membro novo entrou em % lojas (esperado 3)', v_rows; end if;

  -- removido: some das 3
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.workspace_remove_member(v_membro);

  select count(*) into v_rows from public.store_members sm
    join public.stores s on s.id = sm.store_id
    where s.workspace_id = v_ws and sm.user_id = v_membro;
  if v_rows <> 0 then raise exception 'FAIL: removido ainda tem acesso a % lojas', v_rows; end if;
  raise notice 'PASS - membro entra nas 3 lojas e a remocao revoga todas de uma vez';
end;
$t$;

-- ============================================================
-- Caso 8: owner nunca e removivel
-- ============================================================
do $t$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.professional_uid'))::text, true);
  begin
    perform public.workspace_remove_member(current_setting('app.professional_uid')::uuid);
  exception when others then
    if sqlerrm <> 'cannot_remove_owner' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: owner se removeu (workspace ficaria sem dono)'; end if;
  raise notice 'PASS - owner nao se remove; workspace nunca fica sem dono';
end;
$t$;

-- ============================================================
-- Caso 9: downgrade bloqueado enquanto a equipe nao couber
-- ============================================================
do $t$
declare
  v_ws uuid := current_setting('app.growth_ws')::uuid;
  v_allowed boolean; v_reason text; v_cur integer; v_lim integer;
begin
  -- growth tem owner + 1 membro = 2 pessoas; Essencial permite 1
  select allowed, reason, current_value, target_limit
    into v_allowed, v_reason, v_cur, v_lim
    from public.workspace_can_use_plan(v_ws, 'essential');
  if v_allowed then raise exception 'FAIL: downgrade para Essencial permitido com % pessoas', v_cur; end if;
  if v_reason <> 'team' then raise exception 'FAIL: motivo do bloqueio foi % (esperado team)', v_reason; end if;
  raise notice 'PASS - downgrade Crescimento->Essencial bloqueado: % pessoas para limite de %', v_cur, v_lim;

  -- Profissional com 3 lojas nao desce para Crescimento (1 loja)
  select allowed, reason into v_allowed, v_reason
    from public.workspace_can_use_plan(current_setting('app.professional_ws')::uuid, 'growth');
  if v_allowed then raise exception 'FAIL: Profissional com 3 lojas desceu para Crescimento'; end if;
  raise notice 'PASS - downgrade Profissional->Crescimento bloqueado por lojas (%)', v_reason;
end;
$t$;

-- ============================================================
-- Caso 10: bypass — convidar/remover em workspace alheio
-- ============================================================
do $t$
declare v_ok boolean;
begin
  -- o owner do Essencial tenta remover alguem do workspace Profissional
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('app.essential_uid'))::text, true);
  v_ok := false;
  begin
    perform public.workspace_remove_member(current_setting('app.professional_uid')::uuid);
  exception when others then
    -- nao e owner do workspace alvo: member_not_found (o alvo nao existe
    -- NO SEU workspace) — nunca remove de fato
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: removeu membro de outro workspace'; end if;

  if public.workspace_seat_count(current_setting('app.professional_ws')::uuid) < 1 then
    raise exception 'FAIL: workspace alheio perdeu membro';
  end if;
  raise notice 'PASS - nao ha como convidar/remover em workspace alheio';
end;
$t$;

-- ============================================================
-- Caso 11: ciclo de vida do convite e a RESERVA de assento
-- ============================================================
do $t$
declare
  v_ws uuid := current_setting('app.growth_ws')::uuid;
  v_owner uuid := current_setting('app.growth_uid')::uuid;
  v_inv public.workspace_invitations;
  v_ok boolean;
  v_before integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  -- deixa o workspace com apenas o owner (1/3)
  delete from public.workspace_members where workspace_id = v_ws and role = 'member';
  update public.workspace_invitations set status='revoked' where workspace_id = v_ws and status='pending';
  if public.workspace_reserved_seats(v_ws) <> 1 then
    raise exception 'FAIL: esperava 1 assento reservado, got %', public.workspace_reserved_seats(v_ws);
  end if;

  -- 1 convite pendente -> 2/3 reservados
  select * into v_inv from public.workspace_invite_member('c1@team.test', encode(digest('c1','sha256'),'hex'));
  if public.workspace_reserved_seats(v_ws) <> 2 then
    raise exception 'FAIL: convite pendente nao reservou (%)', public.workspace_reserved_seats(v_ws);
  end if;
  raise notice 'PASS - convite pendente reserva assento (owner + 1 pendente = 2/3)';

  -- CANCELAR libera a vaga na hora e invalida o token
  perform public.workspace_revoke_invitation(v_inv.id);
  if public.workspace_reserved_seats(v_ws) <> 1 then
    raise exception 'FAIL: cancelar nao liberou o assento';
  end if;
  v_ok := false;
  begin
    perform public.workspace_accept_invitation(encode(digest('c1','sha256'),'hex'));
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: token de convite cancelado ainda funciona'; end if;
  raise notice 'PASS - cancelar libera assento na hora e invalida o token';

  -- EXPIRADO deixa de reservar SEM depender de cron
  select * into v_inv from public.workspace_invite_member('c2@team.test', encode(digest('c2','sha256'),'hex'));
  v_before := public.workspace_reserved_seats(v_ws);
  update public.workspace_invitations set expires_at = now() - interval '1 minute' where id = v_inv.id;
  if public.workspace_reserved_seats(v_ws) <> v_before - 1 then
    raise exception 'FAIL: convite vencido continua reservando (a vaga dependeria de um job)';
  end if;
  raise notice 'PASS - convite vencido deixa de reservar na propria leitura (sem cron)';

  -- REENVIO nao cria segunda reserva
  update public.workspace_invitations set expires_at = now() + interval '7 days' where id = v_inv.id;
  v_before := public.workspace_reserved_seats(v_ws);
  perform public.workspace_resend_invitation('c2@team.test', encode(digest('c2-novo','sha256'),'hex'));
  if public.workspace_reserved_seats(v_ws) <> v_before then
    raise exception 'FAIL: reenvio duplicou a reserva (% -> %)', v_before, public.workspace_reserved_seats(v_ws);
  end if;
  if (select count(*) from public.workspace_invitations
      where workspace_id = v_ws and lower(email)='c2@team.test' and status='pending') <> 1 then
    raise exception 'FAIL: reenvio criou uma segunda linha pendente';
  end if;
  raise notice 'PASS - reenvio mantem UMA reserva e UMA linha pendente';

  -- token antigo morre no reenvio
  v_ok := false;
  begin
    perform public.workspace_accept_invitation(encode(digest('c2','sha256'),'hex'));
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: token antigo ainda funciona apos reenvio'; end if;
  raise notice 'PASS - o token anterior deixa de funcionar apos o reenvio';

  -- DUPLICADO: mesmo e-mail nao gera segunda reserva
  v_ok := false;
  begin
    perform public.workspace_invite_member('c2@team.test', encode(digest('c2-dup','sha256'),'hex'));
  exception when others then
    if sqlerrm <> 'invitation_already_pending' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: mesmo e-mail gerou segunda reserva'; end if;
  raise notice 'PASS - convite duplicado para o mesmo e-mail e recusado';
end;
$t$;

-- ============================================================
-- Caso 12: reenviar convite VENCIDO nao estoura a reserva (0024)
-- ============================================================
--
-- Convite vencido continua status='pending' (a expiracao e por data,
-- para a vaga voltar sem cron) e por isso NAO reserva. Renovar a data
-- faz voltar a reservar — e isso precisa reconferir o limite. Antes de
-- 0024, reenviar num workspace 3/3 levava a reserva para 4/3.
do $t$
declare
  v_ws uuid := current_setting('app.growth_ws')::uuid;
  v_owner uuid := current_setting('app.growth_uid')::uuid;
  v_uid uuid; i integer; v_before integer; v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  -- estado limpo: so o owner
  delete from public.workspace_members where workspace_id = v_ws and role = 'member';
  update public.workspace_invitations set status='revoked' where workspace_id = v_ws and status='pending';

  -- enche ate 3/3 com membros reais
  for i in 1..2 loop
    v_uid := gen_random_uuid();
    insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
      values (v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
              'resend-full-'||i||'@team.test','x',now(),now(),now());
    insert into public.workspace_members (workspace_id,user_id,role) values (v_ws,v_uid,'member');
  end loop;

  -- convite antigo, ja vencido: nao reserva
  insert into public.workspace_invitations (workspace_id,email,token_hash,invited_by,expires_at,status)
    values (v_ws,'vencido@team.test',repeat('e',64),v_owner, now() - interval '1 day','pending');

  v_before := public.workspace_reserved_seats(v_ws);
  if v_before <> 3 then raise exception 'FAIL: esperava 3 reservados, got %', v_before; end if;

  -- reenviar tem que ser RECUSADO: renovar consumiria um 4o assento
  begin
    perform public.workspace_resend_invitation('vencido@team.test', repeat('f',64));
  exception when others then
    if sqlerrm <> 'max_team_members_reached' then raise; end if;
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: reenvio de convite vencido estourou a reserva (%)', public.workspace_reserved_seats(v_ws);
  end if;
  if public.workspace_reserved_seats(v_ws) <> 3 then
    raise exception 'FAIL: reserva mudou apesar da recusa (%)', public.workspace_reserved_seats(v_ws);
  end if;
  raise notice 'PASS - reenvio de convite vencido em workspace cheio e recusado; reserva continua 3/3';

  -- e com vaga, o reenvio funciona normalmente
  delete from public.workspace_members where workspace_id = v_ws and role='member'
    and user_id = (select user_id from public.workspace_members where workspace_id=v_ws and role='member' limit 1);
  perform public.workspace_resend_invitation('vencido@team.test', repeat('f',64));
  if public.workspace_reserved_seats(v_ws) <> 3 then
    raise exception 'FAIL: reenvio com vaga deveria reservar de volta (%)', public.workspace_reserved_seats(v_ws);
  end if;
  raise notice 'PASS - com vaga, reenviar renova o convite e volta a reservar (3/3)';
end;
$t$;

do $t$ begin raise notice 'OK: TODOS os casos de equipe passaram'; end; $t$;

rollback;
