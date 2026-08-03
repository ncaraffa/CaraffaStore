-- TASK-002 — correção pós-QA (qa/reports/TASK-002.md, BUG-T2-002/003).
--
-- Causa-raiz investigada empiricamente contra o Supabase local real
-- (Docker) antes de escrever este arquivo: o claim `amr` do GoTrue NÃO
-- distingue confirmação de cadastro de recuperação de senha — os dois
-- fluxos produzem `amr = [{"method": "otp", ...}]`, idêntico, confirmado
-- tanto no JWT decodificado quanto em `auth.mfa_amr_claims.authentication_method`
-- (ver docs/handoff.md, seção da correção pós-QA, para a evidência
-- completa). A implementação anterior presumia `amr = "recovery"` sem
-- verificar — nunca funcionou.
--
-- Esta tabela é a fonte de verdade correta: só é escrita pela rota
-- app/auth/recovery/route.ts (nunca app/auth/confirm/route.ts, que trata
-- só confirmação de cadastro) — a ROTA em si classifica o fluxo, nunca um
-- parâmetro de query como `next`/`type` (BUG-T2-003). `session_id` vem
-- de `auth.jwt() ->> 'session_id'` como DEFAULT de coluna, nunca de um
-- valor enviado pelo cliente — mesmo que alguém chame a API diretamente,
-- não há como gravar um session_id diferente do da própria sessão que
-- fez a requisição.

create table if not exists public.recovery_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  session_id uuid not null default ((auth.jwt() ->> 'session_id')::uuid),
  created_at timestamptz not null default now(),
  -- O DEFAULT sozinho NÃO impede um cliente de especificar session_id
  -- explicitamente no corpo do insert/update (DEFAULT só se aplica
  -- quando a coluna é omitida) — confirmado com um smoke test real
  -- durante o desenvolvimento: um insert com session_id explícito grava
  -- o valor forjado, ignorando o DEFAULT. Este CHECK fecha essa brecha:
  -- QUALQUER valor gravado, vindo do DEFAULT ou explícito, precisa bater
  -- com o session_id do JWT da própria requisição — não há como um
  -- cliente gravar um session_id diferente do da sua própria sessão
  -- atual, de forma alguma.
  constraint recovery_grants_session_matches_jwt
    check (session_id = ((auth.jwt() ->> 'session_id')::uuid))
);

comment on table public.recovery_grants is
  'Prova de que a sessão atual do usuário nasceu de um code exchange em app/auth/recovery/route.ts (fluxo de recuperação de senha), não de login normal nem de confirmação de cadastro. session_id é sempre validado contra o próprio JWT da requisição (DEFAULT + CHECK constraint) — nunca aceita um valor diferente vindo do cliente, mesmo se enviado explicitamente. lib/tenant/recovery-session.ts compara este valor com o session_id da sessão ATUAL antes de autorizar /reset-password — uma sessão diferente (novo login) tem session_id diferente e não bate, mesmo que o grant continue no banco.';

alter table public.recovery_grants enable row level security;

-- Usuário só enxerga/gerencia o próprio grant — sem SECURITY DEFINER
-- necessário aqui: RLS por si só já restringe corretamente a auth.uid(),
-- e o DEFAULT da coluna já impede session_id forjado.
create policy recovery_grants_select_self
  on public.recovery_grants
  for select
  to authenticated
  using (user_id = auth.uid());

create policy recovery_grants_insert_self
  on public.recovery_grants
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy recovery_grants_update_self
  on public.recovery_grants
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy recovery_grants_delete_self
  on public.recovery_grants
  for delete
  to authenticated
  using (user_id = auth.uid());

revoke all on public.recovery_grants from public, anon, authenticated, service_role;

-- anon: nenhum grant — só authenticated (uma sessão de recuperação já é
-- uma sessão autenticada, mesmo que temporária).
grant select, insert, update, delete on public.recovery_grants to authenticated;

-- service_role: uso administrativo/QA local, mesmo padrão das demais
-- tabelas desta migração.
grant select, insert, update, delete on public.recovery_grants to service_role;
