-- TASK-012 — Modelo real de planos e entitlements.
--
-- Três problemas resolvidos aqui, nesta ordem:
--
--   A) IDENTIDADE DO PLANO. Até 0011 o plano era o próprio preço
--      (plan_code 30/50/80), com a incoerência permanente de o
--      Profissional custar R$70 sob o código legado 80
--      (docs/PLANS-SPEC.md). A identidade passa a ser plan_key
--      ('essential'|'growth'|'professional') e o preço vira só mais um
--      atributo. Nenhuma autorização volta a depender de preço.
--
--   B) ENTITLEMENTS. Antes desta migration os planos eram
--      funcionalmente idênticos (seção 7 do PLANS-SPEC: quase tudo
--      classificado "C"). platform_plans passa a ser a ÚNICA fonte de
--      verdade dos limites, no banco — a aplicação lê daqui, nunca
--      redeclara. entitlement_version permite evoluir a matriz sem
--      reinventar o modelo.
--
--   C) ESCOPO DA ASSINATURA. O billing de 0008 é estritamente POR LOJA
--      (store_plans.store_id PK, billing_charges.store_id). A proposta
--      comercial nova é "uma assinatura do comerciante permite até N
--      lojas", o que é incompatível com plano-por-loja. Criamos
--      workspaces (conta de cobrança do comerciante) e movemos o plano
--      para lá.
--
-- MIGRAÇÃO SEGURA (expand/contract). Esta migration é a fase EXPAND:
-- adiciona plan_key ao lado de plan_code e faz backfill, mas NÃO remove
-- nenhuma coluna nem quebra nenhum consumidor existente. plan_code
-- continua válido e correto durante toda a transição; a remoção só pode
-- acontecer numa migration futura, depois de provado que ninguém lê.
-- Nenhum cliente troca de plano nem de preço por causa deste arquivo.

-- ============================================================
-- 1. platform_plans — catálogo, preço e entitlements num lugar só
-- ============================================================

create table public.platform_plans (
  plan_key text primary key check (plan_key in ('essential', 'growth', 'professional')),
  label text not null,
  price_cents integer not null check (price_cents > 0),
  tier smallint not null unique check (tier > 0),
  featured boolean not null default false,
  -- Ponte com o mundo legado. UNIQUE para que o mapeamento 30/50/80 ->
  -- key seja uma bijeção verificável pelo banco, não uma convenção
  -- espalhada em código.
  legacy_plan_code integer unique check (legacy_plan_code in (30, 50, 80)),
  entitlement_version integer not null default 1 check (entitlement_version > 0),

  -- Entitlements com enforcement real (seção 36 do TASK): estes cinco
  -- são verificados no servidor/banco em toda escrita.
  max_products integer not null check (max_products > 0),
  max_images_per_product integer not null check (max_images_per_product > 0),
  max_stores integer not null check (max_stores > 0),
  max_team_members integer not null check (max_team_members > 0),
  coupons boolean not null,

  -- Compromissos comerciais/operacionais: viram copy e metadado, não
  -- ganham backend próprio porque não existe workflow que os execute.
  priority_support boolean not null,
  setup_assistance boolean not null,
  store_review boolean not null,
  implementation_support boolean not null,

  created_at timestamptz not null default now()
);

comment on table public.platform_plans is
  'Catálogo de planos da CaraffaStore: identidade (plan_key), preço em centavos e matriz de entitlements. ÚNICA fonte de verdade — lib/billing/plans.ts e a landing leem daqui, nunca redeclaram limites. plan_key nunca deriva de preço: mudar preço é UPDATE em price_cents e não afeta nenhuma autorização. legacy_plan_code existe só para a transição do modelo antigo (30/50/80) e pode ser removido quando nenhum consumidor depender mais de plan_code.';

comment on column public.platform_plans.entitlement_version is
  'Versão da matriz de entitlements. Um workspace guarda a versão sob a qual foi criado/atualizado, de modo que uma futura mudança de limites possa ser aplicada deliberadamente (e auditada) em vez de silenciosamente reinterpretar planos antigos.';

comment on column public.platform_plans.max_team_members is
  'Total de pessoas com acesso ao workspace, INCLUINDO o owner (seção 12 do TASK): essential=1 significa somente o dono, sem nenhum membro adicional.';

-- Seed do catálogo. Preços em centavos, sempre — nunca reais.
-- Profissional custa R$70 (7000) e carrega legacy_plan_code=80: o
-- cliente que hoje está no código 80 continua sendo Profissional de
-- R$70, sem nenhuma alteração de cobrança.
insert into public.platform_plans (
  plan_key, label, price_cents, tier, featured, legacy_plan_code, entitlement_version,
  max_products, max_images_per_product, max_stores, max_team_members, coupons,
  priority_support, setup_assistance, store_review, implementation_support
) values
  ('essential',    'Essencial',    3000, 1, false, 30, 1,   75,  1, 1,  1, false, false, false, false, false),
  ('growth',       'Crescimento',  5000, 2, true,  50, 1,  350,  5, 1,  3, true,  true,  true,  true,  false),
  ('professional', 'Profissional', 7000, 3, false, 80, 1, 1000, 10, 3, 10, true,  true,  true,  true,  true);

alter table public.platform_plans enable row level security;

-- Catálogo é informação pública (a landing mostra preços e limites).
-- Leitura liberada; escrita não tem policy nenhuma — deny-by-default,
-- só migration altera o catálogo.
create policy platform_plans_select_all on public.platform_plans
  for select to anon, authenticated using (true);

grant select on public.platform_plans to anon, authenticated;

-- ============================================================
-- 2. Mapeamento legado -> plan_key, verificável no banco
-- ============================================================

create or replace function public.plan_key_from_legacy_code(p_plan_code integer)
returns text
language sql
stable
set search_path = ''
as $fn$
  select plan_key from public.platform_plans where legacy_plan_code = p_plan_code;
$fn$;

comment on function public.plan_key_from_legacy_code(integer) is
  'Traduz o plan_code legado (30/50/80) para plan_key. NULL para código desconhecido — quem chama trata como invalid_plan. Existe só durante a transição expand/contract.';

revoke all on function public.plan_key_from_legacy_code(integer) from public;
grant execute on function public.plan_key_from_legacy_code(integer) to authenticated, service_role;

-- Preço por plan_key. A função antiga platform_plan_price_cents(integer)
-- continua existindo e correta (billing_charge_upsert_creating depende
-- dela), mas agora delega para o catálogo em vez de repetir um CASE
-- hard-coded — passa a existir um único lugar onde preço muda.
create or replace function public.platform_plan_price_cents(p_plan_key text)
returns integer
language sql
stable
set search_path = ''
as $fn$
  select price_cents from public.platform_plans where plan_key = p_plan_key;
$fn$;

create or replace function public.platform_plan_price_cents(p_plan_code integer)
returns integer
language sql
stable
set search_path = ''
as $fn$
  select price_cents from public.platform_plans where legacy_plan_code = p_plan_code;
$fn$;

comment on function public.platform_plan_price_cents(text) is
  'Preço comercial atual em centavos por plan_key, lido do catálogo. NULL para plano desconhecido; quem chama trata como invalid_plan. Toda cobrança deriva o valor daqui no servidor — o navegador NUNCA envia amount_cents.';

comment on function public.platform_plan_price_cents(integer) is
  'Overload legada por plan_code (30/50/80), mantida para billing_charge_upsert_creating durante a transição. Agora lê o catálogo (platform_plans) em vez de um CASE hard-coded, então preço tem um único ponto de mudança. Remover junto com plan_code na fase contract.';

revoke all on function public.platform_plan_price_cents(text) from public;
grant execute on function public.platform_plan_price_cents(text) to authenticated, service_role;
grant execute on function public.platform_plan_price_cents(integer) to authenticated, service_role;

-- ============================================================
-- 3. workspaces — a conta de cobrança do comerciante
-- ============================================================
--
-- É AQUI que o plano passa a viver. Uma assinatura governa as lojas e
-- os assentos de equipe permitidos. Hoje o backfill é 1:1 (ver seção 5)
-- então nenhuma cobrança muda; o que muda é a semântica, que passa a
-- comportar "até 3 lojas no Profissional".

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  name text not null,
  plan_key text not null references public.platform_plans (plan_key),
  -- Snapshot da versão de entitlements sob a qual este workspace opera.
  entitlement_version integer not null default 1 check (entitlement_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspaces is
  'Conta de cobrança do comerciante (seção 8 do TASK-012). Dona do plano, das lojas e dos assentos de equipe. Substitui a semântica "plano por loja" de store_plans sem removê-la ainda — store_plans continua sincronizada durante a transição para não quebrar 0008/0010/0011.';

comment on column public.workspaces.owner_user_id is
  'Dono da conta. ON DELETE RESTRICT de propósito: apagar um usuário que ainda tem workspace/loja/histórico financeiro deve falhar alto, nunca cascatear silenciosamente sobre pedidos e cobranças.';

create index workspaces_owner_idx on public.workspaces (owner_user_id);

-- Cada loja pertence a exatamente um workspace.
alter table public.stores add column workspace_id uuid references public.workspaces (id) on delete restrict;

comment on column public.stores.workspace_id is
  'Workspace dono da loja. É por este vínculo que maxStores é contado. NOT NULL é aplicado no fim desta migration, depois do backfill.';

create index stores_workspace_idx on public.stores (workspace_id);

-- ============================================================
-- 4. plan_key ao lado de plan_code (fase expand)
-- ============================================================

alter table public.store_plans add column plan_key text references public.platform_plans (plan_key);
alter table public.onboarding_progress add column plan_key text references public.platform_plans (plan_key);
alter table public.billing_charges add column plan_key text references public.platform_plans (plan_key);

comment on column public.store_plans.plan_key is
  'Identidade do plano, independente de preço. Espelha workspaces.plan_key durante a transição — a autoridade é o workspace. plan_code permanece preenchido e correto até a fase contract.';

comment on column public.billing_charges.plan_key is
  'Snapshot da identidade do plano cobrado. Assim como amount_cents, é histórico: uma mudança futura de preço ou de catálogo NUNCA reescreve uma cobrança já emitida.';

-- ============================================================
-- 5. Backfill
-- ============================================================
--
-- Um workspace por loja existente, com o dono vindo de store_members
-- (role='owner') e o plano traduzido de store_plans.plan_code. O
-- backfill é 1:1 porque hoje é impossível um comerciante ter uma 2ª
-- loja: lib/onboarding/service.ts barra com already_has_store e não
-- existe fluxo self-service de nova loja (docs/PLANS-SPEC.md seção 7).
-- Portanto NINGUÉM passa a pagar mais nem menos por causa disto.
--
-- Loja sem owner em store_members seria dado corrompido; o insert
-- simplesmente não a cobre e o NOT NULL no fim desta migration falha
-- alto em vez de inventar um dono.

do $backfill$
declare
  r record;
  v_workspace_id uuid;
begin
  for r in
    select
      s.id as store_id,
      s.name as store_name,
      sm.user_id as owner_user_id,
      coalesce(public.plan_key_from_legacy_code(sp.plan_code), 'essential') as plan_key
    from public.stores s
    join public.store_members sm on sm.store_id = s.id and sm.role = 'owner'
    left join public.store_plans sp on sp.store_id = s.id
    order by s.created_at
  loop
    insert into public.workspaces (owner_user_id, name, plan_key, entitlement_version)
      values (r.owner_user_id, r.store_name, r.plan_key, 1)
      returning id into v_workspace_id;

    update public.stores set workspace_id = v_workspace_id where id = r.store_id;
  end loop;
end;
$backfill$;

-- plan_key derivado do plan_code já existente, nas três tabelas.
update public.store_plans
  set plan_key = public.plan_key_from_legacy_code(plan_code)
  where plan_key is null;

update public.onboarding_progress
  set plan_key = public.plan_key_from_legacy_code(plan_code)
  where plan_key is null and plan_code is not null;

update public.billing_charges
  set plan_key = public.plan_key_from_legacy_code(plan_code)
  where plan_key is null;

-- ============================================================
-- 6. Constraints pós-backfill
-- ============================================================
--
-- Só agora, com os dados preenchidos. Se alguma linha tiver escapado do
-- backfill a migration ABORTA aqui — é exatamente o que se quer: falhar
-- na migration, nunca em produção com dado incoerente.

alter table public.stores alter column workspace_id set not null;
alter table public.store_plans alter column plan_key set not null;
alter table public.billing_charges alter column plan_key set not null;

-- Coerência entre o par legado e o novo enquanto os dois coexistirem.
-- Impede que um writer esquecido atualize um e deixe o outro para trás.
alter table public.store_plans add constraint store_plans_plan_key_matches_code
  check (plan_key = case plan_code when 30 then 'essential' when 50 then 'growth' when 80 then 'professional' end);

alter table public.billing_charges add constraint billing_charges_plan_key_matches_code
  check (plan_key = case plan_code when 30 then 'essential' when 50 then 'growth' when 80 then 'professional' end);

alter table public.onboarding_progress add constraint onboarding_progress_plan_key_matches_code
  check (
    (plan_code is null and plan_key is null)
    or plan_key = case plan_code when 30 then 'essential' when 50 then 'growth' when 80 then 'professional' end
  );

-- ============================================================
-- 7. RLS de workspaces — deny-by-default
-- ============================================================

alter table public.workspaces enable row level security;

-- Leitura: o próprio dono, ou quem é membro de alguma loja do
-- workspace. Escrita não tem policy nenhuma — criação de workspace e
-- troca de plano passam por funções SECURITY DEFINER dedicadas, nunca
-- por escrita direta do cliente.
create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or exists (
      select 1 from public.stores s
      join public.store_members sm on sm.store_id = s.id
      where s.workspace_id = workspaces.id and sm.user_id = (select auth.uid())
    )
  );

grant select on public.workspaces to authenticated;

-- ============================================================
-- 8. Entitlements efetivos de um workspace
-- ============================================================
--
-- Ponto único de leitura para todo enforcement. Quem precisa saber um
-- limite chama isto — nunca reimplementa a matriz, nunca lê preço para
-- decidir permissão.

create or replace function public.workspace_entitlements(p_workspace_id uuid)
returns public.platform_plans
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.*
  from public.workspaces w
  join public.platform_plans p on p.plan_key = w.plan_key
  where w.id = p_workspace_id;
$fn$;

comment on function public.workspace_entitlements(uuid) is
  'Entitlements efetivos do workspace, derivados SEMPRE da assinatura no servidor. Nenhum enforcement pode aceitar limite, plano ou preço vindo do navegador — tudo deriva daqui.';

revoke all on function public.workspace_entitlements(uuid) from public;
grant execute on function public.workspace_entitlements(uuid) to authenticated, service_role;

-- Workspace de uma loja — atalho usado pelo enforcement de produtos,
-- imagens e cupons, que naturalmente partem de um store_id.
create or replace function public.store_workspace_id(p_store_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select workspace_id from public.stores where id = p_store_id;
$fn$;

revoke all on function public.store_workspace_id(uuid) from public;
grant execute on function public.store_workspace_id(uuid) to authenticated, service_role;
