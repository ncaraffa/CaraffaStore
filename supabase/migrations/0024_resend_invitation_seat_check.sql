-- TASK-012 — QA final: reenviar convite não pode estourar a reserva de
-- assentos.
--
-- O BUG
--
-- workspace_resend_invitation (0016) renovava expires_at sem reconferir
-- assento:
--
--   update public.workspace_invitations
--     set token_hash = ..., expires_at = now() + interval '7 days'
--    where ... status = 'pending';
--
-- Um convite VENCIDO continua com status='pending' — a expiração é por
-- data, não por status (decisão deliberada: a vaga volta na leitura, sem
-- depender de cron). Logo ele NÃO reserva assento. Renovar a data faz
-- ele voltar a reservar, e nada verificava se ainda havia vaga.
--
-- MEDIDO (Growth, limite 3):
--
--   seats reservados ANTES:  3 / limite 3     (owner + 2 membros)
--   reenvio de um convite expirado
--   seats reservados DEPOIS: 4 / limite 3     <- estourou
--
-- IMPACTO
--
-- Não é escalação: workspace_accept_invitation revalida o assento sob
-- lock, então o 4º membro nunca entraria. Mas a contagem fica incoerente
-- ("4 de 3 usuários" na tela) e passa a bloquear convites legítimos,
-- porque o workspace parece cheio além do limite.
--
-- A CORREÇÃO
--
-- Reconferir assento apenas quando a renovação DE FATO passa a consumir
-- um — isto é, quando o convite estava vencido. Renovar um convite que
-- já reservava não muda a contagem e não precisa de checagem (senão
-- reenviar em um workspace legitimamente cheio seria impossível, o que
-- seria pior).

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
  v_existing public.workspace_invitations;
  v_limit integer;
  v_reserved integer;
  v_row public.workspace_invitations;
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
  if p_token_hash is null or char_length(p_token_hash) <> 64 then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  -- Trava o workspace: serializa com convites/aceites concorrentes.
  perform 1 from public.workspaces where id = v_workspace_id for update;

  select * into v_existing from public.workspace_invitations
    where workspace_id = v_workspace_id and lower(email) = v_email and status = 'pending'
    for update;

  if v_existing.id is null then
    raise exception 'invitation_not_found' using errcode = '02000';
  end if;

  -- Só reconfere assento quando a renovação passa a consumir um. Um
  -- convite que JÁ estava reservando continua reservando: renovar não
  -- muda a contagem, e exigir vaga aí impediria reenviar num workspace
  -- legitimamente cheio.
  if v_existing.expires_at <= now() then
    select max_team_members into v_limit from public.workspace_entitlements(v_workspace_id);
    v_reserved := public.workspace_reserved_seats(v_workspace_id);
    if v_reserved >= v_limit then
      raise exception 'max_team_members_reached' using errcode = '23514';
    end if;
  end if;

  update public.workspace_invitations
    set token_hash = p_token_hash, expires_at = now() + interval '7 days'
    where id = v_existing.id
    returning * into v_row;

  return v_row;
end;
$fn$;

comment on function public.workspace_resend_invitation(text, text) is
  'Reenvia um convite pendente: token novo e prazo novo NA MESMA linha, então nunca duplica a reserva de assento. TASK-012 QA: quando o convite estava VENCIDO (e portanto não reservava mais), a renovação volta a consumir assento — e aí o limite do plano é reconferido, sob lock do workspace. Sem isso, reenviar um convite vencido num workspace cheio levava a reserva a 4/3. O token anterior deixa de funcionar (o hash é substituído).';

revoke all on function public.workspace_resend_invitation(text, text) from public;
grant execute on function public.workspace_resend_invitation(text, text) to authenticated;
