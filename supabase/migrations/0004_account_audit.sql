-- TASK-002 — segunda correção pós-QA (qa/reports/TASK-002-RETEST.md).
--
-- Causas-raiz encontradas nesta migração pelo reteste do Júnior:
--
--   * BUG-RT2-005 — `log_email_verification_completed()`/
--     `log_password_recovery_completed()` eram chamáveis DIRETAMENTE por
--     qualquer sessão `authenticated`, sem nenhuma prova de que a
--     confirmação/recuperação de fato aconteceu — só exigiam
--     `auth.uid()` não nulo. Uma sessão comum conseguia fabricar os dois
--     eventos só chamando a RPC. Removidas por completo nesta migração:
--     a auditoria destes dois eventos passou a acontecer DENTRO das
--     funções atômicas de consumo/reivindicação de
--     `supabase/migrations/0003_recovery_session.sql`
--     (`consume_auth_flow_grant`/`claim_recovery_grant_for_password_change`)
--     — a única forma de gerar essas linhas agora é através de uma
--     transição real, nunca de uma chamada isolada.
--   * BUG-RT2-006 — a versão anterior desta migração fazia
--     `alter table ... drop constraint audit_log_action_check, add
--     constraint ... check (action in (...))` REMOVENDO
--     'signup_completed'/'password_recovery_requested' do conjunto
--     permitido. Um banco com linhas históricas gravadas sob a 0002
--     (que já permitia esses dois valores) quebra com
--     `check_violation` ao aplicar essa migração — reproduzido pelo
--     Júnior inserindo uma linha histórica válida e então aplicando a
--     0004 antiga. Corrigido: esta migração NÃO toca mais em
--     `audit_log_action_check` — o conjunto definido em
--     `0002_auth_onboarding.sql` já inclui TODOS os valores necessários
--     (inclusive `email_verification_completed`/
--     `password_recovery_completed`, usados desde a primeira correção
--     pós-QA), então não há nada a estreitar nem a alargar aqui. Nenhum
--     evento histórico é apagado, alterado ou reinterpretado — a
--     aplicação simplesmente para de ESCREVER `signup_completed`/
--     `password_recovery_requested` (já não escrevia desde a primeira
--     correção; ver comentário abaixo), mas o valor continua válido
--     para qualquer linha antiga que já exista. Teste real de upgrade
--     desde a 0002 com dados históricos:
--     supabase/tests/migration-upgrade-check.sh.
--   * RESSALVA-RT2-001 — `audit_log.store_id` usava `on delete set
--     null`: apagar uma loja (via service_role) alterava
--     retroativamente uma linha histórica de auditoria (o `store_id`
--     virava `NULL`), contradizendo "append-only" — auditoria
--     verdadeiramente imutável não pode ser afetada nem indiretamente
--     por uma operação em outra tabela. Corrigido para `on delete
--     restrict`: apagar uma loja com histórico de auditoria associado
--     agora é bloqueado pelo próprio banco, em vez de silenciosamente
--     mutar o evento histórico.
--
-- `signup_completed`/`password_recovery_requested` continuam FORA da
-- escrita da aplicação (o próprio GoTrue já registra os equivalentes em
-- `auth.audit_log_entries`, só service_role/superuser) — essa decisão
-- da primeira correção pós-QA não mudou, só deixou de exigir uma
-- migração destrutiva para ser expressa.

alter table public.audit_log
  drop constraint audit_log_store_id_fkey,
  add constraint audit_log_store_id_fkey
    foreign key (store_id) references public.stores (id) on delete restrict;

comment on column public.audit_log.store_id is
  'ON DELETE RESTRICT (não SET NULL): uma linha de auditoria histórica nunca pode ser alterada, nem indiretamente por exclusão da loja referenciada (RESSALVA-RT2-001, qa/reports/TASK-002-RETEST.md). Não há, hoje, nenhuma funcionalidade de excluir loja — se uma vier a existir, terá que lidar explicitamente com o histórico de auditoria associado (arquivamento, por exemplo), nunca apagar/desvincular silenciosamente.';

comment on table public.audit_log is
  'Auditoria mínima append-only. metadata nunca deve conter senha, token, cookie, chave ou URL completa de recuperação — só identificadores mínimos (ids, slugs, planos). Sem policy de select/insert/update/delete para anon/authenticated: só as funções SECURITY DEFINER de supabase/migrations/0002_auth_onboarding.sql e 0003_recovery_session.sql escrevem — nenhuma RPC de auditoria isolada e chamável diretamente por um cliente existe (BUG-RT2-005, qa/reports/TASK-002-RETEST.md). service_role tem SELECT/INSERT apenas (nunca UPDATE/DELETE, nem para uso administrativo). store_id é ON DELETE RESTRICT, não SET NULL — nem a exclusão de outra linha pode alterar um evento histórico.';

revoke update, delete on public.audit_log from service_role;

drop function if exists public.log_email_verification_completed();
drop function if exists public.log_password_recovery_completed();

-- ============================================================
-- Terceira correção pós-QA (revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-002): o evento
-- email_verification_completed deixa de nascer de uma RPC
-- (consume_auth_flow_grant('email_confirmation'), removida em
-- supabase/migrations/0003_recovery_session.sql) chamável por qualquer
-- sessão com um grant pendente, e passa a nascer de uma TRANSIÇÃO REAL
-- em auth.users: email_confirmed_at indo de null para não-null. Só o
-- próprio GoTrue grava essa coluna (dentro de
-- supabase.auth.verifyOtp({type:"signup", token_hash}) com um token_hash
-- real — ver app/auth/confirm/route.ts) — nenhum cliente, mesmo
-- authenticated, tem como fabricar essa transição chamando uma função
-- diretamente. A cláusula WHEN garante exatamente um disparo por
-- confirmação (a coluna só transiciona null -> not null uma vez), sem
-- exigir nenhuma RPC pública de "registrar confirmação".
-- ============================================================

create or replace function public.handle_email_confirmed_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (new.id, null, 'email_verification_completed', 'auth_user', new.id::text, '{}'::jsonb);
  return new;
end;
$$;

comment on function public.handle_email_confirmed_audit() is
  'Dispara em AFTER UPDATE em auth.users, só quando email_confirmed_at transiciona de null para não-null (ver cláusula WHEN do trigger) — nunca por uma chamada de cliente. Substitui a antiga consume_auth_flow_grant(''email_confirmation''), que era uma RPC authenticated chamável a qualquer momento contra um grant pendente automático, sem provar que a rota /auth/confirm de fato validou um token real (BUG-CLAUDE-002, qa/reports/TASK-002-CLAUDE-VERIFICATION.md).';

revoke all on function public.handle_email_confirmed_audit() from public;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_email_confirmed_audit();

-- ============================================================
-- QUARTA correção pós-QA (revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md, BUG-CLAUDE-VERIF2-001,
-- ALTA) — HISTÓRICO, substituída pela QUINTA correção abaixo: a versão
-- anterior de claim_recovery_grant_for_password_change
-- (supabase/migrations/0003_recovery_session.sql) gravava
-- 'password_recovery_completed' ANTES de supabase.auth.updateUser()
-- realmente trocar a senha. Corrigido NAQUELA rodada amarrando o evento
-- a uma trigger AFTER UPDATE OF encrypted_password em auth.users
-- (handle_password_recovery_completion, removida nesta correção — ver
-- QUINTA abaixo).
--
-- ============================================================
-- QUINTA correção pós-QA (revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, BUG-CLAUDE-VERIF3-001,
-- BLOQUEADOR/ALTA): a trigger `handle_password_recovery_completion` da
-- correção anterior correlacionava a conclusão SOMENTE por
-- `new.id` (o auth.users.id sendo atualizado) contra "existe um grant
-- claimed-não-completed-não-revoked para este usuário" — sem
-- `expires_at`, sem `session_id`, sem janela temporal, sem NENHUMA
-- prova de que a alteração de senha específica que disparou a trigger
-- tinha qualquer relação com a tentativa de recuperação que criou
-- aquele grant `claimed`. Confirmado empiricamente: uma troca de senha
-- comum, uma alteração administrativa, ou uma alteração feita depois de
-- o grant já ter expirado — todas "concluíam" um grant `claimed`
-- abandonado (updateUser da recuperação original tendo falhado antes),
-- fabricando `password_recovery_completed` sem nenhuma causalidade
-- real. Uma trigger genérica sobre `auth.users.encrypted_password` só
-- prova "a senha deste usuário mudou" — nunca "esta mudança foi
-- causada por esta tentativa de recuperação".
--
-- Removida por completo a trigger `on_auth_user_password_changed` e a
-- função `handle_password_recovery_completion` — não existe mais
-- NENHUM mecanismo automático que conclua um grant a partir de uma
-- alteração de `auth.users`. A conclusão vira uma função explícita,
-- SERVER-ONLY (EXECUTE só para service_role — nem authenticated, nem
-- anon, nem PUBLIC), chamada pelo reset action IMEDIATAMENTE depois de
-- `updateUser()` retornar sucesso real:
--
--   public.complete_password_recovery_attempt(p_attempt_id uuid,
--     p_capability text)
--
-- Ela exige, simultaneamente:
--   * `p_attempt_id` — a tentativa EXATA (não "a mais recente", não "a
--     claimed do usuário") criada por issue_password_recovery_grant e
--     reivindicada por claim_recovery_grant_for_password_change;
--   * `p_capability` — a completion capability de uso único gerada
--     ATOMICAMENTE por claim_recovery_grant_for_password_change no
--     mesmo UPDATE do claim (só o hash é persistido em
--     completion_secret_hash; o valor bruto só existe em memória do
--     processo Next.js entre o claim e esta chamada) — comparado por
--     hash, nunca em texto puro;
--   * `claimed_at is not null`, `completed_at is null`, `revoked_at is
--     null`, `claim_expires_at > now()` — a mesma tentativa, ainda
--     dentro da janela de conclusão, nunca já concluída/revogada;
--   * o fingerprint ATUAL de `auth.users.encrypted_password`
--     (sha256, comparado só por hash) DIFERENTE de
--     `password_fingerprint_before` (capturado no claim) — prova
--     não-reversível de que a credencial realmente mudou DEPOIS do
--     claim, fechando a lacuna de causalidade: sem essa mudança real,
--     a conclusão falha mesmo com attempt_id/capability corretos.
--
-- Só then marca `completed_at` e grava `password_recovery_completed`,
-- com `attempt_id` nos `metadata` (não sensível — só um uuid interno).
-- Idempotente por desenho: uma segunda chamada com o mesmo
-- attempt_id/capability encontra `completed_at is not null` (já não
-- bate no WHERE) e retorna `false` sem duplicar nada — uma Server
-- Action pode tentar de novo com segurança (ex.: falha transitória de
-- rede entre updateUser() e esta chamada) sem risco de gravar dois
-- eventos de conclusão.
--
-- Troca de senha SEM nenhuma tentativa claimed correspondente (ex.:
-- uma futura função de "trocar senha logado", que não existe ainda na
-- TASK-002) nunca fabrica password_recovery_completed — não há mais
-- NENHUM caminho automático que reaja a auth.users por conta própria;
-- só uma chamada explícita e server-only com attempt_id/capability
-- corretos conclui alguma coisa.
-- ============================================================

alter table public.audit_log
  drop constraint audit_log_action_check,
  add constraint audit_log_action_check check (action in (
    'signup_completed',
    'email_verification_completed',
    'password_recovery_requested',
    'password_recovery_grant_issued',
    'password_recovery_authorization_claimed',
    'password_recovery_completed',
    'password_recovery_revoked',
    'store_created',
    'owner_assigned',
    'plan_selected',
    'onboarding_completed',
    'access_denied'
  ));

comment on constraint audit_log_action_check on public.audit_log is
  'Conjunto de actions só CRESCE entre migrations (nunca estreitar — bloqueador 6/BUG-RT2-006, qa/reports/TASK-002-RETEST.md, e comentário no topo deste arquivo): estreitar quebraria upgrade com linhas históricas gravadas sob um conjunto anterior mais permissivo. password_recovery_grant_issued/password_recovery_revoked adicionados nesta correção (BUG-CLAUDE-VERIF3-001, supabase/migrations/0003_recovery_session.sql) — password_recovery_completed permanece no conjunto e continua sendo escrito, agora exclusivamente por complete_password_recovery_attempt() abaixo (nunca mais por uma trigger automática sobre auth.users, nem por claim_recovery_grant_for_password_change).';

drop trigger if exists on_auth_user_password_changed on auth.users;
drop function if exists public.handle_password_recovery_completion();

-- ============================================================
-- Conclusão explícita, server-only — ver bloco QUINTA correção acima
-- para a explicação completa do desenho.
-- ============================================================

create or replace function public.complete_password_recovery_attempt(
  p_attempt_id uuid,
  p_capability text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_fingerprint_before text;
  v_current_encrypted_password text;
  v_current_fingerprint text;
begin
  if p_attempt_id is null or p_capability is null or length(p_capability) = 0 then
    return false;
  end if;

  select user_id, password_fingerprint_before
    into v_user_id, v_fingerprint_before
  from public.password_recovery_grants
  where id = p_attempt_id
    and completion_secret_hash = encode(extensions.digest(p_capability, 'sha256'), 'hex')
    and claimed_at is not null
    and completed_at is null
    and revoked_at is null
    and claim_expires_at is not null
    and claim_expires_at > now()
  for update;

  if not found or v_fingerprint_before is null then
    return false;
  end if;

  select encrypted_password into v_current_encrypted_password
  from auth.users
  where id = v_user_id;

  if v_current_encrypted_password is null then
    return false;
  end if;

  v_current_fingerprint := encode(extensions.digest(v_current_encrypted_password, 'sha256'), 'hex');

  -- Prova de alteração real (qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md,
  -- "PROVA DE ALTERAÇÃO REAL"): sem isso, um chamador com attempt_id +
  -- capability corretos mas SEM updateUser() ter mudado nada ainda
  -- conseguiria marcar completed_at prematuramente.
  if v_current_fingerprint = v_fingerprint_before then
    return false;
  end if;

  update public.password_recovery_grants
  set completed_at = now(),
      completion_secret_hash = null
  where id = p_attempt_id;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (v_user_id, null, 'password_recovery_completed', 'auth_user', v_user_id::text, jsonb_build_object('attempt_id', p_attempt_id));

  return true;
end;
$$;

comment on function public.complete_password_recovery_attempt(uuid, text) is
  'Conclusão EXPLÍCITA e SERVER-ONLY (fecha BUG-CLAUDE-VERIF3-001, qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md) — EXECUTE só para service_role (nunca anon/authenticated/PUBLIC), chamada por lib/supabase/service-only/recovery-completion.ts dentro de app/(auth)/reset-password/actions.ts, SOMENTE depois de supabase.auth.updateUser({password}) ter retornado sucesso real. Exige simultaneamente: attempt_id exato, completion capability exata (comparada por hash), a tentativa ainda claimed/não completed/não revoked/dentro da janela claim_expires_at, e o fingerprint ATUAL da credencial DIFERENTE do capturado no claim (prova não-reversível de alteração real). Nunca correlaciona por user_id sozinho, nunca escolhe "o grant claimed mais recente/atual", nunca conclui uma tentativa expirada ou revogada. Idempotente: uma segunda chamada com os mesmos parâmetros encontra completed_at já preenchido (fora do WHERE) e retorna false sem duplicar auditoria — seguro para uma Server Action tentar de novo (retry limitado) se a primeira chamada falhar por um motivo transitório depois de updateUser() já ter tido sucesso.';

revoke all on function public.complete_password_recovery_attempt(uuid, text) from public;
grant execute on function public.complete_password_recovery_attempt(uuid, text) to service_role;
