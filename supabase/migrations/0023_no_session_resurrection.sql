-- TASK-012 — QA final: sessão revogada NÃO pode ressuscitar sozinha.
--
-- O BUG
--
-- O upsert final de app_session_start (0016) fazia:
--
--   on conflict (supabase_session_hash) do update
--     set revoked_at = null, revoked_reason = null, ...
--
-- Ou seja: encontrar a própria linha REVOGADA e limpar a revogação. Como
-- requireStoreStatus chama app_session_start em toda navegação, bastava
-- o browser revogado carregar qualquer página para voltar a ter sessão
-- ativa.
--
-- MEDIDO NA UI, não em teoria:
--
--   1. takeover pela tela -> sessão do browser fica ativa, a outra revogada
--   2. revogo a sessão do browser no banco (ativas = 0)
--   3. navego para /dashboard/products no MESMO browser
--   4. a página renderiza normalmente e ativas volta para 1
--
-- Por que os testes anteriores não pegaram: eles sempre deixavam OUTRA
-- sessão ativa. Com uma concorrente viva, o ramo de sessão única devolve
-- `conflict` antes de chegar no upsert, e a ressurreição não acontece.
-- O buraco só aparece quando a sessão revogada é a ÚNICA — que é
-- exatamente o caso depois de um logout da outra ponta, de um downgrade
-- de plano ou de uma revogação administrativa.
--
-- IMPACTO
--
-- A revogação deixava de ser durável. Não é escalação de privilégio
-- (o dono do JWT poderia simplesmente logar de novo), mas contradiz a
-- garantia fail-closed documentada em 0018 e torna inútil qualquer
-- revogação que não seja imediatamente seguida por outra sessão ativa.
--
-- Remoção de membro NÃO era afetada: app_session_start valida membership
-- em workspace_members antes de chegar ao upsert, então um ex-membro já
-- era barrado ali.
--
-- A REGRA AGORA
--
--   revoked_reason = 'stale'  -> pode reocupar
--     Lease vencido é abandono, não punição. O mesmo browser voltando
--     depois do almoço, com token ainda válido, deve seguir trabalhando.
--
--   qualquer outro motivo      -> NEGADO (session_revoked)
--     takeover, logout, member_removed, plan_downgrade, admin. Todos
--     exigem autenticação nova — que gera um session_id novo e portanto
--     uma linha nova, sem tocar na revogada.

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

  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = v_uid
  ) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  perform 1 from public.workspaces where id = p_workspace_id for update;

  select coalesce(max_concurrent_sessions, 0) = 1 into v_single
    from public.workspace_entitlements(p_workspace_id);

  select * into v_existing from public.app_sessions where supabase_session_hash = v_hash;

  -- Renovação normal: navegação, refresh de token, outra aba.
  if v_existing.id is not null and v_existing.revoked_at is null and v_existing.expires_at > now() then
    update public.app_sessions set last_seen_at = now() where id = v_existing.id;
    return query select v_existing.id, false, null::text, null::timestamptz;
    return;
  end if;

  -- TASK-012 QA: a linha existe e está REVOGADA.
  --
  -- Só 'stale' pode ser reocupada — lease vencido é abandono, não
  -- punição. Todo o resto (takeover, logout, member_removed,
  -- plan_downgrade, admin) exige autenticação nova: um login novo gera
  -- session_id novo, logo linha nova, e a revogada continua revogada
  -- para sempre.
  if v_existing.id is not null
     and v_existing.revoked_at is not null
     and v_existing.revoked_reason is distinct from 'stale' then
    raise exception 'session_revoked' using errcode = '42501';
  end if;

  -- Sessão expirada por tempo de vida também exige login novo.
  if v_existing.id is not null
     and v_existing.revoked_at is null
     and v_existing.expires_at <= now() then
    raise exception 'session_revoked' using errcode = '42501';
  end if;

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
  -- Só chega aqui quando não havia linha, ou a linha era 'stale'. O
  -- do update NÃO ressuscita nada que tenha sido revogado por decisão
  -- (takeover/logout/remoção/downgrade/admin) — esses já saíram acima
  -- com session_revoked.
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
  'Abre ou renova a sessão da CaraffaStore para o session_id do JWT atual. É a ÚNICA função administrativa que funciona sem sessão registrada — precisa ser, senão a primeira sessão nunca poderia ser criada. Valida membership lendo workspace_members diretamente (nunca is_store_member), para não criar dependência circular. TASK-012 QA: uma sessão revogada por DECISÃO (takeover, logout, member_removed, plan_downgrade, admin) nunca ressuscita — devolve session_revoked e exige autenticação nova. Só lease vencido (stale) pode ser reocupado pelo mesmo browser.';

revoke all on function public.app_session_start(uuid, text, boolean) from public;
grant execute on function public.app_session_start(uuid, text, boolean) to authenticated;
