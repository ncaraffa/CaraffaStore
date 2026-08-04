-- TASK-002 — terceira correção pós-QA (revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-001/002/003).
--
-- BUG-CLAUDE-001 (CRÍTICO): a versão anterior desta migração provou que
-- "existe um pedido pendente de purpose=password_recovery para
-- auth.uid()" é suficiente para conceder o privilégio de troca de senha
-- (`consume_auth_flow_grant`). Mas um pedido pendente sozinho NUNCA
-- provou que um código de recuperação real foi trocado: qualquer sessão
-- comum conseguia chamar `request_password_recovery_grant(próprio
-- e-mail)` e, na sequência, `consume_auth_flow_grant('password_recovery')`
-- pela MESMA sessão de login normal — sem jamais receber ou clicar em
-- nenhum e-mail — e completar a troca de senha inteira
-- (qa/reports/TASK-002-CLAUDE-VERIFICATION.md, §4). `session_id` era só
-- GRAVADO no consumo, nunca EXIGIDO como prova de origem.
--
-- BUG-CLAUDE-002 (BAIXO/MÉDIO): o mesmo desenho, aplicado ao propósito
-- email_confirmation (grant nascia sozinho por trigger, sem exigir
-- proveniência), deixava qualquer sessão autenticada-mas-com-grant-
-- pendente fabricar o evento de auditoria email_verification_completed
-- sem passar pela rota /auth/confirm.
--
-- BUG-CLAUDE-003 (BAIXO): `request_password_recovery_grant` era uma RPC
-- pública (`grant execute ... to anon, authenticated`) chamável
-- diretamente via PostgREST, fora da Server Action — nenhum rate limit
-- de aplicação nem CAPTCHA a protegiam, permitindo griefing (substituir
-- repetidamente o grant pendente de uma vítima).
--
-- Reprojetado do zero, seguindo a direção técnica da revisão externa:
--
--   1. RECUPERAÇÃO passa a exigir prova real: `app/auth/recovery/route.ts`
--      chama `supabase.auth.verifyOtp({ type: "recovery", token_hash })`
--      com o `type` HARDCODED pela rota (nunca lido de query string) —
--      o GoTrue só valida com sucesso se aquele token_hash específico foi
--      de fato emitido como recovery; um token de signup jamais passa
--      nesta chamada, então a separação de finalidade agora é
--      cripto­graficamente garantida pelo próprio GoTrue, não por uma
--      tabela de intenção pendente.
--   2. O grant de recuperação (`public.password_recovery_grants`) só
--      pode ser EMITIDO por `issue_password_recovery_grant(...)` — EXECUTE
--      concedido SOMENTE a `service_role`, nunca a `anon`/`authenticated`/
--      `PUBLIC`. A única chamadora é o módulo server-only isolado
--      `lib/supabase/service-only/recovery-grant-issuer.ts`, importado
--      SÓ por `app/auth/recovery/route.ts`, e só invocado DEPOIS de
--      `verifyOtp` ter retornado sucesso — `user_id`/`session_id` vêm da
--      própria resposta do GoTrue àquela chamada (nunca de um parâmetro
--      arbitrário de cliente).
--   3. O grant é adicionalmente vinculado a um NONCE aleatório de 256
--      bits gerado no servidor Next.js — só o HASH (sha256, hex) do
--      nonce é gravado no banco; o nonce em si só existe em memória do
--      processo Next.js e num cookie HttpOnly com `path=/reset-password`
--      devolvido ao navegador. `claim_recovery_grant_for_password_change`
--      exige `user_id` + `session_id` (de `auth.uid()`/`auth.jwt()`) E o
--      nonce correto (o cookie) para reivindicar — mesmo que
--      `issue_password_recovery_grant` algum dia fosse chamável por
--      engano fora do fluxo real, uma sessão sem o cookie HttpOnly certo
--      não teria como reivindicar.
--   4. CONFIRMAÇÃO DE CADASTRO não usa mais nenhum grant/RPC: nenhuma
--      RPC pública "regista confirmação" existe. `app/auth/confirm/route.ts`
--      chama `verifyOtp({ type: "signup", token_hash })` (hardcoded) — o
--      próprio GoTrue grava `auth.users.email_confirmed_at` quando a
--      verificação é real. O evento de auditoria
--      `email_verification_completed` nasce de um TRIGGER em
--      `auth.users` (ver supabase/migrations/0004_account_audit.sql)
--      que só dispara na transição real `email_confirmed_at: null ->
--      not null` — não fabricável por nenhuma RPC.
--   5. `request_password_recovery_grant`/`consume_auth_flow_grant`/
--      `handle_new_user_confirmation_grant` e a tabela
--      `public.auth_flow_grants` são REMOVIDOS por completo (bloqueador
--      3 da revisão externa: "remova o desenho em que o pedido de envio
--      do e-mail cria um grant que depois pode ser ativado por qualquer
--      sessão comum"). O pedido de recuperação
--      (`app/(auth)/forgot-password/actions.ts`) volta a ser só
--      "dispara o e-mail" — sem criar nenhuma linha, sem conceder nada.
--
-- Como rodar localmente após esta mudança: `npx supabase db reset`
-- (mesmo padrão das duas remediações anteriores desta mesma migração —
-- a TASK-002 ainda não foi mesclada, então editar o arquivo em vez de
-- empilhar uma 0005 é a forma correta de expressar "estado final
-- correto da branch", conforme instrução explícita da revisão externa).
-- `supabase migration up` incremental NÃO deve ser usado depois de
-- editar um arquivo já aplicado localmente — vai reportar drift de
-- checksum; use sempre reset completo em ambiente de desenvolvimento.

-- ============================================================
-- 0. Remove por completo o desenho anterior (auth_flow_grants e tudo
--    que o cercava) — nada aqui sobrevive na versão final.
-- ============================================================

drop trigger if exists on_auth_user_created_confirmation_grant on auth.users;
drop function if exists public.handle_new_user_confirmation_grant();
drop function if exists public.request_password_recovery_grant(text);
drop function if exists public.consume_auth_flow_grant(text);
-- Assinatura antiga (zero parâmetros) de uma versão anterior deste
-- arquivo — a nova versão abaixo recebe um nonce; remover explicitamente
-- evita deixar um overload órfão chamável no catálogo.
drop function if exists public.claim_recovery_grant_for_password_change();
drop function if exists public.is_current_session_recovery_grant();
drop table if exists public.auth_flow_grants;

-- ============================================================
-- 1. Tabela: um grant de recuperação de senha por usuário, emitido
--    SOMENTE por issue_password_recovery_grant (service_role only).
--    Nenhuma policy de RLS para nenhum papel de cliente — mesmo padrão
--    de public.audit_log: zero acesso direto, tudo mediado por função
--    SECURITY DEFINER.
-- ============================================================

create table public.password_recovery_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  nonce_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint password_recovery_grants_user_unique unique (user_id),
  constraint password_recovery_grants_nonce_hash_format check (nonce_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.password_recovery_grants is
  'Prova server-side, não fabricável por nenhuma sessão de cliente, de que uma verificação real de token de recuperação (supabase.auth.verifyOtp({type:"recovery"}) em app/auth/recovery/route.ts) aconteceu para este user_id/session_id. Substitui public.auth_flow_grants (qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-001): diferente daquele desenho, a linha só é criada DEPOIS de verifyOtp confirmar o token — nunca no momento de "pedir" a recuperação. Nenhum grant de tabela para anon/authenticated: toda leitura/escrita passa por issue_password_recovery_grant (só service_role) e claim_recovery_grant_for_password_change/is_current_session_recovery_grant (só authenticated, e exigem nonce/session_id da própria sessão).';

comment on column public.password_recovery_grants.nonce_hash is
  'sha256(nonce) em hex minúsculo. O nonce em si (256 bits de entropia, gerado em lib/supabase/service-only/recovery-grant-issuer.ts) nunca é gravado em texto puro — só existe em memória do processo Next.js e num cookie HttpOnly path=/reset-password devolvido ao navegador.';

alter table public.password_recovery_grants enable row level security;

revoke all on public.password_recovery_grants from public, anon, authenticated, service_role;

-- service_role: só uso administrativo/debug local (mesmo padrão de
-- audit_log). Nenhuma rota de usuário usa um cliente service_role
-- genérico — a única gravação nesta tabela em produção passa por
-- issue_password_recovery_grant, que roda como SECURITY DEFINER (dono
-- da função, não do papel chamador) e por isso não precisa deste GRANT
-- de tabela para funcionar.
grant select, insert, update, delete on public.password_recovery_grants to service_role;

-- ============================================================
-- 2. Emissão — SOMENTE service_role pode chamar. anon/authenticated/
--    PUBLIC não têm EXECUTE nenhum; mesmo uma sessão comum com um
--    access_token válido não consegue invocar esta função via
--    PostgREST, porque a autenticação como service_role exige a
--    SUPABASE_SERVICE_ROLE_KEY, que nunca chega ao navegador
--    (lib/supabase/env.ts:getServiceRoleEnv lança se chamada no
--    cliente) e só é usada dentro do módulo server-only isolado
--    lib/supabase/service-only/recovery-grant-issuer.ts, importado
--    apenas por app/auth/recovery/route.ts, só depois de um
--    verifyOtp({type:"recovery"}) bem-sucedido.
-- ============================================================

create or replace function public.issue_password_recovery_grant(
  p_user_id uuid,
  p_session_id uuid,
  p_nonce text,
  p_ttl_seconds integer default 1800
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_session_id is null then
    raise exception 'issue_password_recovery_grant: user_id e session_id são obrigatórios';
  end if;

  if p_nonce is null or length(p_nonce) < 16 then
    raise exception 'issue_password_recovery_grant: nonce ausente ou fraco demais';
  end if;

  -- TTL defensivo: nunca mais que 1 hora, nunca zero/negativo, mesmo se
  -- o chamador (nosso próprio código server-side) passar um valor
  -- absurdo por engano.
  if p_ttl_seconds is null or p_ttl_seconds <= 0 or p_ttl_seconds > 3600 then
    raise exception 'issue_password_recovery_grant: ttl_seconds fora do intervalo permitido (1..3600)';
  end if;

  -- pgcrypto (digest()) vive no schema "extensions" no Supabase local/hospedado,
  -- não em "public" — com search_path = '' precisa ser qualificado
  -- explicitamente (gen_random_uuid() não precisa: é nativo do
  -- pg_catalog desde o Postgres 13, sempre pesquisado implicitamente).
  insert into public.password_recovery_grants (user_id, session_id, nonce_hash, expires_at)
  values (
    p_user_id,
    p_session_id,
    encode(extensions.digest(p_nonce, 'sha256'), 'hex'),
    now() + make_interval(secs => p_ttl_seconds)
  )
  on conflict (user_id) do update
    set id = gen_random_uuid(),
        session_id = excluded.session_id,
        nonce_hash = excluded.nonce_hash,
        created_at = now(),
        expires_at = excluded.expires_at;
end;
$$;

comment on function public.issue_password_recovery_grant(uuid, uuid, text, integer) is
  'Único ponto de EMISSÃO de um grant de recuperação. EXECUTE só para service_role — chamada exclusivamente por lib/supabase/service-only/recovery-grant-issuer.ts, dentro de app/auth/recovery/route.ts, imediatamente após supabase.auth.verifyOtp({type:"recovery", token_hash}) ter retornado sucesso real. user_id/session_id vêm da resposta do próprio GoTrue àquela chamada, nunca de um parâmetro de cliente (fecha BUG-CLAUDE-001, qa/reports/TASK-002-CLAUDE-VERIFICATION.md). Um novo pedido substitui (upsert) qualquer grant pendente anterior do mesmo usuário — invalida um link/sessão de recuperação anterior ainda não reivindicado.';

revoke all on function public.issue_password_recovery_grant(uuid, uuid, text, integer) from public;
grant execute on function public.issue_password_recovery_grant(uuid, uuid, text, integer) to service_role;

-- ============================================================
-- 3. Reivindicação atômica para a TROCA DE SENHA — chamável por
--    authenticated, mas exige TRÊS provas simultâneas que uma sessão
--    comum não possui: auth.uid() bater com o user_id do grant,
--    session_id (de auth.jwt()) bater com a sessão que verifyOtp criou,
--    e o nonce correto (só existe no cookie HttpOnly devolvido pela
--    própria rota de recuperação). DELETE condicional único — sem
--    "consultar depois consumir" — garante exatamente uma reivindicação
--    sob concorrência real (mesmo mecanismo, já validado sob corrida,
--    da versão anterior desta função).
-- ============================================================

create or replace function public.claim_recovery_grant_for_password_change(p_nonce text)
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
  if v_uid is null or v_session_id is null or p_nonce is null or length(p_nonce) = 0 then
    return false;
  end if;

  delete from public.password_recovery_grants
  where user_id = v_uid
    and session_id = v_session_id
    and nonce_hash = encode(extensions.digest(p_nonce, 'sha256'), 'hex')
    and expires_at > now();

  get diagnostics v_rows = row_count;

  if v_rows <> 1 then
    return false;
  end if;

  -- Auditoria DENTRO da mesma transação do consumo: falha no insert
  -- derruba a função inteira (o DELETE acima incluído) via rollback
  -- automático — nenhuma exceção é capturada aqui.
  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (v_uid, null, 'password_recovery_completed', 'auth_user', v_uid::text, '{}'::jsonb);

  return true;
end;
$$;

comment on function public.claim_recovery_grant_for_password_change(text) is
  'Chamada por app/(auth)/reset-password/actions.ts IMEDIATAMENTE ANTES de supabase.auth.updateUser({password}) — nunca depois. Exige simultaneamente: auth.uid() = user_id do grant, session_id da sessão atual = session_id gravado na emissão, e o nonce correto (lido do cookie HttpOnly RECOVERY_NONCE_COOKIE por lib/tenant/recovery-session.ts) — uma sessão comum sem esse cookie específico não reivindica nada, mesmo sabendo que um grant existe. false = nada a reivindicar (sem grant válido, nonce incorreto, já reivindicado por outra requisição concorrente, ou expirado): a Server Action deve recusar a troca sem chamar updateUser(). Se updateUser() falhar DEPOIS de um claim bem-sucedido, o grant já foi apagado — não há como "devolvê-lo"; a Server Action deve falhar com segurança e exigir uma nova recuperação.';

revoke all on function public.claim_recovery_grant_for_password_change(text) from public;
grant execute on function public.claim_recovery_grant_for_password_change(text) to authenticated;

-- ============================================================
-- 4. Checagem de leitura (GET /reset-password, guards de middleware): a
--    sessão ATUAL está em modo de recuperação? Não exige o nonce (só
--    gate de UI — a autorização real de escrita vive no claim acima).
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
    from public.password_recovery_grants
    where user_id = auth.uid()
      and session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and expires_at > now()
  );
$$;

comment on function public.is_current_session_recovery_grant() is
  'Usada por lib/tenant/recovery-session.ts (isCurrentSessionRecovery) para decidir se a sessão ATUAL deve ver o formulário de troca de senha — zero parâmetros, lê só auth.uid()/auth.jwt() da própria sessão chamando. Só true entre a emissão real (issue_password_recovery_grant, depois de verifyOtp) e a reivindicação (claim_recovery_grant_for_password_change) — depois do claim a linha não existe mais.';

revoke all on function public.is_current_session_recovery_grant() from public;
grant execute on function public.is_current_session_recovery_grant() to authenticated;
