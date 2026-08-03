-- TASK-002 — correção pós-QA (qa/reports/TASK-002.md, BUG-T2-004).
--
-- Problema original: lib/audit/log.ts criava um cliente service-role
-- DENTRO de Server Actions/Route Handlers de usuário (cadastro,
-- verificação, recuperação) e ignorava qualquer falha em bloco catch
-- vazio. Isso violava "service role nunca em fluxo de usuário" e
-- deixava a auditoria falhar silenciosamente.
--
-- Correção adotada, em duas partes:
--
-- 1. `signup_completed` e `password_recovery_requested` deixam de ser
--    gravados por este app inteiramente — o próprio GoTrue já registra
--    esses eventos em `auth.audit_log_entries` (`user_signedup`,
--    `user_recovery_requested`), confirmado por inspeção direta contra
--    o Supabase local real. Reimplementar o mesmo registro em
--    `public.audit_log` exigiria aceitar chamadas de usuário ANÔNIMO
--    (cadastro/recuperação acontecem antes de existir sessão), o que
--    tornaria o actor_user_id necessariamente vindo do cliente — exata
--    forja que a TASK-002 proíbe. `auth.audit_log_entries` já resolve
--    isso com o nível de acesso correto (só service_role/superuser, uso
--    administrativo).
-- 2. `email_verification_completed` e `password_recovery_completed`
--    passam a ser gravados por funções SECURITY DEFINER que leem
--    `auth.uid()` da PRÓPRIA sessão que acabou de se autenticar/trocar a
--    senha (chamadas na mesma requisição, com o cliente autenticado
--    normal — nunca service role) — mesmo padrão de
--    onboarding_complete() da 0002. Zero parâmetros de ator: não há
--    como um cliente atribuir o evento a outro usuário.
--
-- audit_log também vira append-only de verdade: revoga UPDATE/DELETE de
-- service_role (só SELECT/INSERT permanecem — nem uso administrativo
-- pode alterar/apagar auditoria).

alter table public.audit_log
  drop constraint audit_log_action_check,
  add constraint audit_log_action_check check (action in (
    'email_verification_completed',
    'password_recovery_completed',
    'store_created',
    'owner_assigned',
    'plan_selected',
    'onboarding_completed',
    'access_denied'
  ));

comment on table public.audit_log is
  'Auditoria mínima append-only. metadata nunca deve conter senha, token, cookie, chave ou URL completa de recuperação — só identificadores mínimos (ids, slugs, planos). Sem policy de select/insert/update/delete para anon/authenticated: só as funções SECURITY DEFINER escrevem. service_role tem SELECT/INSERT apenas (nunca UPDATE/DELETE, nem para uso administrativo — auditoria não é editável por ninguém). Eventos de cadastro/solicitação de recuperação NÃO são gravados aqui — já ficam em auth.audit_log_entries (GoTrue), a única forma de registrá-los sem aceitar actor_user_id vindo de um cliente anônimo.';

revoke update, delete on public.audit_log from service_role;

create or replace function public.log_email_verification_completed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (v_uid, null, 'email_verification_completed', 'auth_user', v_uid::text, '{}'::jsonb);
end;
$$;

create or replace function public.log_password_recovery_completed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (v_uid, null, 'password_recovery_completed', 'auth_user', v_uid::text, '{}'::jsonb);
end;
$$;

revoke all on function public.log_email_verification_completed() from public;
revoke all on function public.log_password_recovery_completed() from public;

grant execute on function public.log_email_verification_completed() to authenticated;
grant execute on function public.log_password_recovery_completed() to authenticated;
