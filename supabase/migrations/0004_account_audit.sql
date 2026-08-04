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
