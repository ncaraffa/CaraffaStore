-- TASK-012 commit 2 — Enforcement real de quota: produtos, imagens e lojas.
--
-- Princípio: o banco é a autoridade. Toda função aqui deriva o limite de
-- store_entitlements() / workspace_entitlements() — ou seja, do caminho
-- loja -> workspace -> assinatura -> plano, sempre no servidor. Nenhum
-- limite, plano, preço ou contagem vindo do navegador participa da
-- decisão. Esconder o botão no frontend é cortesia; quem recusa é isto.

-- ============================================================
-- 0. REGRESSÃO INTRODUZIDA POR 0012/0013 — corrigida primeiro
-- ============================================================
--
-- stores.workspace_id virou NOT NULL, mas onboarding_complete
-- (0002:456) insere em stores sem workspace_id. O backfill de 0012 só
-- cobriu as linhas que JÁ existiam, então o cadastro de qualquer cliente
-- NOVO falharia no banco. Aqui onboarding_complete passa a criar, na
-- mesma transação: workspace -> assinatura -> loja.
--
-- already_has_store NÃO é removido: continua sendo o guard do fluxo de
-- ONBOARDING (só se faz onboarding uma vez). A criação da 2ª/3ª loja é
-- um fluxo separado do painel (workspace_create_store, seção 4), e é lá
-- que o entitlement maxStores é aplicado.

create or replace function public.onboarding_complete()
returns public.stores
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_progress public.onboarding_progress;
  v_store public.stores;
  v_existing_store_id uuid;
  v_workspace_id uuid;
  v_plan_key text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select sm.store_id into v_existing_store_id
  from public.store_members sm
  where sm.user_id = v_uid and sm.role = 'owner'
  limit 1;

  if v_existing_store_id is not null then
    select * into v_store from public.stores where id = v_existing_store_id;
    return v_store;
  end if;

  select * into v_progress
  from public.onboarding_progress
  where user_id = v_uid
  for update;

  if not found then
    raise exception 'onboarding_not_started' using errcode = '42883';
  end if;

  if v_progress.merchant_name is null
     or v_progress.whatsapp is null
     or v_progress.store_name is null
     or v_progress.slug is null
     or v_progress.plan_code is null then
    raise exception 'onboarding_incomplete' using errcode = '42883';
  end if;

  -- plan_key é a identidade; plan_code sobrevive só como espelho legado.
  v_plan_key := coalesce(v_progress.plan_key, public.plan_key_from_legacy_code(v_progress.plan_code));
  if v_plan_key is null then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  insert into public.workspaces (owner_user_id, name)
  values (v_uid, v_progress.store_name)
  returning id into v_workspace_id;

  -- Assinatura nasce pending_payment: escolher plano NUNCA concede
  -- entitlement, só o pagamento aprovado concede (mesmo princípio
  -- "dinheiro primeiro, plano depois" da TASK-011/0013).
  insert into public.workspace_subscriptions (workspace_id, plan_key, status, entitlement_version)
  values (v_workspace_id, v_plan_key, 'pending_payment', 1);

  begin
    insert into public.stores (slug, name, whatsapp, status, workspace_id)
    values (v_progress.slug, v_progress.store_name, v_progress.whatsapp, 'pending_payment', v_workspace_id)
    returning * into v_store;
  exception
    when unique_violation then
      raise exception 'slug_taken' using errcode = '23505';
  end;

  insert into public.store_members (store_id, user_id, role)
  values (v_store.id, v_uid, 'owner');

  insert into public.store_plans (store_id, plan_code, plan_key)
  values (v_store.id, v_progress.plan_code, v_plan_key);

  insert into public.merchant_profiles (user_id, display_name)
  values (v_uid, v_progress.merchant_name)
  on conflict (user_id) do update
    set display_name = excluded.display_name, updated_at = now();

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values
    (v_uid, v_store.id, 'store_created', 'store', v_store.id::text, jsonb_build_object('slug', v_store.slug, 'workspace_id', v_workspace_id)),
    (v_uid, v_store.id, 'owner_assigned', 'store_members', v_store.id::text, '{}'::jsonb),
    (v_uid, v_store.id, 'plan_selected', 'store_plans', v_store.id::text, jsonb_build_object('plan_key', v_plan_key)),
    (v_uid, v_store.id, 'onboarding_completed', 'onboarding_progress', v_uid::text, '{}'::jsonb);

  update public.onboarding_progress
  set step = 'completed', completed_at = now(), updated_at = now()
  where user_id = v_uid;

  return v_store;
end;
$fn$;

comment on function public.onboarding_complete() is
  'Fecha o onboarding criando, na MESMA transação: workspace -> assinatura (pending_payment) -> loja -> vínculo de owner. TASK-012: antes desta versão a loja nascia sem workspace_id, que passou a ser NOT NULL — cadastro novo quebrava. Idempotente: quem já é owner de alguma loja recebe a loja existente de volta. already_has_store segue barrando um SEGUNDO onboarding; criar 2ª/3ª loja é workspace_create_store, onde maxStores é aplicado.';

-- ============================================================
-- 1. Contagem de produtos que ocupa quota
-- ============================================================
--
-- REGRA (fechando os loopholes da seção 9 do TASK):
--
--   draft      CONTA. Senão bastaria criar 5.000 rascunhos e publicar 75.
--   published  CONTA.
--   archived   NÃO conta — mas sair de archived é reavaliado (seção 2),
--              então "arquivar 900, criar mais 900, reativar depois"
--              esbarra no limite na hora de reativar, não silenciosamente.
--   deletado   deixa de contar (a linha não existe mais).
--
-- ESCOPO: por LOJA. Um workspace Profissional com 3 lojas tem 1.000
-- produtos POR LOJA, não 1.000 divididos entre elas — leitura natural de
-- "até 1.000 produtos" num plano que também anuncia "até 3 lojas".

create or replace function public.store_product_quota_count(p_store_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::integer
  from public.products
  where store_id = p_store_id and status in ('draft', 'published');
$fn$;

comment on function public.store_product_quota_count(uuid) is
  'Produtos que ocupam quota na loja: draft + published. archived fica de fora porque tem semântica real de "fora da operação" — e por isso mesmo REATIVAR um arquivado é tratado como ocupar uma vaga (catalog_set_product_status). Sem essa simetria, arquivar/reativar seria um bypass de quota.';

revoke all on function public.store_product_quota_count(uuid) from public;
grant execute on function public.store_product_quota_count(uuid) to authenticated, service_role;

-- Uso + limite numa leitura só — alimenta os indicadores do painel e as
-- mensagens de upgrade sem que o frontend precise saber contar.
create or replace function public.store_quota_usage(p_store_id uuid)
returns table (
  plan_key text,
  products_used integer,
  products_limit integer,
  images_per_product_limit integer,
  stores_used integer,
  stores_limit integer,
  team_used integer,
  team_limit integer,
  coupons_enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_workspace_id uuid;
begin
  if not public.is_store_member(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select workspace_id into v_workspace_id from public.stores where id = p_store_id;

  return query
    select
      e.plan_key,
      public.store_product_quota_count(p_store_id),
      e.max_products,
      e.max_images_per_product,
      (select count(*)::integer from public.stores s where s.workspace_id = v_workspace_id),
      e.max_stores,
      (select count(distinct sm.user_id)::integer
         from public.store_members sm
         join public.stores s on s.id = sm.store_id
         where s.workspace_id = v_workspace_id),
      e.max_team_members,
      e.coupons
    from public.workspace_entitlements(v_workspace_id) e;
end;
$fn$;

comment on function public.store_quota_usage(uuid) is
  'Uso atual vs. limite do plano, para os indicadores do painel (Produtos 42/75) e para as mensagens de upgrade. Leitura autorizada por is_store_member — um membro nunca enxerga o uso de outro tenant. Nada aqui autoriza escrita: é só exibição.';

revoke all on function public.store_quota_usage(uuid) from public;
grant execute on function public.store_quota_usage(uuid) to authenticated;

-- ============================================================
-- 2. Enforcement de produtos
-- ============================================================

create or replace function public.catalog_create_product(
  p_store_id uuid,
  p_name text,
  p_slug text,
  p_price_cents integer,
  p_stock integer,
  p_category_id uuid default null,
  p_description text default null,
  p_sku text default null
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
  v_sku text := nullif(trim(p_sku), '');
  v_row public.products;
  v_limit integer;
  v_used integer;
begin
  if not public.can_manage_store_catalog(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 200 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 120 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'invalid_price' using errcode = '22023';
  end if;
  if p_stock is null or p_stock < 0 then
    raise exception 'invalid_stock' using errcode = '22023';
  end if;

  -- Trava a LOJA antes de contar: mesmo padrão de
  -- catalog_add_product_image (BUG-CLAUDE-003-003). Sem o lock, duas
  -- criações concorrentes na vaga 75/75 leriam count=74 as duas e as
  -- duas passariam — TOCTOU clássico.
  perform 1 from public.stores where id = p_store_id for update;

  select max_products into v_limit from public.store_entitlements(p_store_id);
  if v_limit is null then
    raise exception 'subscription_not_found' using errcode = '02000';
  end if;

  v_used := public.store_product_quota_count(p_store_id);
  if v_used >= v_limit then
    raise exception 'max_products_reached' using errcode = '23514';
  end if;

  begin
    insert into public.products (store_id, category_id, name, slug, description, price_cents, sku, stock, status)
    values (p_store_id, p_category_id, v_name, v_slug, nullif(trim(p_description), ''), p_price_cents, v_sku, p_stock, 'draft')
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'slug_or_sku_taken' using errcode = '23505';
  end;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_store_id, 'product_created', 'product', v_row.id::text, jsonb_build_object('name', v_name));

  return v_row;
end;
$fn$;

comment on function public.catalog_create_product(uuid, text, text, integer, integer, uuid, text, text) is
  'TASK-012: aplica maxProducts do plano da ASSINATURA (store_entitlements), travando a loja antes de contar para que duas criações concorrentes na última vaga não passem as duas. O produto nasce draft e draft JÁ ocupa quota — criar rascunho infinito e publicar só o permitido não é um bypass.';

-- Transição de status: sair de `archived` volta a ocupar vaga e por isso
-- é reavaliada. É o que impede "arquivo 900, crio mais 900, reativo tudo".
create or replace function public.catalog_set_product_status(
  p_product_id uuid,
  p_status text
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store_id uuid;
  v_current_status text;
  v_row public.products;
  v_action public.audit_log.action%type;
  v_limit integer;
  v_used integer;
begin
  if p_status not in ('draft', 'published', 'archived') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select store_id, status into v_store_id, v_current_status
    from public.products where id = p_product_id;
  if v_store_id is null then
    raise exception 'product_not_found' using errcode = '23503';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- Só a transição archived -> (draft|published) consome uma vaga nova.
  -- draft <-> published não mexe na contagem (ambos já contam), e
  -- qualquer coisa -> archived só libera vaga.
  if v_current_status = 'archived' and p_status in ('draft', 'published') then
    perform 1 from public.stores where id = v_store_id for update;

    select max_products into v_limit from public.store_entitlements(v_store_id);
    if v_limit is null then
      raise exception 'subscription_not_found' using errcode = '02000';
    end if;

    v_used := public.store_product_quota_count(v_store_id);
    if v_used >= v_limit then
      raise exception 'max_products_reached' using errcode = '23514';
    end if;
  end if;

  update public.products
  set status = p_status,
      updated_at = now()
  where id = p_product_id
  returning * into v_row;

  v_action := case p_status
    when 'published' then 'product_published'
    when 'archived' then 'product_archived'
    else 'product_unpublished'
  end;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, v_action, 'product', p_product_id::text, '{}'::jsonb);

  return v_row;
end;
$fn$;

comment on function public.catalog_set_product_status(uuid, text) is
  'Único caminho de alteração de products.status. TASK-012: DESARQUIVAR (archived -> draft/published) é tratado como ocupar uma vaga e revalida maxProducts com a loja travada — sem isso, arquivar em massa e reativar depois seria um bypass silencioso de quota. Arquivar sempre pode (só libera vaga).';

-- ============================================================
-- 3. Enforcement de imagens — limite derivado do plano
-- ============================================================
--
-- Generaliza o mecanismo que já existia (trigger + `for update` na linha
-- do produto, BUG-CLAUDE-003-003) em vez de substituí-lo por algo mais
-- fraco: o lock continua idêntico, só o número 5 hard-coded vira
-- store_entitlements(...).max_images_per_product.

create or replace function public.check_product_image_constraints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_product_store uuid;
  v_count integer;
  v_limit integer;
begin
  select store_id into v_product_store from public.products where id = new.product_id;
  if v_product_store is null then
    raise exception 'product_not_found' using errcode = '23503';
  end if;
  if v_product_store <> new.store_id then
    raise exception 'store_mismatch' using errcode = '23514';
  end if;

  select max_images_per_product into v_limit from public.store_entitlements(v_product_store);
  if v_limit is null then
    raise exception 'subscription_not_found' using errcode = '02000';
  end if;

  select count(*) into v_count from public.product_images where product_id = new.product_id;
  if v_count >= v_limit then
    raise exception 'max_images_reached' using errcode = '23514';
  end if;

  return new;
end;
$fn$;

comment on function public.check_product_image_constraints() is
  'Defesa em profundidade do limite de imagens: garante store_id coerente e recusa a imagem excedente mesmo que alguma função futura esqueça de checar. TASK-012: o limite deixou de ser 5 fixo e passa a vir do plano da assinatura (store_entitlements), continuando a valer para QUALQUER caminho de insert.';

create or replace function public.catalog_add_product_image(
  p_product_id uuid,
  p_storage_path text,
  p_is_cover boolean default false
)
returns public.product_images
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_store_id uuid;
  v_next_position integer;
  v_existing_count integer;
  v_make_cover boolean;
  v_row public.product_images;
  v_limit integer;
begin
  -- Lock preservado de 0005 (BUG-CLAUDE-003-003): trava a linha do
  -- PRODUTO, serializando dois uploads concorrentes para o mesmo
  -- produto. Quando o segundo finalmente conta, já enxerga o INSERT do
  -- primeiro — é isto que faz a última vaga ser de um só.
  select store_id into v_store_id from public.products where id = p_product_id for update;
  if v_store_id is null then
    raise exception 'product_not_found' using errcode = '23503';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || v_store_id::text || '/' || p_product_id::text || '/') then
    raise exception 'invalid_storage_path' using errcode = '22023';
  end if;

  select max_images_per_product into v_limit from public.store_entitlements(v_store_id);
  if v_limit is null then
    raise exception 'subscription_not_found' using errcode = '02000';
  end if;

  select count(*), coalesce(max(position) + 1, 0)
    into v_existing_count, v_next_position
    from public.product_images where product_id = p_product_id;

  if v_existing_count >= v_limit then
    raise exception 'max_images_reached' using errcode = '23514';
  end if;

  v_make_cover := p_is_cover or v_existing_count = 0;
  if v_make_cover then
    update public.product_images set is_cover = false where product_id = p_product_id and is_cover;
  end if;

  insert into public.product_images (store_id, product_id, storage_path, position, is_cover)
  values (v_store_id, p_product_id, p_storage_path, v_next_position, v_make_cover)
  returning * into v_row;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, 'product_image_added', 'product', p_product_id::text, jsonb_build_object('image_id', v_row.id));

  return v_row;
end;
$fn$;

comment on function public.catalog_add_product_image(uuid, text, boolean) is
  'Registra o metadado da imagem DEPOIS do upload. TASK-012: o limite vem do plano da assinatura, não mais de 5 fixo. O lock na linha do produto (preservado de 0005) é o que garante que, restando UMA vaga, dois uploads simultâneos não passem os dois.';

-- Checagem ANTES do upload — evita subir arquivo que a linha vai
-- recusar. Não substitui a checagem autoritativa acima (entre esta
-- consulta e o insert a vaga pode ter sido tomada): é só para o cliente
-- não gastar banda nem deixar arquivo órfão no caso comum.
create or replace function public.catalog_can_add_product_image(p_product_id uuid)
returns table (allowed boolean, used integer, image_limit integer)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_store_id uuid;
  v_limit integer;
  v_used integer;
begin
  select store_id into v_store_id from public.products where id = p_product_id;
  if v_store_id is null then
    raise exception 'product_not_found' using errcode = '23503';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select max_images_per_product into v_limit from public.store_entitlements(v_store_id);
  select count(*)::integer into v_used from public.product_images where product_id = p_product_id;

  return query select (v_used < v_limit), v_used, v_limit;
end;
$fn$;

comment on function public.catalog_can_add_product_image(uuid) is
  'Pré-checagem consultiva usada ANTES de subir o arquivo, para não criar objeto órfão no Storage quando a vaga já acabou. NÃO é a barreira: a decisão real continua em catalog_add_product_image, sob lock. Uma corrida perdida entre as duas ainda é recusada lá — e nesse caso o cliente remove o objeto recém-enviado.';

revoke all on function public.catalog_can_add_product_image(uuid) from public;
grant execute on function public.catalog_can_add_product_image(uuid) to authenticated;

-- ============================================================
-- 4. Enforcement de lojas — criar a 2ª/3ª loja pelo painel
-- ============================================================

create or replace function public.workspace_create_store(
  p_name text,
  p_slug text,
  p_whatsapp text default null
)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_workspace public.workspaces;
  v_subscription public.workspace_subscriptions;
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
  v_limit integer;
  v_used integer;
  v_store public.stores;
  v_status text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 120 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  -- Só o DONO do workspace cria loja. O workspace é derivado de
  -- auth.uid(), NUNCA recebido por parâmetro — é o que impede pedir a
  -- criação de uma loja dentro do workspace de outro comerciante.
  select * into v_workspace from public.workspaces
    where owner_user_id = v_uid
    for update;
  if v_workspace.id is null then
    raise exception 'workspace_not_found' using errcode = '02000';
  end if;

  select * into v_subscription from public.workspace_subscriptions
    where workspace_id = v_workspace.id;
  if v_subscription.id is null then
    raise exception 'subscription_not_found' using errcode = '02000';
  end if;

  select max_stores into v_limit from public.workspace_entitlements(v_workspace.id);
  select count(*)::integer into v_used from public.stores where workspace_id = v_workspace.id;

  if v_used >= v_limit then
    raise exception 'max_stores_reached' using errcode = '23514';
  end if;

  -- A loja nova entra no mesmo estado comercial da assinatura: se ela já
  -- está paga, a loja nasce ativa (a mensalidade já cobre); se não,
  -- nasce pending_payment junto com as irmãs. Em nenhum caso é aberta
  -- uma segunda cobrança — o índice único por workspace garante isso.
  v_status := case when v_subscription.status = 'active' then 'active' else 'pending_payment' end;

  begin
    insert into public.stores (slug, name, whatsapp, status, workspace_id)
    values (v_slug, v_name, nullif(trim(p_whatsapp), ''), v_status, v_workspace.id)
    returning * into v_store;
  exception
    when unique_violation then
      raise exception 'slug_taken' using errcode = '23505';
  end;

  insert into public.store_members (store_id, user_id, role)
  values (v_store.id, v_uid, 'owner');

  -- Espelho legado coerente para as telas de admin.
  perform public.workspace_sync_store_plans(v_workspace.id);

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values
    (v_uid, v_store.id, 'store_created', 'store', v_store.id::text,
      jsonb_build_object('slug', v_store.slug, 'workspace_id', v_workspace.id, 'via', 'workspace_create_store')),
    (v_uid, v_store.id, 'owner_assigned', 'store_members', v_store.id::text, '{}'::jsonb);

  return v_store;
end;
$fn$;

comment on function public.workspace_create_store(text, text, text) is
  'Cria a 2ª/3ª loja do comerciante pelo painel, sem refazer o onboarding da conta. Aplica maxStores do plano da assinatura com o workspace travado (for update) — duas criações concorrentes na última vaga não passam as duas. O workspace vem de auth.uid(), nunca de parâmetro: não há como criar loja no workspace alheio. Não abre cobrança nova: a mesma assinatura passa a cobrir a loja.';

revoke all on function public.workspace_create_store(text, text, text) from public;
grant execute on function public.workspace_create_store(text, text, text) to authenticated;
