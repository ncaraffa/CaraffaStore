-- TASK-012 commit 3 (parte 2) — Sessão da CaraffaStore e sessão única
-- do Essencial.
--
-- DESCOBERTA QUE DEFINE A ARQUITETURA
--
-- O access token do Supabase carrega `session_id` (verificado
-- empiricamente contra o GoTrue local), e ele é legível DENTRO do
-- Postgres via auth.jwt() ->> 'session_id' — inclusive numa chamada
-- PostgREST direta, sem passar pelo Next.js. Três propriedades
-- confirmadas antes de modelar:
--
--   1. o claim existe e chega ao banco;
--   2. dois logins do mesmo usuário geram session_id DIFERENTES
--      (é o que distingue o browser A do browser B);
--   3. refresh_token PRESERVA o session_id
--      (refresh não pode criar app_session nova — requisito 13).
--
-- Consequência: o enforcement vive no BANCO, não no middleware. Um JWT
-- ainda válido cujo app_session foi revogado perde autorização mesmo
-- chamando supabase.rpc(...) diretamente — que é exatamente o critério
-- de aceitação do requisito 10/24. Nada de token paralelo em cookie,
-- nada de fingerprint: a identidade de sessão é a que o próprio Supabase
-- já emite, e nós só decidimos quais delas continuam autorizadas.
--
-- O QUE ESTA CAMADA NÃO É
--
-- Não substitui autenticação nem RLS. É uma condição ADICIONAL: quem
-- não passava antes continua não passando. A única coisa que ela pode
-- fazer é NEGAR quem já estaria autorizado.

-- ============================================================
-- 1. maxConcurrentSessions é um entitlement — e não é maxTeamMembers
-- ============================================================
--
-- São coisas diferentes e ficam em colunas diferentes de propósito:
--   max_team_members       -> quantas PESSOAS o workspace comporta
--   max_concurrent_sessions-> quantas SESSÕES simultâneas o workspace
--                             comporta (NULL = sem limite)
--
-- Só o Essencial limita sessão. Crescimento e Profissional pagam por
-- pessoas e cada uma usa quantos dispositivos quiser — impor "um
-- dispositivo por membro" neles seria uma restrição inventada.

alter table public.platform_plans add column max_concurrent_sessions integer
  check (max_concurrent_sessions is null or max_concurrent_sessions > 0);

update public.platform_plans set max_concurrent_sessions = 1 where plan_key = 'essential';
update public.platform_plans set max_concurrent_sessions = null where plan_key in ('growth', 'professional');

comment on column public.platform_plans.max_concurrent_sessions is
  'Sessões simultâneas do workspace. NULL = ilimitado. Só o Essencial usa 1: como ele tem exatamente 1 pessoa, é o que impede dono e funcionário compartilharem a MESMA conta em dispositivos diferentes ao mesmo tempo. NÃO confundir com max_team_members — nos planos superiores o controle é por conta/pessoa, nunca por dispositivo.';

-- ============================================================
-- 2. app_sessions
-- ============================================================

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  -- SHA-256 do session_id do Supabase — nunca o valor em claro. O banco
  -- recalcula o hash a partir de auth.jwt() na hora de decidir, então o
  -- valor original nunca precisa ser persistido nem trafegado por nós.
  supabase_session_hash text not null unique,

  -- Congelado na criação a partir do plano: permite o índice único
  -- parcial abaixo, que é a garantia ESTRUTURAL de sessão única. Sem
  -- essa coluna o índice teria que consultar o plano, o que um índice
  -- não pode fazer.
  enforces_single_session boolean not null default false,

  user_agent_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason in (
    'logout', 'takeover', 'member_removed', 'stale', 'plan_downgrade', 'admin'
  ))
);

comment on table public.app_sessions is
  'Sessão da aplicação, uma por sessão do Supabase (logo: uma por browser, não por aba — abas compartilham o mesmo session_id do token). Guarda apenas o HASH do session_id. Revogar uma linha aqui retira autorização de TODA requisição que carregue aquele JWT, inclusive chamadas diretas a PostgREST — é isso que faz a sessão única não ser cosmética.';

comment on column public.app_sessions.supabase_session_hash is
  'SHA-256 de auth.jwt() ->> session_id. Múltiplas abas do mesmo browser compartilham o mesmo session_id e portanto a MESMA linha aqui. Refresh do token preserva o session_id, então renovar credencial não cria sessão nova.';

comment on column public.app_sessions.enforces_single_session is
  'Snapshot de (plano.max_concurrent_sessions = 1) no momento da criação. Existe para viabilizar o índice único parcial — a garantia de "uma ativa por workspace" precisa ser do banco, não de um IF na aplicação.';

-- A GARANTIA ESTRUTURAL: no máximo UMA sessão ativa por workspace quando
-- o plano exige. Duas tentativas de login realmente simultâneas colidem
-- aqui, no banco — nunca em memória.
create unique index app_sessions_single_active_per_workspace
  on public.app_sessions (workspace_id)
  where revoked_at is null and enforces_single_session;

-- Lookup por hash é o caminho quente: acontece em toda checagem de
-- autorização. Índice único já criado acima na coluna cobre isso.
create index app_sessions_workspace_active_idx
  on public.app_sessions (workspace_id) where revoked_at is null;
create index app_sessions_user_idx on public.app_sessions (user_id, workspace_id);
create index app_sessions_last_seen_idx on public.app_sessions (last_seen_at) where revoked_at is null;

alter table public.app_sessions enable row level security;

-- A pessoa enxerga as próprias sessões (para a tela "dispositivos
-- conectados"). Nenhuma policy de escrita: tudo por SECURITY DEFINER.
create policy app_sessions_select_own on public.app_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.app_sessions to authenticated;

-- ============================================================
-- 3. Janelas de heartbeat e stale — e por quê
-- ============================================================
--
--   heartbeat ..... a cada 5 minutos
--   stale ......... 30 minutos sem sinal
--
-- Racional: 30 min tolera SEIS batidas perdidas. Isso cobre notebook
-- suspenso por um tempo, celular em background, queda de rede e o
-- throttling agressivo que os browsers aplicam a abas ocultas (que pode
-- reduzir timers a ~1/min ou congelá-los). Um valor curto (60s) marcaria
-- como morta uma sessão viva só porque a aba estava em segundo plano —
-- e o cliente legítimo seria desconectado sozinho.
--
-- O custo de ser tolerante é que uma sessão ABANDONADA continua
-- ocupando a vaga por até 30 min. Isso NÃO prende o cliente legítimo:
-- ele sempre pode fazer takeover explícito e entrar na hora, sem
-- esperar TTL nenhum (requisito 15).

create or replace function public.app_session_stale_window()
returns interval language sql immutable set search_path = '' as $fn$ select interval '30 minutes' $fn$;

create or replace function public.app_session_max_lifetime()
returns interval language sql immutable set search_path = '' as $fn$ select interval '30 days' $fn$;

-- ============================================================
-- 4. O ponto único de decisão
-- ============================================================

create or replace function public.current_supabase_session_hash()
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when auth.jwt() ->> 'session_id' is null then null
    else encode(extensions.digest(auth.jwt() ->> 'session_id', 'sha256'), 'hex')
  end;
$fn$;

revoke all on function public.current_supabase_session_hash() from public;
grant execute on function public.current_supabase_session_hash() to authenticated, service_role;

/*
 * REGRA DE NEGAÇÃO — deliberadamente precisa.
 *
 * Nega quando existe uma linha app_sessions correspondente a ESTE JWT e
 * ela está revogada (ou vencida). NÃO nega pela ausência de linha.
 *
 * Por que não exigir a presença da linha? Porque isso derrubaria todo
 * mundo que já está logado no instante do deploy: os JWTs em circulação
 * são anteriores à existência da tabela. Exigir presença transformaria
 * um deploy em logout global de produção.
 *
 * Isso abre um bypass? Não. Para ser negado basta existir a linha
 * revogada, e ela é criada no login/entrada no painel. O caminho do
 * ataque seria "não ter linha nenhuma", mas quem foi vítima de takeover
 * TEM linha — ela acabou de ser revogada. E ninguém consegue apagar a
 * própria linha: não há policy de DELETE/UPDATE para authenticated, e o
 * session_id vem assinado dentro do JWT, então também não dá para
 * forjar outro.
 */
create or replace function public.app_session_denied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.app_sessions s
    where s.supabase_session_hash = public.current_supabase_session_hash()
      and (s.revoked_at is not null or s.expires_at <= now())
  );
$fn$;

comment on function public.app_session_denied() is
  'TRUE quando o JWT desta requisição pertence a uma sessão da CaraffaStore revogada ou vencida. É a condição ADICIONAL consultada pelos três helpers centrais de autorização (is_store_member, is_store_admin, can_manage_store_catalog) — e por isso vale igualmente para Server Action, API route e chamada PostgREST direta. Nega apenas quem já teria passado; nunca autoriza ninguém.';

revoke all on function public.app_session_denied() from public;
grant execute on function public.app_session_denied() to authenticated, service_role;

-- ============================================================
-- 5. Os três helpers centrais passam a exigir sessão viva
-- ============================================================
--
-- 58 referências em 14 migrations dependem destes três. Alterá-los aqui
-- cobre catálogo, pedidos, pagamentos, billing, equipe e painel de uma
-- vez — sem espalhar checagem por dezenas de arquivos (requisito 11) e
-- sem criar um segundo sistema de autorização paralelo à RLS.

create or replace function public.is_store_member(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $fn$
  select not public.app_session_denied() and exists (
    select 1
    from public.store_members sm
    where sm.store_id = target_store_id
      and sm.user_id = auth.uid()
  );
$fn$;

create or replace function public.is_store_admin(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $fn$
  select not public.app_session_denied() and exists (
    select 1
    from public.store_members sm
    where sm.store_id = target_store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  );
$fn$;

create or replace function public.can_manage_store_catalog(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $fn$
  select not public.app_session_denied() and exists (
    select 1
    from public.store_members sm
    join public.stores s on s.id = sm.store_id
    where sm.store_id = target_store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
      and s.status = 'active'
  );
$fn$;

comment on function public.is_store_member(uuid) is
  'Vínculo do usuário com a loja E sessão da CaraffaStore viva. TASK-012: a segunda condição é o que faz uma sessão revogada perder acesso mesmo com JWT do Supabase ainda dentro da validade. Vale para qualquer caminho — inclusive PostgREST direto.';

-- ------------------------------------------------------------
-- Guarda explícita para quem NÃO passa pelos três helpers
-- ------------------------------------------------------------
--
-- is_store_member/is_store_admin/can_manage_store_catalog cobrem tudo
-- que parte de uma LOJA. Mas as funções de workspace (criar loja,
-- convidar, remover, cancelar convite) derivam a autorização de
-- workspace_members direto, então não passariam por nenhum deles — e uma
-- sessão revogada com quota sobrando conseguiria criar loja ou convidar
-- alguém. Achado pelo teste de ponta a ponta com JWT real.
create or replace function public.require_active_app_session()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if public.app_session_denied() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
end;
$fn$;

comment on function public.require_active_app_session() is
  'Levanta insufficient_privilege quando a sessão da CaraffaStore deste JWT foi revogada. Usada pelas funções de WORKSPACE, que autorizam por workspace_members e portanto não passam pelos três helpers de loja. Sem ela, uma sessão revogada com quota disponível ainda criaria loja ou convidaria membro.';

revoke all on function public.require_active_app_session() from public;
grant execute on function public.require_active_app_session() to authenticated, service_role;

-- ============================================================
-- 6. Abrir / renovar a sessão
-- ============================================================

create or replace function public.app_session_start(
  p_workspace_id uuid,
  p_user_agent_label text default null,
  p_takeover boolean default false
)
returns table (session_id uuid, conflict boolean, other_label text, other_last_seen timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_hash text := public.current_supabase_session_hash();
  v_single boolean;
  v_existing public.app_sessions;
  v_other public.app_sessions;
  v_id uuid;
begin
  if v_uid is null or v_hash is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  -- Precisa ser membro do workspace. Consulta direta a
  -- workspace_members de propósito: usar is_store_member aqui criaria
  -- dependência circular com app_session_denied.
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_uid
  ) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- Serializa logins/takeovers concorrentes do mesmo workspace.
  perform 1 from public.workspaces where id = p_workspace_id for update;

  select coalesce(max_concurrent_sessions, 0) = 1 into v_single
    from public.workspace_entitlements(p_workspace_id);

  -- Renovação da própria sessão (navegação normal, refresh de token,
  -- outra aba): NÃO cria linha nova, só atualiza o lease.
  select * into v_existing from public.app_sessions where supabase_session_hash = v_hash;
  if v_existing.id is not null and v_existing.revoked_at is null and v_existing.expires_at > now() then
    update public.app_sessions set last_seen_at = now() where id = v_existing.id;
    return query select v_existing.id, false, null::text, null::timestamptz;
    return;
  end if;

  -- Sessão abandonada deixa de ocupar a vaga (lease vencido). Feito
  -- DENTRO desta transação: a liberação nunca depende de um cron.
  update public.app_sessions
    set revoked_at = now(), revoked_reason = 'stale'
    where workspace_id = p_workspace_id
      and revoked_at is null
      and last_seen_at < now() - public.app_session_stale_window();

  if v_single then
    select * into v_other from public.app_sessions
      where workspace_id = p_workspace_id
        and revoked_at is null
        and expires_at > now()
        and supabase_session_hash is distinct from v_hash
      limit 1;

    if v_other.id is not null then
      if not p_takeover then
        -- Devolve o conflito em vez de levantar exceção: a tela precisa
        -- explicar E oferecer o takeover, não mostrar um erro cru.
        return query select null::uuid, true, v_other.user_agent_label, v_other.last_seen_at;
        return;
      end if;

      update public.app_sessions
        set revoked_at = now(), revoked_reason = 'takeover'
        where id = v_other.id;

      insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
      select v_uid, s.id, 'session_revoked', 'app_session', v_other.id::text,
             jsonb_build_object('reason', 'takeover', 'workspace_id', p_workspace_id)
      from public.stores s where s.workspace_id = p_workspace_id limit 1;
    end if;
  end if;

  insert into public.app_sessions (
    workspace_id, user_id, supabase_session_hash, enforces_single_session,
    user_agent_label, expires_at
  ) values (
    p_workspace_id, v_uid, v_hash, coalesce(v_single, false),
    left(nullif(trim(p_user_agent_label), ''), 80),
    now() + public.app_session_max_lifetime()
  )
  on conflict (supabase_session_hash) do update
    set revoked_at = null, revoked_reason = null, last_seen_at = now(),
        expires_at = now() + public.app_session_max_lifetime()
  returning id into v_id;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  select v_uid, s.id, 'session_created', 'app_session', v_id::text,
         jsonb_build_object('workspace_id', p_workspace_id, 'takeover', p_takeover)
  from public.stores s where s.workspace_id = p_workspace_id limit 1;

  return query select v_id, false, null::text, null::timestamptz;
end;
$fn$;

comment on function public.app_session_start(uuid, text, boolean) is
  'Abre ou renova a sessão da CaraffaStore para o session_id do JWT atual. Idempotente por browser: abas e refresh de token caem no ramo de renovação e nunca criam linha nova. Quando o plano exige sessão única, devolve conflict=true (com rótulo e último acesso da outra sessão) em vez de erro cru; com p_takeover revoga a outra e assume, tudo sob lock do workspace — não existe janela com duas ativas. Sessão abandonada além do lease é revogada aqui mesmo, sem depender de cron.';

revoke all on function public.app_session_start(uuid, text, boolean) from public;
grant execute on function public.app_session_start(uuid, text, boolean) to authenticated;

-- ============================================================
-- 7. Heartbeat, logout e revogação
-- ============================================================

create or replace function public.app_session_heartbeat()
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_hash text := public.current_supabase_session_hash(); v_rows integer;
begin
  if v_hash is null then return false; end if;

  update public.app_sessions
    set last_seen_at = now()
    where supabase_session_hash = v_hash
      and revoked_at is null
      and expires_at > now();

  -- row_count é INTEGER: atribuir direto a boolean é erro de tipo
  -- (achado pelo teste de ponta a ponta).
  get diagnostics v_rows = row_count;
  -- false = esta sessão não é mais válida; o cliente deve encerrar.
  return v_rows > 0;
end;
$fn$;

comment on function public.app_session_heartbeat() is
  'Renova o lease da sessão atual (a cada ~5 min no cliente). Devolve false quando a sessão foi revogada — é o sinal para o frontend encerrar e voltar ao login. NÃO é o mecanismo de segurança: quem nega o acesso são os helpers de autorização, mesmo que o cliente ignore este retorno.';

revoke all on function public.app_session_heartbeat() from public;
grant execute on function public.app_session_heartbeat() to authenticated;

create or replace function public.app_session_logout()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_hash text := public.current_supabase_session_hash();
begin
  if v_hash is null then return; end if;
  update public.app_sessions
    set revoked_at = now(), revoked_reason = 'logout'
    where supabase_session_hash = v_hash and revoked_at is null;
end;
$fn$;

revoke all on function public.app_session_logout() from public;
grant execute on function public.app_session_logout() to authenticated;

-- ============================================================
-- 8. Remoção de membro revoga as sessões dele
-- ============================================================

create or replace function public.workspace_remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace_id uuid;
  v_target_role text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  perform public.require_active_app_session();

  select workspace_id into v_workspace_id from public.workspace_members
    where user_id = v_uid and role = 'owner';
  if v_workspace_id is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  perform 1 from public.workspaces where id = v_workspace_id for update;

  select role into v_target_role from public.workspace_members
    where workspace_id = v_workspace_id and user_id = p_user_id;
  if v_target_role is null then
    raise exception 'member_not_found' using errcode = '02000';
  end if;
  if v_target_role = 'owner' then
    raise exception 'cannot_remove_owner' using errcode = '42501';
  end if;

  delete from public.workspace_members
    where workspace_id = v_workspace_id and user_id = p_user_id;

  perform public.workspace_sync_store_access(v_workspace_id);

  -- TASK-012 parte 2: o removido perde o acesso AGORA, não quando o JWT
  -- dele vencer. Sem esta revogação, um ex-funcionário continuaria
  -- operando a loja por horas com o token que já tinha em mãos.
  update public.app_sessions
    set revoked_at = now(), revoked_reason = 'member_removed'
    where workspace_id = v_workspace_id and user_id = p_user_id and revoked_at is null;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  select v_uid, s.id, 'member_removed', 'workspace_member', p_user_id::text,
         jsonb_build_object('workspace_id', v_workspace_id)
  from public.stores s where s.workspace_id = v_workspace_id limit 1;
end;
$fn$;

comment on function public.workspace_remove_member(uuid) is
  'Remove a pessoa do workspace, revoga o acesso dela a todas as lojas E revoga as sessões dela naquele workspace — as três coisas na mesma transação. O owner nunca é removível por aqui.';

revoke all on function public.workspace_remove_member(uuid) from public;
grant execute on function public.workspace_remove_member(uuid) to authenticated;

-- ============================================================
-- 9. Troca de plano e sessões
-- ============================================================
--
-- Descer para o Essencial não pode deixar o workspace nascer com 3
-- sessões ativas. Escolha: PRESERVAR A MAIS RECENTE e revogar as
-- demais. É determinístico e é a melhor UX — quem acabou de ativar o
-- downgrade está justamente na sessão mais recente, então não se
-- autoexpulsa. Bloquear o downgrade até "consolidar sessões" puniria o
-- cliente por algo que o sistema resolve sozinho em uma transação.

create or replace function public.workspace_apply_session_policy(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_single boolean;
  v_keep uuid;
  v_revoked integer := 0;
begin
  select coalesce(max_concurrent_sessions, 0) = 1 into v_single
    from public.workspace_entitlements(p_workspace_id);

  -- Subindo de plano: a restrição some e todas as sessões seguem vivas.
  if not coalesce(v_single, false) then
    update public.app_sessions
      set enforces_single_session = false
      where workspace_id = p_workspace_id and revoked_at is null;
    return 0;
  end if;

  -- Descendo para o Essencial a ORDEM importa: marcar
  -- enforces_single_session=true com várias sessões ativas violaria o
  -- índice único parcial na hora. Primeiro consolida, depois marca
  -- (achado pelo teste de ponta a ponta).
  select id into v_keep from public.app_sessions
    where workspace_id = p_workspace_id and revoked_at is null and expires_at > now()
    order by last_seen_at desc, created_at desc
    limit 1;

  update public.app_sessions
    set revoked_at = now(), revoked_reason = 'plan_downgrade'
    where workspace_id = p_workspace_id
      and revoked_at is null
      and (v_keep is null or id <> v_keep);

  get diagnostics v_revoked = row_count;

  update public.app_sessions
    set enforces_single_session = true
    where workspace_id = p_workspace_id and revoked_at is null;

  return v_revoked;
end;
$fn$;

comment on function public.workspace_apply_session_policy(uuid) is
  'Reconcilia as sessões com o plano vigente. Subindo para Crescimento/Profissional a restrição some (enforces_single_session=false) e o cliente deixa de ficar preso a uma sessão. Descendo para o Essencial preserva a sessão MAIS RECENTE e revoga as outras — determinístico e sem autoexpulsar quem acabou de fazer a troca.';

revoke all on function public.workspace_apply_session_policy(uuid) from public;
grant execute on function public.workspace_apply_session_policy(uuid) to service_role;

-- ============================================================
-- 10. Convites: reserva de assento com regras completas
-- ============================================================

-- Reenviar NÃO cria segunda reserva: atualiza o convite pendente que já
-- existe (token novo, prazo novo), preservando UMA reserva.
create or replace function public.workspace_resend_invitation(
  p_email text,
  p_token_hash text
)
returns public.workspace_invitations
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace_id uuid;
  v_email text := lower(nullif(trim(p_email), ''));
  v_row public.workspace_invitations;
begin
  select workspace_id into v_workspace_id from public.workspace_members
    where user_id = v_uid and role = 'owner';
  if v_workspace_id is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_token_hash is null or char_length(p_token_hash) <> 64 then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  update public.workspace_invitations
    set token_hash = p_token_hash, expires_at = now() + interval '7 days'
    where workspace_id = v_workspace_id and lower(email) = v_email and status = 'pending'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'invitation_not_found' using errcode = '02000';
  end if;

  return v_row;
end;
$fn$;

comment on function public.workspace_resend_invitation(text, text) is
  'Reenvia um convite pendente: gera token novo e renova o prazo NA MESMA linha. Nunca cria uma segunda linha pendente para o mesmo e-mail, logo nunca duplica a reserva de assento. O token anterior deixa de funcionar (o hash foi substituído).';

revoke all on function public.workspace_resend_invitation(text, text) from public;
grant execute on function public.workspace_resend_invitation(text, text) to authenticated;

-- Cancelar libera o assento IMEDIATAMENTE e invalida o token.
create or replace function public.workspace_revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id from public.workspace_members
    where user_id = v_uid and role = 'owner';
  if v_workspace_id is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- token_hash vira um valor inutilizável: o convite cancelado não pode
  -- ser aceito nem por quem já tinha o link no e-mail.
  update public.workspace_invitations
    set status = 'revoked',
        token_hash = 'revoked:' || id::text
    where id = p_invitation_id and workspace_id = v_workspace_id and status = 'pending';
  if not found then
    raise exception 'invitation_not_found' using errcode = '02000';
  end if;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  select v_uid, s.id, 'member_invitation_revoked', 'workspace_invitation', p_invitation_id::text,
         jsonb_build_object('workspace_id', v_workspace_id)
  from public.stores s where s.workspace_id = v_workspace_id limit 1;
end;
$fn$;

comment on function public.workspace_revoke_invitation(uuid) is
  'Cancela um convite pendente: libera o assento na hora e INVALIDA o token (o hash é substituído), de modo que o link já enviado por e-mail deixa de funcionar.';

revoke all on function public.workspace_revoke_invitation(uuid) from public;
grant execute on function public.workspace_revoke_invitation(uuid) to authenticated;

-- Contagem de assentos reservados: membros + convites pendentes AINDA
-- VÁLIDOS. A expiração é avaliada na consulta — a vaga volta sozinha
-- quando o prazo passa, sem depender de nenhum job.
create or replace function public.workspace_reserved_seats(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.workspace_seat_count(p_workspace_id)
       + (select count(*)::integer from public.workspace_invitations
          where workspace_id = p_workspace_id
            and status = 'pending'
            and expires_at > now());
$fn$;

comment on function public.workspace_reserved_seats(uuid) is
  'Assentos comprometidos: pessoas já dentro + convites pendentes NÃO vencidos. A validade é checada aqui, na leitura — um convite expirado deixa de reservar no mesmo instante, sem esperar cron (requisito 1). Um job de limpeza pode existir, mas a autorização nunca depende dele.';

revoke all on function public.workspace_reserved_seats(uuid) from public;
grant execute on function public.workspace_reserved_seats(uuid) to authenticated, service_role;

-- workspace_invite_member passa a usar a contagem unificada.
create or replace function public.workspace_invite_member(
  p_email text,
  p_token_hash text
)
returns public.workspace_invitations
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace_id uuid;
  v_limit integer;
  v_reserved integer;
  v_email text := lower(nullif(trim(p_email), ''));
  v_row public.workspace_invitations;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_token_hash is null or char_length(p_token_hash) <> 64 then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  perform public.require_active_app_session();

  select workspace_id into v_workspace_id from public.workspace_members
    where user_id = v_uid and role = 'owner';
  if v_workspace_id is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  perform 1 from public.workspaces where id = v_workspace_id for update;

  -- Já é membro: idempotente e sem consumir assento nenhum.
  if exists (
    select 1 from public.workspace_members wm
    join auth.users u on u.id = wm.user_id
    where wm.workspace_id = v_workspace_id and lower(u.email) = v_email
  ) then
    raise exception 'already_member' using errcode = '42710';
  end if;

  select max_team_members into v_limit from public.workspace_entitlements(v_workspace_id);
  if v_limit is null then
    raise exception 'subscription_not_found' using errcode = '02000';
  end if;

  v_reserved := public.workspace_reserved_seats(v_workspace_id);
  if v_reserved >= v_limit then
    raise exception 'max_team_members_reached' using errcode = '23514';
  end if;

  begin
    insert into public.workspace_invitations (workspace_id, email, token_hash, invited_by, expires_at)
    values (v_workspace_id, v_email, p_token_hash, v_uid, now() + interval '7 days')
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'invitation_already_pending' using errcode = '42710';
  end;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  select v_uid, s.id, 'member_invited', 'workspace_invitation', v_row.id::text,
         jsonb_build_object('workspace_id', v_workspace_id, 'email', v_email)
  from public.stores s where s.workspace_id = v_workspace_id limit 1;

  return v_row;
end;
$fn$;

comment on function public.workspace_invite_member(text, text) is
  'Convida para o workspace. Usa workspace_reserved_seats (membros + convites pendentes válidos): convite pendente reserva, convite VENCIDO deixa de reservar automaticamente, e cancelar libera na hora. Só o owner convida; o workspace vem de auth.uid(). Recebe apenas o HASH do token.';

revoke all on function public.workspace_invite_member(text, text) from public;
grant execute on function public.workspace_invite_member(text, text) to authenticated;

-- ============================================================
-- 11. workspace_create_store também exige sessão viva
-- ============================================================
--
-- Corpo idêntico ao de 0015; a única mudança é a guarda de sessão
-- marcada abaixo. Fica aqui, e não em 0015, porque require_active_app_session
-- só passa a existir nesta migration.

create or replace function public.workspace_create_store(
  p_name text,
  p_slug text,
  p_whatsapp text default null
)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace public.workspaces;
  v_subscription public.workspace_subscriptions;
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
  v_limit integer;
  v_used integer;
  v_store public.stores;
  v_status text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  -- TASK-012 parte 2: criar loja autoriza por workspace_members, não
  -- pelos três helpers de loja — logo não passaria por app_session_denied.
  -- Sem esta linha, uma sessão revogada com vaga de loja sobrando ainda
  -- criaria loja (achado pelo teste de ponta a ponta com JWT real).
  perform public.require_active_app_session();

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 120 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  select w.* into v_workspace from public.workspaces w
    join public.workspace_members wm on wm.workspace_id = w.id
    where wm.user_id = v_uid and wm.role = 'owner'
    for update of w;
  if v_workspace.id is null then
    raise exception 'workspace_not_found' using errcode = '02000';
  end if;

  select * into v_subscription from public.workspace_subscriptions
    where workspace_id = v_workspace.id;
  if v_subscription.id is null then
    raise exception 'subscription_not_found' using errcode = '02000';
  end if;

  select max_stores into v_limit from public.workspace_entitlements(v_workspace.id);
  select count(*)::integer into v_used from public.stores where workspace_id = v_workspace.id;

  if v_used >= v_limit then
    raise exception 'max_stores_reached' using errcode = '23514';
  end if;

  v_status := case when v_subscription.status = 'active' then 'active' else 'pending_payment' end;

  begin
    insert into public.stores (slug, name, whatsapp, status, workspace_id)
    values (v_slug, v_name, nullif(trim(p_whatsapp), ''), v_status, v_workspace.id)
    returning * into v_store;
  exception
    when unique_violation then
      raise exception 'slug_taken' using errcode = '23505';
  end;

  -- A loja nova herda TODA a equipe do workspace (V1: member opera todas
  -- as lojas) — inclusive o owner. Substitui o insert manual anterior.
  perform public.workspace_sync_store_access(v_workspace.id);
  perform public.workspace_sync_store_plans(v_workspace.id);

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values
    (v_uid, v_store.id, 'store_created', 'store', v_store.id::text,
      jsonb_build_object('slug', v_store.slug, 'workspace_id', v_workspace.id, 'via', 'workspace_create_store')),
    (v_uid, v_store.id, 'owner_assigned', 'store_members', v_store.id::text, '{}'::jsonb);

  return v_store;
end;
$fn$;

comment on function public.workspace_create_store(text, text, text) is
  'Cria a 2ª/3ª loja pelo painel. Exige sessão da CaraffaStore viva (require_active_app_session) além de ser owner: sem isso uma sessão revogada com vaga sobrando ainda criaria loja. maxStores aplicado com o workspace travado; o workspace vem de auth.uid(), nunca de parâmetro; a loja nova herda a equipe.';

revoke all on function public.workspace_create_store(text, text, text) from public;
grant execute on function public.workspace_create_store(text, text, text) to authenticated;
