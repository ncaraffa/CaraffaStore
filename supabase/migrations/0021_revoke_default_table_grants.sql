-- TASK-012 — QA final: remove privilégios de tabela concedidos por
-- DEFAULT do Supabase às tabelas criadas por 0012..0020.
--
-- O BURACO
--
-- No Supabase, ALTER DEFAULT PRIVILEGES concede TODOS os privilégios
-- sobre tabelas novas do schema `public` a anon/authenticated/service_role.
-- Toda migration deste projeto desde 0001 neutraliza isso com
--
--   revoke all on <tabela> from public, anon, authenticated, service_role;
--
-- antes de conceder o mínimo necessário. NENHUMA das nove migrations da
-- TASK-012 fez esse revoke. Resultado medido no banco:
--
--   tabelas antigas (products, orders, stores) -> authenticated: SELECT
--   tabelas novas (app_sessions, coupons, ...) -> authenticated:
--        REFERENCES, SELECT, TRIGGER, TRUNCATE
--
-- POR QUE ISSO É GRAVE
--
-- TRUNCATE **não passa por RLS**. RLS filtra linhas em SELECT/INSERT/
-- UPDATE/DELETE; TRUNCATE é DDL e ignora policy. Ou seja: qualquer
-- pessoa que criasse uma conta — sem vínculo com loja nenhuma — podia
-- apagar tabelas inteiras de TODOS os tenants.
--
-- Reproduzido como `authenticated` com um auth.uid() aleatório:
--
--   truncate table public.app_sessions;          -> TRUNCATE TABLE (sucesso)
--   truncate table public.workspace_invitations; -> TRUNCATE TABLE (sucesso)
--
-- coupons e platform_plans escaparam por acidente: o CASCADE bateu em
-- orders/onboarding_progress, que são tabelas antigas e por isso NÃO
-- têm o privilégio. Sorte, não desenho — bastava a ordem das FKs ser
-- outra.
--
-- Impacto prático do que passou: logout global (app_sessions) e
-- destruição de convites pendentes de todos os workspaces. Não é
-- escalação de privilégio, mas é destruição de dados cross-tenant por
-- qualquer conta autenticada.
--
-- A CORREÇÃO
--
-- Revoga tudo e reconcede exatamente o SELECT que cada tela precisa. As
-- ESCRITAS continuam todas em funções SECURITY DEFINER, que rodam como
-- dono da função e não dependem de privilégio de tabela do chamador —
-- então tirar o DML não quebra nada.

-- ============================================================
-- 1. Zera os privilégios herdados do default
-- ============================================================

revoke all on public.platform_plans from public, anon, authenticated, service_role;
revoke all on public.workspaces from public, anon, authenticated, service_role;
revoke all on public.workspace_subscriptions from public, anon, authenticated, service_role;
revoke all on public.workspace_members from public, anon, authenticated, service_role;
revoke all on public.workspace_invitations from public, anon, authenticated, service_role;
revoke all on public.app_sessions from public, anon, authenticated, service_role;
revoke all on public.app_session_policy from public, anon, authenticated, service_role;
revoke all on public.coupons from public, anon, authenticated, service_role;
revoke all on public.coupon_redemptions from public, anon, authenticated, service_role;

-- ============================================================
-- 2. Reconcede SOMENTE leitura, e só onde há tela que lê
-- ============================================================

-- Catálogo comercial: informação pública (preços/limites na landing).
grant select on public.platform_plans to anon, authenticated;

-- Lidas com o cliente do próprio usuário, sempre filtradas por RLS:
--   workspaces               -> contexto do comerciante
--   workspace_subscriptions  -> área de assinatura
--   workspace_members        -> /sessao-ativa resolve o workspace
--   workspace_invitations    -> Configurações -> Equipe lista pendentes
--   app_sessions             -> /sessao-ativa mostra a outra sessão
--   coupons                  -> painel de cupons
--   coupon_redemptions       -> uso do cupom no painel
grant select on public.workspaces to authenticated;
grant select on public.workspace_subscriptions to authenticated;
grant select on public.workspace_members to authenticated;
grant select on public.workspace_invitations to authenticated;
grant select on public.app_sessions to authenticated;
grant select on public.coupons to authenticated;
grant select on public.coupon_redemptions to authenticated;

-- app_session_policy fica SEM grant nenhum de propósito: só as funções
-- SECURITY DEFINER precisam do instante de cutover, e elas leem como
-- dono. Ninguém consulta a política pelo PostgREST.

-- ============================================================
-- 3. Nada de INSERT/UPDATE/DELETE/TRUNCATE para ninguém
-- ============================================================
--
-- Não há grant de escrita acima, e é intencional: toda mutação passa
-- por RPC (coupon_upsert, workspace_invite_member, app_session_start,
-- create_order...). Se um dia uma tela precisar escrever direto, o
-- caminho certo é uma função nova — não um grant de tabela.

comment on table public.app_sessions is
  'Sessão da aplicação, uma por sessão do Supabase (logo: uma por browser, não por aba — abas compartilham o mesmo session_id do token). Guarda apenas o HASH do session_id. Revogar uma linha aqui retira autorização de TODA requisição que carregue aquele JWT, inclusive chamadas diretas a PostgREST. Privilégios: authenticated só tem SELECT (0021) — escrita exclusivamente por funções SECURITY DEFINER.';
