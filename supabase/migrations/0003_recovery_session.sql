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
-- ============================================================
-- QUARTA correção pós-QA (revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md, BUG-CLAUDE-VERIF2-001,
-- ALTA): o `claim_recovery_grant_for_password_change` anterior gravava
-- o evento `password_recovery_completed` DENTRO do próprio claim — ou
-- seja, ANTES de `supabase.auth.updateUser({password})` ser chamado em
-- app/(auth)/reset-password/actions.ts. Reproduzido empiricamente: uma
-- sessão revogada entre o claim e o updateUser faz o updateUser falhar
-- (senha nunca muda de fato — senha antiga continua válida), mas a
-- auditoria já afirmava "password_recovery_completed" mesmo assim.
--
-- Corrigido (naquela rodada) reprojetando o grant como uma máquina de
-- estados pending -> claimed -> completed, com a conclusão amarrada a um
-- TRIGGER em auth.users.encrypted_password. Ver histórico completo no
-- bloco anterior deste comentário (preservado por rastreabilidade).
--
-- ============================================================
-- QUINTA correção pós-QA (revisão externa sobre
-- qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, BUG-CLAUDE-VERIF3-001,
-- BLOQUEADOR/ALTA): a trigger de conclusão da rodada anterior
-- (`handle_password_recovery_completion`, supabase/migrations/0004_account_audit.sql)
-- correlacionava a alteração de senha ao grant SOMENTE por
-- `user_id` + `claimed_at is not null and completed_at is null and
-- revoked_at is null` — sem `expires_at`, sem `session_id`, sem janela
-- temporal, sem NENHUMA prova além de "este usuário tem uma linha
-- claimed-e-abandonada". Confirmado empiricamente (três cenários
-- independentes): uma troca de senha comum, uma alteração administrativa,
-- ou uma alteração feita DEPOIS de o grant já ter expirado — todas,
-- desde que existisse um grant `claimed` interrompido (updateUser da
-- recuperação original tendo falhado), "concluíam" esse grant abandonado
-- e fabricavam um `password_recovery_completed` sem NENHUMA relação
-- causal real com aquela tentativa de recuperação. Além disso,
-- `issue_password_recovery_grant` usava `INSERT ... ON CONFLICT (user_id)
-- DO UPDATE`, sobrescrevendo silenciosamente a MESMA linha para todo
-- ciclo (pending/claimed/completed/expirado) — a tabela nunca preservava
-- histórico de tentativas anteriores.
--
-- Causa-raiz: uma trigger genérica sobre `auth.users.encrypted_password`
-- só consegue provar "a senha deste usuário mudou" — nunca "esta
-- mudança foi causada por esta tentativa de recuperação específica".
-- Escolher "o grant claimed atual" por `user_id` e assumir causalidade é
-- exatamente esse erro de desenho.
--
-- Reprojetado nesta correção como TENTATIVA EXPLÍCITA por recuperação,
-- nunca mais uma única linha reutilizada por usuário:
--
--   * Cada emissão (`issue_password_recovery_grant`) primeiro REVOGA
--     explicitamente (revoked_at + revoke_reason) qualquer tentativa
--     ainda ativa (não completed, não revoked) do mesmo usuário, e só
--     ENTÃO insere uma nova linha com `id`/`nonce_hash` novos — a linha
--     revogada é preservada, nunca apagada nem sobrescrita. Um índice
--     único parcial (`password_recovery_grants_one_active_per_user`,
--     `where completed_at is null and revoked_at is null`) garante isso
--     também no nível do banco: fisicamente impossível existir duas
--     tentativas simultaneamente reivindicáveis para o mesmo usuário.
--   * O CLAIM (`claim_recovery_grant_for_password_change`) passa a gerar,
--     ATOMICAMENTE dentro do mesmo UPDATE condicional, uma "completion
--     capability" de uso único (256 bits, só o hash é persistido) e
--     captura `password_fingerprint_before` — sha256 do
--     `auth.users.encrypted_password` NAQUELE instante, prova
--     não-reversível do estado da credencial antes da troca. A
--     capability em si é devolvida SOMENTE ao chamador server-side
--     (nunca ao navegador, nunca logada) — quem a possui prova que
--     reivindicou ESTA tentativa exata.
--   * A CONCLUSÃO deixa de ser uma trigger automática sobre
--     `auth.users` — vira uma função explícita, server-only,
--     `public.complete_password_recovery_attempt(p_attempt_id,
--     p_capability)` (supabase/migrations/0004_account_audit.sql),
--     chamável SOMENTE por `service_role`, invocada pelo reset action
--     SOMENTE depois de `supabase.auth.updateUser({password})` ter
--     retornado sucesso real. Ela exige `attempt_id` + capability exatos
--     daquela tentativa E confirma que o fingerprint da credencial
--     realmente mudou desde o claim — nunca conclui por `user_id`
--     sozinho, nunca escolhe "o grant claimed mais recente", nunca
--     conclui um grant expirado ou revogado.
--
-- Como rodar localmente após esta mudança: `npx supabase db reset`
-- (mesmo padrão das correções anteriores desta mesma migração — a
-- TASK-002 ainda não foi mesclada, então editar o arquivo em vez de
-- empilhar uma 0005 é a forma correta de expressar "estado final
-- correto da branch"). `supabase migration up` incremental NÃO deve ser
-- usado depois de editar um arquivo já aplicado localmente — vai
-- reportar drift de checksum; use sempre reset completo em ambiente de
-- desenvolvimento.

-- ============================================================
-- 0. Remove por completo o desenho anterior (auth_flow_grants e tudo
--    que o cercava) — nada aqui sobrevive na versão final.
-- ============================================================

drop trigger if exists on_auth_user_created_confirmation_grant on auth.users;
drop function if exists public.handle_new_user_confirmation_grant();
drop function if exists public.request_password_recovery_grant(text);
drop function if exists public.consume_auth_flow_grant(text);
-- Assinaturas antigas de versões anteriores deste arquivo — removidas
-- explicitamente para nunca deixar um overload órfão chamável no
-- catálogo.
drop function if exists public.claim_recovery_grant_for_password_change();
drop function if exists public.claim_recovery_grant_for_password_change(text);
drop function if exists public.is_current_session_recovery_grant();
drop table if exists public.auth_flow_grants;
drop table if exists public.password_recovery_grants;

-- ============================================================
-- 1. Tabela: uma LINHA POR TENTATIVA de recuperação de senha (nunca mais
--    reutilizada/sobrescrita por usuário), com máquina de estados
--    pending -> claimed -> completed (ou revoked, em qualquer ponto
--    antes de completed). Emitida SOMENTE por
--    issue_password_recovery_grant (service_role only). Nenhuma policy
--    de RLS para nenhum papel de cliente — mesmo padrão de
--    public.audit_log: zero acesso direto, tudo mediado por função
--    SECURITY DEFINER.
-- ============================================================

create table public.password_recovery_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  nonce_hash text,
  completion_secret_hash text,
  password_fingerprint_before text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  constraint password_recovery_grants_nonce_hash_format check (nonce_hash is null or nonce_hash ~ '^[0-9a-f]{64}$'),
  constraint password_recovery_grants_completion_secret_hash_format check (completion_secret_hash is null or completion_secret_hash ~ '^[0-9a-f]{64}$'),
  constraint password_recovery_grants_fingerprint_format check (password_fingerprint_before is null or password_fingerprint_before ~ '^[0-9a-f]{64}$')
);

comment on table public.password_recovery_grants is
  'Uma LINHA POR TENTATIVA de recuperação de senha (qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, BUG-CLAUDE-VERIF3-001) — nunca reutilizada/sobrescrita entre ciclos: issue_password_recovery_grant revoga explicitamente qualquer tentativa ativa anterior e insere uma linha NOVA, preservando o histórico. Máquina de estados: pending (via issue_password_recovery_grant) -> claimed (via claim_recovery_grant_for_password_change, que também grava completion_secret_hash + password_fingerprint_before) -> completed (via complete_password_recovery_attempt, supabase/migrations/0004_account_audit.sql, server-only/service_role, chamada só depois de updateUser() ter sucesso real, exigindo attempt_id + capability exatos e prova de que a credencial realmente mudou). revoked em qualquer ponto antes de completed (nova emissão, expiração administrativa). O índice único parcial password_recovery_grants_one_active_per_user garante que no máximo UMA tentativa por usuário esteja "ativa" (nem completed nem revoked) a qualquer momento — não existe mais upsert por user_id. Nenhum GRANT de tabela para anon/authenticated: toda leitura/escrita passa por funções SECURITY DEFINER.';

comment on column public.password_recovery_grants.nonce_hash is
  'sha256(nonce) em hex minúsculo. O nonce em si (256 bits de entropia, gerado em lib/supabase/service-only/recovery-grant-issuer.ts) nunca é gravado em texto puro — só existe em memória do processo Next.js e num cookie HttpOnly path=/reset-password devolvido ao navegador. Limpo (NULL) no momento do claim — a partir daí o nonce não serve mais para nada, mesmo que o cookie vaze depois.';

comment on column public.password_recovery_grants.completion_secret_hash is
  'sha256(completion capability) em hex minúsculo — gerada ATOMICAMENTE por claim_recovery_grant_for_password_change() no mesmo UPDATE que marca claimed_at. A capability em si (256 bits) é devolvida SOMENTE ao chamador server-side do claim (nunca ao navegador, nunca logada) — só quem a possui pode concluir ESTA tentativa exata via complete_password_recovery_attempt(). Limpa (NULL) na conclusão — uso único.';

comment on column public.password_recovery_grants.password_fingerprint_before is
  'sha256(auth.users.encrypted_password) em hex, capturado por claim_recovery_grant_for_password_change() no instante do claim — prova não reversível do estado da credencial ANTES da troca (nunca a senha nem o hash bcrypt em si). complete_password_recovery_attempt() só conclui se o fingerprint ATUAL da credencial for DIFERENTE deste — prova de que a senha realmente mudou depois do claim, fechando BUG-CLAUDE-VERIF3-001 (uma conclusão não pode acontecer sem alteração real).';

comment on column public.password_recovery_grants.claimed_at is
  'Marcado por claim_recovery_grant_for_password_change() — prova que a sessão correta reivindicou a autorização atomicamente. NÃO significa que a senha já mudou: claimed_at não nulo com completed_at nulo é um estado válido e esperado durante a janela síncrona entre o claim e o updateUser subsequente.';

comment on column public.password_recovery_grants.claim_expires_at is
  'Janela de conclusão após o claim (now() + 5 minutos, fixado dentro de claim_recovery_grant_for_password_change() abaixo) — complete_password_recovery_attempt() recusa concluir uma tentativa claimed cuja janela já passou, mesmo com capability e fingerprint corretos. Evita que uma tentativa claimed fique concluível indefinidamente no futuro.';

comment on column public.password_recovery_grants.completed_at is
  'Marcado SOMENTE por complete_password_recovery_attempt() (supabase/migrations/0004_account_audit.sql), server-only/service_role, chamada pelo reset action IMEDIATAMENTE depois de supabase.auth.updateUser() ter retornado sucesso real, com attempt_id + completion capability exatos desta tentativa. Nenhuma trigger genérica sobre auth.users marca esta coluna (BUG-CLAUDE-VERIF3-001) — uma alteração de senha não relacionada (troca comum, administrativa, ou sobre uma tentativa já expirada) nunca a preenche.';

comment on column public.password_recovery_grants.revoked_at is
  'Preenchido quando uma tentativa ativa é substituída por uma nova emissão (issue_password_recovery_grant, revoke_reason=''superseded_by_new_recovery''). Uma tentativa revoked nunca pode ser reivindicada nem concluída — tratada como estado terminal por todas as funções, no mesmo nível de completed.';

comment on column public.password_recovery_grants.revoke_reason is
  'Motivo textual curto da revogação (ex.: superseded_by_new_recovery) — nunca contém dado sensível, só um identificador curto de causa.';

alter table public.password_recovery_grants enable row level security;

revoke all on public.password_recovery_grants from public, anon, authenticated, service_role;

-- service_role: só uso administrativo/debug local (mesmo padrão de
-- audit_log). Nenhuma rota de usuário usa um cliente service_role
-- genérico — as gravações desta tabela em produção passam por funções
-- SECURITY DEFINER (dono da função, não do papel chamador) e por isso
-- não precisam deste GRANT de tabela para funcionar.
grant select, insert, update, delete on public.password_recovery_grants to service_role;

-- No máximo UMA tentativa "ativa" (nem completed, nem revoked) por
-- usuário a qualquer momento — garantia de banco, não só de aplicação.
-- issue_password_recovery_grant revoga explicitamente a tentativa ativa
-- anterior (se existir) ANTES de inserir a nova, na mesma transação da
-- função — nunca viola este índice.
create unique index password_recovery_grants_one_active_per_user
  on public.password_recovery_grants (user_id)
  where completed_at is null and revoked_at is null;

comment on index public.password_recovery_grants_one_active_per_user is
  'No máximo uma tentativa ativa (pending ou claimed, nem completed nem revoked) por usuário — garantia de banco de que nunca existem duas tentativas simultaneamente reivindicáveis/concluíveis para o mesmo usuário (qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md, BUG-CLAUDE-VERIF3-001).';

create index password_recovery_grants_user_id_idx on public.password_recovery_grants (user_id);

-- ============================================================
-- 2. Emissão — SOMENTE service_role pode chamar. anon/authenticated/
--    PUBLIC não têm EXECUTE nenhum; mesmo uma sessão comum com um
--    access_token válido não consegue invocar esta função via
--    PostgREST, porque a autenticação como service_role exige a
--    SUPABASE_SERVICE_ROLE_KEY, que nunca chega ao navegador
--    (lib/supabase/env.ts:getServiceRoleEnv lança se chamada no
--    cliente) e só é usada dentro do módulo server-only isolado
--    lib/supabase/service-only/recovery-grant-issuer.ts (protegido em
--    tempo de build por `import "server-only"`), importado apenas por
--    app/auth/recovery/route.ts, só depois de um
--    verifyOtp({type:"recovery"}) bem-sucedido.
--
--    BUG-CLAUDE-VERIF3-001: em vez de INSERT ... ON CONFLICT (user_id)
--    DO UPDATE (sobrescrita silenciosa da mesma linha para qualquer
--    estado anterior), esta versão REVOGA explicitamente qualquer
--    tentativa ainda ativa do mesmo usuário e INSERE uma linha nova —
--    o histórico de tentativas anteriores nunca é apagado nem
--    reescrito.
-- ============================================================

create or replace function public.issue_password_recovery_grant(
  p_user_id uuid,
  p_session_id uuid,
  p_nonce text,
  p_ttl_seconds integer default 1800
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
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

  -- Revoga explicitamente qualquer tentativa ainda ativa (nem completed,
  -- nem já revoked) deste usuário — preserva a linha (nunca apaga,
  -- nunca sobrescreve), só marca revoked_at/revoke_reason. Sem isso, o
  -- INSERT abaixo violaria password_recovery_grants_one_active_per_user
  -- caso já existisse uma tentativa ativa.
  update public.password_recovery_grants
  set revoked_at = now(),
      revoke_reason = 'superseded_by_new_recovery'
  where user_id = p_user_id
    and completed_at is null
    and revoked_at is null;

  if found then
    insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
    values (p_user_id, null, 'password_recovery_revoked', 'auth_user', p_user_id::text, jsonb_build_object('reason', 'superseded_by_new_recovery'));
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
  returning id into v_attempt_id;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (p_user_id, null, 'password_recovery_grant_issued', 'auth_user', p_user_id::text, jsonb_build_object('attempt_id', v_attempt_id));

  return v_attempt_id;
end;
$$;

comment on function public.issue_password_recovery_grant(uuid, uuid, text, integer) is
  'Único ponto de EMISSÃO (estado pending) de uma NOVA tentativa de recuperação. EXECUTE só para service_role — chamada exclusivamente por lib/supabase/service-only/recovery-grant-issuer.ts, dentro de app/auth/recovery/route.ts, imediatamente após supabase.auth.verifyOtp({type:"recovery", token_hash}) ter retornado sucesso real. user_id/session_id vêm da resposta do próprio GoTrue àquela chamada, nunca de um parâmetro de cliente (fecha BUG-CLAUDE-001, qa/reports/TASK-002-CLAUDE-VERIFICATION.md). Um novo pedido REVOGA explicitamente (revoked_at/revoke_reason) qualquer tentativa ativa anterior do mesmo usuário e insere uma linha NOVA — nunca sobrescreve a linha anterior (fecha BUG-CLAUDE-VERIF3-001, qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md). Retorna o id da nova tentativa (uso interno/testes — o valor não é enviado ao navegador).';

revoke all on function public.issue_password_recovery_grant(uuid, uuid, text, integer) from public;
grant execute on function public.issue_password_recovery_grant(uuid, uuid, text, integer) to service_role;

-- ============================================================
-- 3. Reivindicação atômica (estado pending -> claimed) — chamável por
--    authenticated, mas exige TRÊS provas simultâneas que uma sessão
--    comum não possui: auth.uid() bater com o user_id do grant,
--    session_id (de auth.jwt()) bater com a sessão que verifyOtp criou,
--    e o nonce correto (só existe no cookie HttpOnly devolvido pela
--    própria rota de recuperação). UPDATE condicional único — sem
--    "consultar depois consumir" — garante exatamente uma reivindicação
--    sob concorrência real.
--
--    BUG-CLAUDE-VERIF2-001: esta função NÃO grava
--    'password_recovery_completed' — a senha ainda não mudou neste
--    ponto. O evento gravado aqui é
--    'password_recovery_authorization_claimed'.
--
--    BUG-CLAUDE-VERIF3-001: o MESMO UPDATE atômico também gera uma
--    completion capability de uso único (só o hash é persistido) e
--    captura password_fingerprint_before (sha256 da credencial atual) —
--    ambos exigidos depois por complete_password_recovery_attempt() para
--    provar causalidade real com esta tentativa exata, nunca com
--    "qualquer grant claimed do usuário".
--
--    Retorna jsonb: {"claimed": boolean, "attempt_id": uuid|null,
--    "completion_capability": text|null}. attempt_id/completion_capability
--    só vêm preenchidos quando claimed=true. A capability NUNCA deve ser
--    repassada ao navegador — só existe em memória do processo Next.js
--    (Server Action) entre este claim e o updateUser()/complete_password_recovery_attempt()
--    subsequentes.
-- ============================================================

create or replace function public.claim_recovery_grant_for_password_change(p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_attempt_id uuid;
  v_capability text;
  v_fingerprint text;
  v_encrypted_password text;
begin
  if v_uid is null or v_session_id is null or p_nonce is null or length(p_nonce) = 0 then
    return jsonb_build_object('claimed', false, 'attempt_id', null, 'completion_capability', null);
  end if;

  select encrypted_password into v_encrypted_password
  from auth.users
  where id = v_uid;

  if v_encrypted_password is null then
    return jsonb_build_object('claimed', false, 'attempt_id', null, 'completion_capability', null);
  end if;

  v_fingerprint := encode(extensions.digest(v_encrypted_password, 'sha256'), 'hex');
  -- 256 bits de entropia — mesmo padrão do nonce de emissão. Só o HASH
  -- é persistido (completion_secret_hash); o valor bruto só existe
  -- neste retorno, em memória do processo Next.js chamador.
  v_capability := encode(extensions.gen_random_bytes(32), 'hex');

  update public.password_recovery_grants
  set claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      nonce_hash = null,
      completion_secret_hash = encode(extensions.digest(v_capability, 'sha256'), 'hex'),
      password_fingerprint_before = v_fingerprint
  where user_id = v_uid
    and session_id = v_session_id
    and nonce_hash = encode(extensions.digest(p_nonce, 'sha256'), 'hex')
    and expires_at > now()
    and claimed_at is null
    and completed_at is null
    and revoked_at is null
  returning id into v_attempt_id;

  if v_attempt_id is null then
    return jsonb_build_object('claimed', false, 'attempt_id', null, 'completion_capability', null);
  end if;

  -- Auditoria DENTRO da mesma transação da reivindicação: falha no
  -- insert derruba a função inteira (o UPDATE acima incluído) via
  -- rollback automático — nenhuma exceção é capturada aqui. Evento
  -- afirma só "autorização reivindicada", nunca "senha trocada".
  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (v_uid, null, 'password_recovery_authorization_claimed', 'auth_user', v_uid::text, jsonb_build_object('attempt_id', v_attempt_id));

  return jsonb_build_object('claimed', true, 'attempt_id', v_attempt_id, 'completion_capability', v_capability);
end;
$$;

comment on function public.claim_recovery_grant_for_password_change(text) is
  'Chamada por app/(auth)/reset-password/actions.ts IMEDIATAMENTE ANTES de supabase.auth.updateUser({password}) — nunca depois. Exige simultaneamente: auth.uid() = user_id da tentativa, session_id da sessão atual = session_id gravado na emissão, e o nonce correto (lido do cookie HttpOnly RECOVERY_NONCE_COOKIE por lib/tenant/recovery-session.ts) — uma sessão comum sem esse cookie específico não reivindica nada, mesmo sabendo que uma tentativa existe. claimed=false no jsonb retornado significa que não há nada a reivindicar (sem tentativa válida, nonce incorreto, já reivindicada/concluída/revogada por outra requisição, ou expirada): a Server Action deve recusar a troca sem chamar updateUser(). Gera, no mesmo UPDATE atômico, uma completion capability de uso único (só o hash persistido) e password_fingerprint_before (sha256 da credencial no instante do claim) — ambos exigidos por complete_password_recovery_attempt() (supabase/migrations/0004_account_audit.sql) para provar causalidade real com ESTA tentativa exata (fecha BUG-CLAUDE-VERIF3-001, qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md). Grava SOMENTE password_recovery_authorization_claimed — nunca password_recovery_completed, que só complete_password_recovery_attempt() pode gravar, depois de updateUser() de fato ter sucesso E a credencial ter mudado de verdade. Se updateUser() falhar depois de um claim bem-sucedido, claimed_at permanece preenchido e completed_at permanece null para sempre nesta linha — não há como "devolvê-la"; a Server Action deve falhar com segurança e exigir uma nova recuperação (novo verifyOtp real), que revoga esta tentativa automaticamente via issue_password_recovery_grant.';

revoke all on function public.claim_recovery_grant_for_password_change(text) from public;
grant execute on function public.claim_recovery_grant_for_password_change(text) to authenticated;

-- ============================================================
-- 4. Checagem de leitura (GET /reset-password, guards de middleware): a
--    sessão ATUAL está em modo de recuperação? Não exige o nonce (só
--    gate de UI — a autorização real de escrita vive no claim acima).
--    Exclui grants já completed/revoked — uma vez concluída ou
--    revogada, a sessão não deve mais aparentar estar "em recuperação"
--    (na prática irrelevante para completed, já que a Server Action
--    sempre faz signOut() logo depois, mas mantido por corretude do
--    estado).
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
      and completed_at is null
      and revoked_at is null
  );
$$;

comment on function public.is_current_session_recovery_grant() is
  'Usada por lib/tenant/recovery-session.ts (isCurrentSessionRecovery) para decidir se a sessão ATUAL deve ver o formulário de troca de senha — zero parâmetros, lê só auth.uid()/auth.jwt() da própria sessão chamando. True desde a emissão real (issue_password_recovery_grant, depois de verifyOtp) até a conclusão real (completed_at, via complete_password_recovery_attempt) ou revogação — permanece true durante o estado claimed (a sessão continua "em modo recuperação" enquanto o updateUser()/complete_password_recovery_attempt() correspondentes ainda não terminaram).';

revoke all on function public.is_current_session_recovery_grant() from public;
grant execute on function public.is_current_session_recovery_grant() to authenticated;
