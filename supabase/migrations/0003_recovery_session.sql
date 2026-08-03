-- TASK-002 — segunda correção pós-QA (qa/reports/TASK-002-RETEST.md).
--
-- O reteste do Júnior reprovou a primeira versão desta migração:
-- `recovery_grants` concedia INSERT/UPDATE/DELETE a `authenticated` e
-- confiava só em RLS (`user_id = auth.uid()`) + um DEFAULT/CHECK de
-- `session_id` — qualquer sessão comum conseguia inserir a própria
-- linha diretamente (BUG-RT2-001) e obter acesso a /reset-password sem
-- jamais ter passado por um e-mail de recuperação. Também não havia
-- `expires_at`/`consumed_at`, então duas trocas de senha concorrentes
-- eram aceitas (BUG-RT2-002), e nada impedia um código de confirmação
-- de cadastro de ser trocado manualmente em /auth/recovery (e
-- vice-versa) para fabricar uma sessão com o privilégio errado
-- (BUG-RT2-003/004) — separar as ROTAS não classifica criptograficamente
-- o `code` PKCE: `exchangeCodeForSession`/`verifyOtp` do GoTrue devolvem
-- uma sessão válida de qualquer forma, sem vincular o código à rota
-- Next.js que o consumiu.
--
-- Reprojetado do zero: `public.auth_flow_grants` substitui
-- `recovery_grants` e passa a proteger OS DOIS fluxos (confirmação de
-- cadastro e recuperação de senha), não só recuperação. Princípios:
--
--   1. ZERO grant de tabela para anon/authenticated — nenhum cliente
--      insere, atualiza, apaga ou lê uma linha diretamente, mesmo via
--      RLS. Toda a superfície é um punhado de funções SECURITY DEFINER
--      com uma responsabilidade estreita cada uma, nenhuma aceitando
--      `user_id`/`session_id`/qualquer identificador de outro usuário
--      como parâmetro vindo do cliente — sempre `auth.uid()`/
--      `auth.jwt()` da própria sessão que está chamando.
--   2. A linha de "confirmação de cadastro" nasce automaticamente por um
--      TRIGGER em `auth.users` (dispara só quando o GoTrue insere um
--      usuário de verdade — nunca por uma chamada RPC direta) — não há
--      como um cliente pedir esse grant para si mesmo ou para outro
--      user_id.
--   3. A linha de "recuperação de senha" nasce por
--      `request_password_recovery_grant(email)`, chamável por
--      anon/authenticated (é assim que "esqueci minha senha" funciona
--      antes de existir sessão) — mas essa chamada sozinha NÃO concede
--      acesso a nada: só marca "pedido pendente", com `consumed_at`
--      nulo. Anti-enumeração preservada (procura o usuário por e-mail
--      internamente; e-mail inexistente não gera nenhuma linha nem erro
--      visível).
--   4. O que de fato ATIVA o privilégio é `consume_auth_flow_grant(purpose)`
--      — só pode ser chamada por uma sessão JÁ autenticada (ou seja,
--      depois de um `exchangeCodeForSession`/`verifyOtp` real ter
--      acontecido) e faz, num ÚNICO UPDATE atômico: exige que exista uma
--      linha PENDENTE (`consumed_at is null`), não expirada, para
--      `auth.uid()` E para o `purpose` exato da rota que está chamando.
--      Uma sessão comum sem pedido pendente correspondente não tem o
--      que consumir — `consume_auth_flow_grant` devolve `false` e as
--      rotas (`app/auth/confirm/route.ts`/`app/auth/recovery/route.ts`)
--      encerram a sessão imediatamente (nenhuma sessão sobrevive a uma
--      troca de propósito incompatível — fecha BUG-RT2-003 e
--      BUG-RT2-004 nos dois sentidos, sem depender de `amr`, `next`,
--      pathname ou da simples existência de uma sessão). Grava a
--      auditoria de confirmação de e-mail DENTRO do mesmo UPDATE
--      atômico — nenhuma RPC separada de auditoria existe para um
--      cliente chamar isoladamente (fecha BUG-RT2-005 para este
--      evento).
--   5. A troca de senha em si exige um SEGUNDO passo atômico,
--      `claim_recovery_grant_for_password_change()`: um DELETE
--      condicional que só afeta a linha se ela já estiver consumida
--      (passo 4 aconteceu) E ainda não tiver sido reivindicada. Sob
--      concorrência real (duas requisições com o mesmo access/refresh
--      token em paralelo), o bloqueio de linha do Postgres garante que
--      só UMA das duas encontra a linha ainda presente — a outra vê 0
--      linhas afetadas e falha com segurança, sem tentar de novo com o
--      mesmo grant (fecha BUG-RT2-002). Grava a auditoria de
--      recuperação concluída no mesmo DELETE atômico.
--
-- Não há nenhum nonce/token na URL para o cliente apresentar de volta —
-- a "prova não fabricável" exigida pelo reteste vem inteira do banco:
-- `auth.uid()` (a sessão JÁ provou sua identidade ao GoTrue) cruzado com
-- uma linha PENDENTE que só um mecanismo interno (trigger/função restrita
-- a um propósito) pôde ter criado. Isso evita a superfície adicional de
-- "aceitar um nonce como parâmetro" (que, se mal desenhada, reabriria a
-- mesma classe de bug ao permitir registrar um grant para user_id
-- arbitrário).

create table public.auth_flow_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('email_confirmation', 'password_recovery')),
  session_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint auth_flow_grants_user_purpose_unique unique (user_id, purpose)
);

comment on table public.auth_flow_grants is
  'Prova server-side, não fabricável pelo cliente, de que uma sessão nasceu de um fluxo específico (confirmação de cadastro OU recuperação de senha) — substitui public.recovery_grants (qa/reports/TASK-002-RETEST.md, BUG-RT2-001/002/003/004). Nenhum grant de tabela para anon/authenticated: toda a leitura/escrita passa por funções SECURITY DEFINER que usam auth.uid()/auth.jwt() da própria sessão chamando, nunca um parâmetro do cliente. "purpose" pendente (consumed_at null) só prova "existe um pedido"; o privilégio real só nasce em consume_auth_flow_grant(), chamada depois de uma troca de código real bem-sucedida.';

alter table public.auth_flow_grants enable row level security;

-- Nenhuma policy — ninguém (nem authenticated) tem acesso direto à
-- linha. Todo acesso é mediado pelas funções SECURITY DEFINER abaixo,
-- que rodam com o privilégio do DONO da função (bypassa RLS), nunca com
-- o do chamador.
revoke all on public.auth_flow_grants from public, anon, authenticated, service_role;

-- service_role: só uso administrativo/debug local, mesmo padrão de
-- audit_log (RLS habilitada, zero policy, service_role tem BYPASSRLS no
-- Supabase). Nenhuma rota de usuário usa service_role (proibido desde a
-- primeira correção pós-QA).
grant select, insert, update, delete on public.auth_flow_grants to service_role;

-- ============================================================
-- 1. Confirmação de cadastro: grant nasce SOZINHO quando o GoTrue cria
--    o usuário de verdade (signUp()) — nenhuma chamada de cliente
--    participa disso, então não há "user_id escolhido pelo cliente"
--    possível aqui.
-- ============================================================

create or replace function public.handle_new_user_confirmation_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.auth_flow_grants (user_id, purpose, expires_at)
  values (new.id, 'email_confirmation', now() + interval '24 hours')
  on conflict (user_id, purpose) do update
    set id = gen_random_uuid(),
        expires_at = excluded.expires_at,
        consumed_at = null,
        session_id = null,
        created_at = now();
  return new;
end;
$$;

comment on function public.handle_new_user_confirmation_grant() is
  'Dispara em AFTER INSERT em auth.users (só o próprio GoTrue insere ali, nunca uma RPC chamável por anon/authenticated) — cria o pedido pendente de confirmação de cadastro do novo usuário automaticamente. Reenvio de e-mail (supabase.auth.resend) não insere um novo auth.users, então reaproveita esta mesma linha (ainda pendente, dentro da janela de 24h).';

revoke all on function public.handle_new_user_confirmation_grant() from public;

drop trigger if exists on_auth_user_created_confirmation_grant on auth.users;
create trigger on_auth_user_created_confirmation_grant
  after insert on auth.users
  for each row execute function public.handle_new_user_confirmation_grant();

-- ============================================================
-- 2. Recuperação de senha: pedido pendente nasce a partir de um e-mail
--    informado por quem ainda não tem sessão (anon) — a função resolve
--    o user_id internamente (nunca aceita um user_id vindo do cliente).
--    Chamar isto sozinho NUNCA concede acesso a /reset-password: só
--    marca "existe um pedido pendente", sem session_id, sem
--    consumed_at.
-- ============================================================

create or replace function public.request_password_recovery_grant(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;

  -- E-mail sem conta: não revela isso ao chamador (anti-enumeração,
  -- T2-DEC-011) — retorna silenciosamente, nenhuma linha gravada.
  if v_uid is null then
    return;
  end if;

  insert into public.auth_flow_grants (user_id, purpose, expires_at)
  values (v_uid, 'password_recovery', now() + interval '30 minutes')
  on conflict (user_id, purpose) do update
    set id = gen_random_uuid(),
        expires_at = excluded.expires_at,
        consumed_at = null,
        session_id = null,
        created_at = now();
end;
$$;

comment on function public.request_password_recovery_grant(text) is
  'Chamada por app/(auth)/forgot-password/actions.ts antes de supabase.auth.resetPasswordForEmail(). Só cria um pedido PENDENTE (consumed_at null, sem session_id) — não concede /reset-password por si só. Pedir de novo substitui (upsert) qualquer pedido pendente anterior do mesmo usuário, invalidando um link antigo ainda não usado.';

revoke all on function public.request_password_recovery_grant(text) from public;
grant execute on function public.request_password_recovery_grant(text) to anon, authenticated;

-- ============================================================
-- 3. Consumo do pedido pendente — SÓ pode ser chamada por uma sessão JÁ
--    autenticada (auth.uid() não nulo), ou seja, depois de um
--    exchangeCodeForSession/verifyOtp real ter acontecido em
--    app/auth/confirm/route.ts ou app/auth/recovery/route.ts. UPDATE
--    único e atômico: só afeta a linha se ela existir, pertencer a
--    auth.uid(), tiver o purpose EXATO da rota chamando, ainda não
--    tiver sido consumida e não estiver expirada — nenhuma janela entre
--    "checar" e "consumir" (sem SELECT seguido de UPDATE separados).
--    Uma sessão comum sem pedido pendente correspondente encontra 0
--    linhas e recebe false — as rotas devem então encerrar a sessão
--    imediatamente, nunca deixá-la sobreviver.
-- ============================================================

create or replace function public.consume_auth_flow_grant(p_purpose text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_rows int;
begin
  if v_uid is null or p_purpose not in ('email_confirmation', 'password_recovery') then
    return false;
  end if;

  update public.auth_flow_grants
  set consumed_at = now(),
      session_id = v_session_id
  where user_id = v_uid
    and purpose = p_purpose
    and consumed_at is null
    and expires_at > now();

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    return false;
  end if;

  -- Auditoria de confirmação DENTRO da mesma transação do consumo: se
  -- este insert falhar (ex.: constraint violada), toda a função — o
  -- UPDATE acima incluído — sofre rollback automaticamente (nenhuma
  -- exceção é capturada aqui). Não existe RPC separada de auditoria
  -- para um cliente chamar isoladamente (fecha BUG-RT2-005 para este
  -- evento) — o único jeito de gerar esta linha é consumir um grant
  -- real.
  if p_purpose = 'email_confirmation' then
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (v_uid, null, 'email_verification_completed', 'auth_user', v_uid::text, '{}'::jsonb);
  end if;

  return true;
end;
$$;

comment on function public.consume_auth_flow_grant(text) is
  'Único ponto que ATIVA um grant. Chamada por app/auth/confirm/route.ts (purpose=email_confirmation) e app/auth/recovery/route.ts (purpose=password_recovery) logo após a troca de código bem-sucedida. UPDATE condicional atômico (mesma linha do WHERE: usuário, propósito, não consumido, não expirado) — sem sequência "consultar depois consumir". false = nada para consumir (sessão comum, propósito trocado, expirado ou já consumido); a rota deve encerrar a sessão imediatamente nesse caso, nunca deixá-la ativa.';

revoke all on function public.consume_auth_flow_grant(text) from public;
grant execute on function public.consume_auth_flow_grant(text) to authenticated;

-- ============================================================
-- 4. Reivindicação atômica para a TROCA DE SENHA em si (segundo passo,
--    depois do consumo em 3) — DELETE condicional: só remove a linha se
--    ela já estiver consumida (mesma sessão) e ainda presente. Sob duas
--    requisições concorrentes com a mesma sessão, o lock de linha do
--    Postgres serializa as duas: a primeira a commitar apaga a linha; a
--    segunda, ao reavaliar o WHERE após o lock liberar, não encontra
--    mais nada e recebe false. Isso é o que garante "exatamente uma
--    autorização" sob concorrência real (BUG-RT2-002).
-- ============================================================

create or replace function public.claim_recovery_grant_for_password_change()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_rows int;
begin
  if v_uid is null or v_session_id is null then
    return false;
  end if;

  delete from public.auth_flow_grants
  where user_id = v_uid
    and session_id = v_session_id
    and purpose = 'password_recovery'
    and consumed_at is not null
    and expires_at > now();

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    return false;
  end if;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (v_uid, null, 'password_recovery_completed', 'auth_user', v_uid::text, '{}'::jsonb);

  return true;
end;
$$;

comment on function public.claim_recovery_grant_for_password_change() is
  'Chamada por app/(auth)/reset-password/actions.ts IMEDIATAMENTE ANTES de supabase.auth.updateUser({password}) — nunca depois. false = nada a reivindicar (sem sessão de recuperação válida, grant já usado por outra requisição concorrente, ou expirado): a Server Action deve recusar a troca sem chamar updateUser(). Se updateUser() falhar DEPOIS de um claim bem-sucedido, o grant já foi apagado — não há como "devolver"; a Server Action deve falhar com segurança e orientar a exigir uma nova recuperação (nunca reutilizar o mesmo grant).';

revoke all on function public.claim_recovery_grant_for_password_change() from public;
grant execute on function public.claim_recovery_grant_for_password_change() to authenticated;

-- ============================================================
-- 5. Checagem de leitura (GET /reset-password, guards, proxy.ts): a
--    sessão ATUAL está em modo de recuperação? Só verdadeiro entre o
--    consumo (passo 3) e a reivindicação para troca de senha (passo 4)
--    — depois do passo 4 a linha não existe mais, então isto some
--    sozinho.
-- ============================================================

create or replace function public.is_current_session_recovery_grant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.auth_flow_grants
    where user_id = auth.uid()
      and purpose = 'password_recovery'
      and session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and consumed_at is not null
      and expires_at > now()
  );
$$;

comment on function public.is_current_session_recovery_grant() is
  'Usada por lib/tenant/recovery-session.ts (isCurrentSessionRecovery) — zero parâmetros, lê só auth.uid()/auth.jwt() da própria sessão chamando. Substitui a checagem anterior baseada em SELECT direto em recovery_grants (que exigia GRANT de tabela para authenticated — removido nesta correção).';

revoke all on function public.is_current_session_recovery_grant() from public;
grant execute on function public.is_current_session_recovery_grant() to authenticated;
