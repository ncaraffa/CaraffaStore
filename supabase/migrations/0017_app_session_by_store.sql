-- TASK-012 — Abertura de sessão a partir da LOJA, em uma única chamada.
--
-- MOTIVO: PERFORMANCE DO CAMINHO QUENTE
--
-- O bootstrap da sessão vive em requireStoreStatus, por onde passa TODA
-- requisição administrativa autenticada. A primeira versão fazia duas
-- idas ao banco por request: um SELECT em stores para descobrir o
-- workspace, e só então app_session_start(workspace_id).
--
-- Isso contraria o requisito de não acrescentar consultas extras em toda
-- request. A resolução loja -> workspace é trivial e já acontece dentro
-- do banco em store_workspace_id(); trazê-la para a aplicação só para
-- devolvê-la em seguida é um round trip desperdiçado.
--
-- Esta função resolve e delega, mantendo UMA chamada por request. A
-- variante por workspace_id continua existindo (a tela de takeover a
-- usa, e lá o workspace já é conhecido).

create or replace function public.app_session_start_for_store(
  p_store_id uuid,
  p_user_agent_label text default null,
  p_takeover boolean default false
)
returns table (session_id uuid, conflict boolean, other_label text, other_last_seen timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id from public.stores where id = p_store_id;
  if v_workspace_id is null then
    raise exception 'store_not_found' using errcode = '02000';
  end if;

  return query select * from public.app_session_start(v_workspace_id, p_user_agent_label, p_takeover);
end;
$fn$;

comment on function public.app_session_start_for_store(uuid, text, boolean) is
  'Abre/renova a sessão da CaraffaStore a partir do store_id, resolvendo o workspace no próprio banco. Existe para que o bootstrap em requireStoreStatus custe UMA chamada por request em vez de um SELECT seguido de RPC — este é o caminho quente de toda tela administrativa. A autorização real continua em app_session_start (membership do workspace) e nos helpers de autorização.';

revoke all on function public.app_session_start_for_store(uuid, text, boolean) from public;
grant execute on function public.app_session_start_for_store(uuid, text, boolean) to authenticated;

-- ============================================================
-- Índice de apoio ao caminho quente
-- ============================================================
--
-- app_session_denied() faz lookup por supabase_session_hash em toda
-- checagem de autorização. A coluna já é UNIQUE (portanto indexada), mas
-- a consulta filtra também por estado; um índice parcial só das sessões
-- REVOGADAS/vencidas deixa o caso comum (sessão viva) resolvido por um
-- índice pequeno, que tende a ficar em cache.
create index if not exists app_sessions_denied_lookup_idx
  on public.app_sessions (supabase_session_hash)
  where revoked_at is not null;
