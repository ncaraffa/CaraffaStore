-- TASK-012 — Sessão administrativa FAIL-CLOSED, com cutover versionado.
--
-- O BURACO QUE ESTA MIGRATION FECHA
--
-- 0016 negava apenas quem TINHA uma linha em app_sessions revogada. Um
-- JWT válido SEM linha nenhuma passava. Reproduzido com JWT real contra
-- o PostgREST: catalog_create_product criou um produto de verdade com
-- zero sessões registradas.
--
-- Isso foi introduzido de propósito como estratégia de rollout (não
-- transformar o deploy num logout global), mas ficou permanente — e
-- "missing session = allow" é exatamente o bypass que anula a sessão
-- única: bastava nunca chamar o bootstrap.
--
-- REGRA FINAL
--
--   auth válida + membership válida + sessão REGISTRADA e viva
--     = autorizado
--
--   qualquer outra combinação = negado
--
-- COMO O CUTOVER FUNCIONA (sem data hardcoded, sem exceção eterna)
--
-- O corte é por `iat` do próprio JWT, comparado com um instante gravado
-- em app_session_policy no momento em que ESTA migration roda:
--
--   iat >= enforced_from  ->  token emitido depois do cutover. Precisa
--                             de sessão registrada. SEM sessão = NEGADO.
--   iat <  enforced_from  ->  token emitido antes de a política existir.
--                             Tolerado, para o deploy não deslogar quem
--                             estava no meio de uma operação.
--
-- A janela de tolerância FECHA SOZINHA: o access token do Supabase dura
-- ~1 hora e todo refresh emite um `iat` novo. Em no máximo um ciclo de
-- token não existe mais nenhum JWT com iat anterior ao cutover — sem
-- cron, sem job, sem alguém lembrar de virar uma flag. Depois disso a
-- condição `iat < enforced_from` é logicamente inalcançável.
--
-- Quem estava logado não perde nada: a primeira página do painel chama
-- requireStoreStatus, que registra a sessão. Quem NUNCA passa por uma
-- página e só chama RPC direto é precisamente o caso que queremos negar.
--
-- POR QUE ISSO TAMBÉM RESOLVE OUTROS TRÊS CASOS
--
--   * linha REMOVIDA do banco: sem linha viva -> negado. Antes, apagar a
--     linha ressuscitava o JWT (o pior bypass possível).
--   * sessão de RECUPERAÇÃO de senha: o Supabase emite um session_id NOVO
--     ao trocar o token de recuperação (verificado empiricamente), e essa
--     sessão nunca passa pelo bootstrap administrativo — logo não tem
--     linha e não autoriza mutation. Não é preciso farejar claim nenhum:
--     o `amr` de uma recuperação é {"method":"otp"}, indistinguível de um
--     login OTP legítimo, então depender dele seria frágil.
--   * membro removido que apaga a própria linha: continua negado, porque
--     a ausência de linha deixou de significar permissão.

-- ============================================================
-- 1. A política, com o instante do cutover
-- ============================================================

create table public.app_session_policy (
  -- Linha única: `id` é sempre true, então só existe uma política.
  id boolean primary key default true check (id),
  enforced_from timestamptz not null,
  note text
);

insert into public.app_session_policy (id, enforced_from, note)
values (
  true,
  now(),
  'TASK-012 — instante em que a exigência de sessão registrada passou a valer. JWTs com iat anterior a este momento são tolerados; como o access token do Supabase expira em ~1h e todo refresh emite iat novo, a tolerância se extingue sozinha em no máximo um ciclo de token.'
);

alter table public.app_session_policy enable row level security;
-- Sem policy nenhuma: ninguém lê pelo PostgREST. As funções SECURITY
-- DEFINER abaixo leem por dentro.

comment on table public.app_session_policy is
  'Marco do cutover da sessão administrativa. enforced_from é gravado na aplicação desta migration — não é data hardcoded no código nem flag manual. A comparação é com o claim iat do JWT, então a janela de compatibilidade fecha por conta própria quando os tokens antigos expiram.';

create or replace function public.app_session_enforced_from()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $fn$
  select enforced_from from public.app_session_policy where id;
$fn$;

revoke all on function public.app_session_enforced_from() from public;
grant execute on function public.app_session_enforced_from() to authenticated, service_role;

-- ============================================================
-- 2. app_session_denied — agora fail-closed
-- ============================================================

create or replace function public.app_session_denied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    -- Sem JWT não há o que decidir aqui (rotas públicas/anon nunca
    -- chegam nos helpers administrativos; storefront e webhook seguem
    -- intocados).
    when auth.jwt() ->> 'session_id' is null then false

    -- Sessão registrada, viva e não revogada -> autorizado.
    when exists (
      select 1 from public.app_sessions s
      where s.supabase_session_hash = public.current_supabase_session_hash()
        and s.revoked_at is null
        and s.expires_at > now()
    ) then false

    -- Não há sessão viva (revogada, expirada, apagada ou nunca criada).
    -- NEGA se este token foi emitido a partir do cutover. É esta linha
    -- que fecha o bypass de "missing session = allow".
    else coalesce((auth.jwt() ->> 'iat')::bigint, 0)
         >= extract(epoch from public.app_session_enforced_from())
  end;
$fn$;

comment on function public.app_session_denied() is
  'TRUE quando esta requisição NÃO tem sessão administrativa válida da CaraffaStore. Fail-closed: ausência de sessão registrada nega, desde que o JWT tenha sido emitido a partir do cutover (app_session_policy.enforced_from). Consultada pelos três helpers centrais de autorização e por require_active_app_session, então vale igualmente para Server Action, API route e chamada PostgREST direta. Nunca autoriza ninguém — só nega quem já passaria.';

revoke all on function public.app_session_denied() from public;
grant execute on function public.app_session_denied() to authenticated, service_role;

-- ============================================================
-- 3. O bootstrap não pode depender de si mesmo
-- ============================================================
--
-- app_session_start valida membership consultando workspace_members
-- DIRETO, sem passar por is_store_member — de propósito. Se ele usasse
-- os helpers, ninguém conseguiria registrar a primeira sessão: o helper
-- negaria por não haver sessão, e a sessão nunca seria criada. É a única
-- porta que precisa funcionar sem sessão, e ela não concede nada além de
-- registrar a sessão de quem já é membro.
--
-- Reafirmado aqui como documentação executável: se alguém no futuro
-- trocar essa consulta por is_store_member, o teste de fail-closed passa
-- a falhar no caso 2 (com sessão) em vez de silenciosamente travar tudo.

comment on function public.app_session_start(uuid, text, boolean) is
  'Abre ou renova a sessão da CaraffaStore para o session_id do JWT atual. É a ÚNICA função administrativa que funciona sem sessão registrada — precisa ser, senão a primeira sessão nunca poderia ser criada (o helper negaria antes). Valida membership lendo workspace_members diretamente, nunca is_store_member, exatamente para evitar essa dependência circular. Idempotente por browser; sob plano de sessão única devolve conflict em vez de erro cru, e o takeover revoga a outra sob lock do workspace.';
