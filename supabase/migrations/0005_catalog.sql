-- TASK-003 — Catálogo, produtos, categorias e estoque.
--
-- Decisões aprovadas por Caraffa (2026-08-04, sem necessidade de nova
-- aprovação):
--   1. Sem variantes nesta tarefa — um produto tem um único preço e um
--      único estoque. O desenho abaixo não impede variantes no futuro
--      (produtos continuam sendo a unidade endereçável), mas não tenta
--      antecipar esse modelo agora.
--   2. Até 5 imagens por produto via Supabase Storage, com capa e ordem
--      explícitas, isoladas por loja/produto no caminho do arquivo.
--   3. Estoque nunca negativo, ajuste atômico no banco (nunca
--      select-calcula-update no JS), histórico via audit_log.
--
-- `public.products` já existe desde a TASK-001 (0001_init.sql) como
-- "recurso mínimo para provar isolamento entre tenants" — RLS/GRANTs já
-- corretos (leitura para qualquer membro, escrita para owner/admin).
-- Esta migração ESTENDE essa mesma tabela em vez de recriar: todas as
-- colunas novas são opcionais/tem default, então o INSERT mínimo
-- (store_id, name, stock) usado por scripts/seed-local.ts e por
-- supabase/tests/isolation_check.sql continua funcionando sem alteração
-- — a TASK-001 RLS (7/7) não é afetada por esta migração.
--
-- Todas as escritas de catálogo (criar/editar/publicar/despublicar/
-- arquivar categoria e produto, ajustar estoque, gerenciar imagens)
-- passam por funções SECURITY DEFINER dedicadas (mesmo padrão das
-- funções onboarding_* da TASK-002) — cada uma faz sua própria
-- verificação via can_manage_store_catalog(store_id) usando auth.uid()
-- (owner/admin da loja E loja status=active — ver seção 0 abaixo),
-- nunca confia em store_id/role vindo do cliente para autorizar, e grava o
-- evento de auditoria correspondente na MESMA transação da escrita.
-- Isso evita a classe de bug do BUG-CLAUDE-VERIF3-001 (TASK-002):
-- nenhum evento de auditoria pode ser fabricado por um cliente nem
-- ficar dessincronizado do estado real.

-- ============================================================
-- 0. can_manage_store_catalog — autorização operacional do catálogo
-- ============================================================
-- BUG-CLAUDE-003-001 (qa/reports/TASK-003-CLAUDE-VERIFICATION.md):
-- is_store_admin (0001_init.sql) checa só vínculo de papel
-- (owner/admin), nunca o estado da loja. Os guards de página/Server
-- Action (requireStoreStatus, TASK-002) exigem loja `active`, mas
-- nenhuma função catalog_* nem policy de storage.objects replicava
-- essa exigência no banco — uma chamada direta à RPC/Storage (sem
-- passar pela página) bypassava o guard por completo, permitindo que
-- lojas pending_payment/suspended administrassem o catálogo.
--
-- can_manage_store_catalog() é a autorização operacional específica do
-- catálogo: owner/admin (mesma regra de is_store_admin) E loja
-- status = 'active'. Não altera is_store_admin em si (usada também no
-- onboarding e em outros fluxos que não devem exigir loja já ativa) —
-- só centraliza a regra "escrita de catálogo exige loja active" num
-- único lugar, usado por TODAS as 11 funções catalog_* e pelas 2
-- policies de escrita de storage.objects abaixo.
create or replace function public.can_manage_store_catalog(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.store_members sm
    join public.stores s on s.id = sm.store_id
    where sm.store_id = target_store_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
      and s.status = 'active'
  );
$$;

comment on function public.can_manage_store_catalog(uuid) is
  'Autorização operacional do catálogo: owner/admin da loja E loja status=active. Diferente de is_store_admin (0001_init.sql), que não checa estado da loja e continua usada por onboarding/outros fluxos que não exigem loja já ativa. Usada por todas as funções catalog_* e pelas policies de escrita de storage.objects — fecha BUG-CLAUDE-003-001.';

revoke all on function public.can_manage_store_catalog(uuid) from public;
grant execute on function public.can_manage_store_catalog(uuid) to authenticated;

-- ============================================================
-- 1. categories
-- ============================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint categories_store_slug_unique unique (store_id, slug)
);

comment on table public.categories is
  'Categorias de produtos, isoladas por loja (slug único por loja, não globalmente — duas lojas podem usar o mesmo slug). Sem policy de DELETE nem GRANT de delete para authenticated: uma categoria nunca é excluída fisicamente, só desativada (is_active=false, evento category_archived) — evita órfãos em produtos ainda vinculados. Toda escrita passa pelas funções catalog_create_category/catalog_update_category/catalog_set_category_active.';

create index categories_store_id_idx on public.categories (store_id);

alter table public.categories enable row level security;

create policy categories_select_member
  on public.categories
  for select
  to authenticated
  using (public.is_store_member(store_id));

-- Catálogo público: só categorias ativas de lojas ativas. Decisão
-- explícita desta tarefa (TASK-001, 0001_init.sql, já previa que uma
-- futura loja pública exigiria essa aprovação separada — é esta).
-- `to public` (não só `to anon`): um usuário AUTENTICADO mas sem
-- vínculo com ESTA loja específica (ex.: dono da Loja A navegando o
-- catálogo público da Loja B) precisa enxergar o catálogo público dela
-- do mesmo jeito que um visitante anônimo — uma policy só `to anon`
-- deixaria a rota pública "quebrada" (0 resultados) para qualquer
-- visitante logado que não seja membro daquela loja específica.
create policy categories_select_public
  on public.categories
  for select
  to public
  using (
    is_active
    and exists (select 1 from public.stores s where s.id = store_id and s.status = 'active')
  );

revoke all on public.categories from public, anon, authenticated, service_role;
grant select on public.categories to anon;
grant select on public.categories to authenticated;
grant select, insert, update, delete on public.categories to service_role;

-- ============================================================
-- 2. products — extensão da tabela da TASK-001 (0001_init.sql)
-- ============================================================

alter table public.products
  add column category_id uuid references public.categories (id) on delete restrict,
  add column slug text,
  add column description text,
  add column price_cents integer not null default 0 check (price_cents >= 0),
  add column sku text,
  add column status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  add column updated_at timestamptz not null default now();

comment on column public.products.category_id is
  'ON DELETE RESTRICT — nunca herda um comportamento de exclusão em cascata de categoria; categorias não são excluídas fisicamente de qualquer forma (ver comment de public.categories). Verificado por trigger (products_category_store_check) que a categoria pertence à MESMA store_id do produto, mesmo que o valor venha de uma função SECURITY DEFINER — defesa em profundidade contra bug futuro, não só contra cliente malicioso.';

comment on column public.products.slug is
  'NULLABLE de propósito: as linhas de fixture/teste da TASK-001 (scripts/seed-local.ts, supabase/tests/isolation_check.sql) inserem só (store_id, name, stock) e continuam válidas. UNIQUE(store_id, slug) — NULLs não colidem entre si (semântica padrão SQL), então múltiplas linhas antigas sem slug não violam a constraint. Todo produto criado pelo catálogo real (catalog_create_product) sempre grava um slug válido — a ausência de NOT NULL aqui é compatibilidade histórica, não uma lacuna do fluxo novo.';

comment on column public.products.status is
  'draft nunca aparece publicamente; published aparece (mesmo com stock=0, mostrado como "Esgotado"); archived nunca aparece publicamente. Só muda via catalog_publish_product/catalog_unpublish_product/catalog_archive_product — nunca escrito diretamente por um UPDATE genérico de catálogo.';

alter table public.products
  add constraint products_slug_format check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint products_store_slug_unique unique (store_id, slug),
  add constraint products_store_sku_unique unique (store_id, sku);

create index products_store_status_idx on public.products (store_id, status);
create index products_category_id_idx on public.products (category_id);

-- Garante que category_id (quando presente) pertence à MESMA loja do
-- produto — nunca confia em nenhum chamador (nem cliente, nem função
-- SECURITY DEFINER) para essa invariante; validado sempre no banco.
create or replace function public.check_product_category_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat_store uuid;
begin
  if new.category_id is not null then
    select store_id into v_cat_store from public.categories where id = new.category_id;
    if v_cat_store is null or v_cat_store <> new.store_id then
      raise exception 'category_store_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.check_product_category_store() from public;

create trigger products_category_store_check
  before insert or update of category_id, store_id on public.products
  for each row
  execute function public.check_product_category_store();

comment on trigger products_category_store_check on public.products is
  'BUG defensivo prevenido: category_id de outra loja anexado a um produto (fecha o requisito "category_id precisa pertencer à mesma store_id do produto" mesmo que uma função futura esqueça de checar isso em TypeScript).';

-- Público: só produtos published de lojas ativas. Nunca expõe draft/
-- archived nem colunas administrativas — RLS filtra por LINHA, e o
-- código do catálogo público sempre seleciona uma lista explícita de
-- colunas (nunca "select *"), então nenhum dado sensível adicional
-- vaza mesmo que a policy libere a linha inteira. `to public` pelo
-- mesmo motivo de categories_select_public acima.
create policy products_select_public
  on public.products
  for select
  to public
  using (
    status = 'published'
    and exists (select 1 from public.stores s where s.id = store_id and s.status = 'active')
  );

grant select on public.products to anon;

-- BUG-CLAUDE-003-002 (qa/reports/TASK-003-CLAUDE-VERIFICATION.md):
-- 0001_init.sql concedeu select/insert/update/delete em products a
-- authenticated (correto para a TASK-001, quando a tabela só tinha
-- store_id/name/stock e a única forma de escrita era esse próprio
-- GRANT). A TASK-003 estendeu products com colunas sensíveis
-- (status/price_cents/stock/category_id/slug/sku) e introduziu as
-- funções catalog_* como o caminho oficial de escrita, mas nunca
-- revisou o GRANT nem as 3 policies de escrita antigas
-- (products_insert_admin/update_admin/delete_admin, que também só
-- checavam is_store_admin, sem exigir loja active) — um authenticated
-- conseguia fazer INSERT/UPDATE/DELETE cru na tabela, contornando toda
-- validação/auditoria/checagem de estado das RPCs.
--
-- Fecha revogando o GRANT de escrita direta de authenticated (mantendo
-- SELECT, coberto pelas policies de leitura acima/existentes) e
-- derrubando as 3 policies de escrita antigas de 0001_init.sql — a
-- tabela nunca é recriada, então DROP POLICY aqui é a forma correta de
-- neutralizá-las sem tocar na migration já mesclada da TASK-001. Toda
-- mutação administrativa de products passa a ser possível SOMENTE via
-- catalog_create_product/catalog_update_product/
-- catalog_set_product_status/catalog_adjust_stock (SECURITY DEFINER,
-- can_manage_store_catalog). service_role mantém select/insert/update/
-- delete (seed local, uso administrativo) — não afetado por este
-- REVOKE, que é específico do papel authenticated.
revoke insert, update, delete, truncate on public.products from authenticated;

drop policy if exists products_insert_admin on public.products;
drop policy if exists products_update_admin on public.products;
drop policy if exists products_delete_admin on public.products;

comment on table public.products is
  'Estendida pela TASK-003 (0005_catalog.sql) a partir da tabela mínima da TASK-001. Escrita administrativa exclusivamente via catalog_create_product/catalog_update_product/catalog_set_product_status/catalog_adjust_stock — authenticated não tem mais nenhum GRANT de INSERT/UPDATE/DELETE/TRUNCATE direto (revogado nesta migração; as policies de escrita antigas de 0001_init.sql foram derrubadas). Leitura continua via products_select_member (membro da loja) e products_select_public (catálogo público, published/active).';

-- ============================================================
-- 3. stores — leitura pública mínima (catálogo)
-- ============================================================
-- 0001_init.sql previu explicitamente esta decisão como "fora do
-- escopo da TASK-001, requer aprovação separada" — TASK-003 é essa
-- aprovação: só lojas active (nenhuma nova escrita). `to public`
-- (não só `to anon`) pelo mesmo motivo de categories_select_public
-- acima — sem isso, um usuário autenticado sem vínculo com a loja
-- visitada não conseguiria nem resolver o storeSlug da rota pública.

create policy stores_select_public
  on public.stores
  for select
  to public
  using (status = 'active');

grant select on public.stores to anon;

-- ============================================================
-- 4. product_images
-- ============================================================

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null unique,
  position integer not null default 0,
  is_cover boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.product_images is
  'Metadados das imagens do produto (arquivo real vive no bucket Storage "product-images", caminho <store_id>/<product_id>/<uuid>.<ext>). Máximo 5 por produto e no máximo 1 capa por produto, ambos garantidos no banco (trigger + índice único parcial) — nunca só na aplicação. Toda escrita passa por catalog_add_product_image/catalog_remove_product_image/catalog_set_cover_image/catalog_move_product_image.';

create index product_images_product_id_idx on public.product_images (product_id);

-- No máximo uma capa por produto — garantia de banco, não de aplicação.
create unique index product_images_one_cover_per_product
  on public.product_images (product_id)
  where is_cover;

-- Garante que product_id/store_id sejam consistentes e que o limite de
-- 5 imagens por produto seja respeitado mesmo se uma função futura
-- esquecer de checar isso.
create or replace function public.check_product_image_constraints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_store uuid;
  v_count integer;
begin
  select store_id into v_product_store from public.products where id = new.product_id;
  if v_product_store is null then
    raise exception 'product_not_found' using errcode = '23503';
  end if;
  if new.store_id <> v_product_store then
    raise exception 'image_store_mismatch' using errcode = '23514';
  end if;

  select count(*) into v_count from public.product_images where product_id = new.product_id;
  if v_count >= 5 then
    raise exception 'max_images_reached' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.check_product_image_constraints() from public;

create trigger product_images_insert_check
  before insert on public.product_images
  for each row
  execute function public.check_product_image_constraints();

alter table public.product_images enable row level security;

create policy product_images_select_member
  on public.product_images
  for select
  to authenticated
  using (public.is_store_member(store_id));

-- Catálogo público: metadados de imagem só de produtos published em
-- lojas active — os arquivos em si ficam num bucket PÚBLICO (ver seção
-- 6), então a policy aqui só protege os METADADOS (position/is_cover)
-- de produtos draft/archived, não o arquivo (caminho é um UUID
-- aleatório, não listável sem conhecer o metadado). `to public` pelo
-- mesmo motivo de categories_select_public acima.
create policy product_images_select_public
  on public.product_images
  for select
  to public
  using (
    exists (
      select 1 from public.products p
      join public.stores s on s.id = p.store_id
      where p.id = product_id and p.status = 'published' and s.status = 'active'
    )
  );

revoke all on public.product_images from public, anon, authenticated, service_role;
grant select on public.product_images to anon;
grant select on public.product_images to authenticated;
grant select, insert, update, delete on public.product_images to service_role;

-- ============================================================
-- 5. Estoque — ajuste atômico, nunca select-calcula-update no cliente
-- ============================================================

create or replace function public.catalog_adjust_stock(
  p_product_id uuid,
  p_delta integer,
  p_reason text,
  p_reference text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_new_stock integer;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'invalid_delta' using errcode = '22023';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select store_id into v_store_id from public.products where id = p_product_id;
  if v_store_id is null then
    raise exception 'product_not_found' using errcode = '23503';
  end if;

  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- Ajuste atômico: o próprio WHERE é o compare-and-swap
  -- (stock + delta >= 0), avaliado e aplicado numa única operação de
  -- linha pelo Postgres — nunca um SELECT seguido de um UPDATE
  -- separado. Sob concorrência real, cada UPDATE serializa no lock de
  -- linha; a segunda transação sempre vê o stock já atualizado pela
  -- primeira antes de decidir se o próprio ajuste ainda cabe.
  update public.products
  set stock = stock + p_delta,
      updated_at = now()
  where id = p_product_id
    and stock + p_delta >= 0
  returning stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'stock_would_be_negative' using errcode = '23514';
  end if;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (
    auth.uid(), v_store_id, 'product_stock_adjusted', 'product', p_product_id::text,
    jsonb_build_object('delta', p_delta, 'new_stock', v_new_stock, 'reason', trim(p_reason), 'reference', p_reference)
  );

  return v_new_stock;
end;
$$;

comment on function public.catalog_adjust_stock(uuid, integer, text, text) is
  'Único caminho de alteração de products.stock. Atômico via WHERE stock + delta >= 0 na própria UPDATE (nunca SELECT-depois-UPDATE) — concorrência real testada em supabase/tests/stock-concurrency-check.ts. Grava product_stock_adjusted na mesma transação; se a UPDATE não afetar nenhuma linha (estoque insuficiente), a função inteira falha e nada é gravado.';

revoke all on function public.catalog_adjust_stock(uuid, integer, text, text) from public;
grant execute on function public.catalog_adjust_stock(uuid, integer, text, text) to authenticated;

-- ============================================================
-- 6. Storage — bucket de imagens de produto
-- ============================================================
-- Bucket PÚBLICO (leitura direta por URL, sem checar RLS) — decisão
-- deliberada de simplicidade: caminho é <store_id>/<product_id>/<uuid>.
-- <ext>, com 3 segmentos de UUID aleatório (não enumerável/adivinhável)
-- — equivalente em prática a um link "não listado". Isso evita ter que
-- gerar/renovar signed URLs para o catálogo público. A ESCRITA
-- (upload/exclusão) continua protegida por RLS real abaixo, restrita a
-- owner/admin da loja dona do caminho — só a LEITURA do arquivo já
-- publicado é que dispensa autenticação, o que é exatamente o
-- requisito ("imagens de produtos publicados precisam ser
-- visualizáveis no catálogo público").
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Privilégios de tabela padrão da plataforma Supabase em storage.objects
-- incluem TRUNCATE para anon/authenticated (mesma classe de risco
-- documentada em 0001_init.sql para stores/store_members/products:
-- TRUNCATE ignora RLS por completo). Revogado explicitamente — RLS por
-- si só NUNCA impede TRUNCATE.
revoke truncate on storage.objects from anon, authenticated;
revoke truncate on storage.buckets from anon, authenticated;
-- anon nunca precisa de nenhuma operação via papel Postgres sobre
-- storage.objects: a leitura pública passa pelo endpoint de bucket
-- público do serviço de Storage (não usa o papel `anon` do Postgres
-- para servir o arquivo), e não há nenhuma policy de INSERT/UPDATE/
-- DELETE para anon abaixo.
revoke all on storage.objects from anon;

-- Caminho convencionado <store_id>/<product_id>/<arquivo> — o primeiro
-- segmento do path (storage.foldername(name)[1]) é sempre o store_id,
-- checado contra is_store_member/can_manage_store_catalog exatamente
-- como qualquer outra tabela multi-tenant deste projeto. Leitura
-- (SELECT) continua usando is_store_member (sem exigir loja active —
-- um membro de uma loja suspensa ainda pode ver as próprias imagens no
-- painel); ESCRITA (INSERT/DELETE) usa can_manage_store_catalog, que
-- exige loja active — fecha BUG-CLAUDE-003-001 também para o Storage.
create policy product_images_storage_select_member
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'product-images' and public.is_store_member(((storage.foldername(name))[1])::uuid));

create policy product_images_storage_insert_admin
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.can_manage_store_catalog(((storage.foldername(name))[1])::uuid));

create policy product_images_storage_delete_admin
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'product-images' and public.can_manage_store_catalog(((storage.foldername(name))[1])::uuid));

-- ============================================================
-- 7. Funções de catálogo — categorias
-- ============================================================

create or replace function public.catalog_create_category(
  p_store_id uuid,
  p_name text,
  p_slug text,
  p_description text default null,
  p_display_order integer default 0
)
returns public.categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
  v_row public.categories;
begin
  if not public.can_manage_store_catalog(p_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 80 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  begin
    insert into public.categories (store_id, name, slug, description, display_order)
    values (p_store_id, v_name, v_slug, nullif(trim(p_description), ''), coalesce(p_display_order, 0))
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'slug_taken' using errcode = '23505';
  end;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_store_id, 'category_created', 'category', v_row.id::text, jsonb_build_object('name', v_name));

  return v_row;
end;
$$;

create or replace function public.catalog_update_category(
  p_category_id uuid,
  p_name text,
  p_slug text,
  p_description text default null,
  p_display_order integer default 0
)
returns public.categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
  v_row public.categories;
begin
  select store_id into v_store_id from public.categories where id = p_category_id;
  if v_store_id is null then
    raise exception 'category_not_found' using errcode = '02000';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 80 then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  begin
    update public.categories
    set name = v_name,
        slug = v_slug,
        description = nullif(trim(p_description), ''),
        display_order = coalesce(p_display_order, 0),
        updated_at = now()
    where id = p_category_id
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'slug_taken' using errcode = '23505';
  end;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, 'category_updated', 'category', p_category_id::text, '{}'::jsonb);

  return v_row;
end;
$$;

create or replace function public.catalog_set_category_active(
  p_category_id uuid,
  p_is_active boolean
)
returns public.categories
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_row public.categories;
begin
  select store_id into v_store_id from public.categories where id = p_category_id;
  if v_store_id is null then
    raise exception 'category_not_found' using errcode = '02000';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update public.categories
  set is_active = p_is_active,
      updated_at = now()
  where id = p_category_id
  returning * into v_row;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (
    auth.uid(), v_store_id,
    case when p_is_active then 'category_updated' else 'category_archived' end,
    'category', p_category_id::text, '{}'::jsonb
  );

  return v_row;
end;
$$;

revoke all on function public.catalog_create_category(uuid, text, text, text, integer) from public;
revoke all on function public.catalog_update_category(uuid, text, text, text, integer) from public;
revoke all on function public.catalog_set_category_active(uuid, boolean) from public;
grant execute on function public.catalog_create_category(uuid, text, text, text, integer) to authenticated;
grant execute on function public.catalog_update_category(uuid, text, text, text, integer) to authenticated;
grant execute on function public.catalog_set_category_active(uuid, boolean) to authenticated;

-- ============================================================
-- 8. Funções de catálogo — produtos
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
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
  v_sku text := nullif(trim(p_sku), '');
  v_row public.products;
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
$$;

create or replace function public.catalog_update_product(
  p_product_id uuid,
  p_name text,
  p_slug text,
  p_price_cents integer,
  p_category_id uuid default null,
  p_description text default null,
  p_sku text default null
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
  v_sku text := nullif(trim(p_sku), '');
  v_row public.products;
begin
  select store_id into v_store_id from public.products where id = p_product_id;
  if v_store_id is null then
    raise exception 'product_not_found' using errcode = '23503';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
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

  -- Nota: NÃO altera stock nem status — únicos caminhos são
  -- catalog_adjust_stock e catalog_publish_product/
  -- catalog_unpublish_product/catalog_archive_product,
  -- respectivamente. Mantém o evento product_updated verdadeiro: só
  -- descreve mudança de dados de catálogo, nunca de estoque/publicação.
  begin
    update public.products
    set category_id = p_category_id,
        name = v_name,
        slug = v_slug,
        description = nullif(trim(p_description), ''),
        price_cents = p_price_cents,
        sku = v_sku,
        updated_at = now()
    where id = p_product_id
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'slug_or_sku_taken' using errcode = '23505';
  end;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, 'product_updated', 'product', p_product_id::text, '{}'::jsonb);

  return v_row;
end;
$$;

create or replace function public.catalog_set_product_status(
  p_product_id uuid,
  p_status text
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_row public.products;
  v_action public.audit_log.action%type;
begin
  if p_status not in ('draft', 'published', 'archived') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select store_id into v_store_id from public.products where id = p_product_id;
  if v_store_id is null then
    raise exception 'product_not_found' using errcode = '23503';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
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
$$;

comment on function public.catalog_set_product_status(uuid, text) is
  'Único caminho de alteração de products.status — catalog_update_product deliberadamente nunca toca esta coluna. p_status=draft grava product_unpublished (nunca product_updated), preservando a semântica exata dos eventos pedidos.';

revoke all on function public.catalog_create_product(uuid, text, text, integer, integer, uuid, text, text) from public;
revoke all on function public.catalog_update_product(uuid, text, text, integer, uuid, text, text) from public;
revoke all on function public.catalog_set_product_status(uuid, text) from public;
grant execute on function public.catalog_create_product(uuid, text, text, integer, integer, uuid, text, text) to authenticated;
grant execute on function public.catalog_update_product(uuid, text, text, integer, uuid, text, text) to authenticated;
grant execute on function public.catalog_set_product_status(uuid, text) to authenticated;

-- ============================================================
-- 9. Funções de catálogo — imagens
-- ============================================================

create or replace function public.catalog_add_product_image(
  p_product_id uuid,
  p_storage_path text,
  p_is_cover boolean default false
)
returns public.product_images
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_next_position integer;
  v_existing_count integer;
  v_make_cover boolean;
  v_row public.product_images;
begin
  -- BUG-CLAUDE-003-003 (qa/reports/TASK-003-CLAUDE-VERIFICATION.md):
  -- `for update` trava a linha do PRODUTO (não de product_images, que
  -- ainda nem existe a linha a inserir) para toda a duração desta
  -- transação. Duas chamadas concorrentes para o mesmo p_product_id
  -- serializam aqui: a segunda só prossegue depois que a primeira
  -- confirma (ou desfaz) — quando ela finalmente conta as imagens
  -- existentes, já enxerga o INSERT da primeira. Sem isso, o
  -- `select count(*)` abaixo era um clássico TOCTOU (check-then-act):
  -- duas transações liam count=4 antes de qualquer uma commitar seu
  -- INSERT, e as duas passavam do limite de 5 — reproduzido 3/3 vezes
  -- na verificação adversarial.
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

  select count(*), coalesce(max(position) + 1, 0)
    into v_existing_count, v_next_position
    from public.product_images where product_id = p_product_id;

  -- A própria trigger product_images_insert_check rejeita a 6a imagem
  -- (defesa em profundidade); com o lock acima, esta checagem já é, por
  -- si só, segura sob concorrência real.
  if v_existing_count >= 5 then
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
$$;

comment on function public.catalog_add_product_image(uuid, text, boolean) is
  'Chamada DEPOIS do upload real do arquivo (via cliente autenticado, protegido pelas policies de storage.objects abaixo) só para registrar o metadado. Primeira imagem de um produto sempre vira capa automaticamente. Exige que p_storage_path comece literalmente com "<store_id>/<product_id>/" — o mesmo prefixo que as policies de Storage já exigem para o upload em si ter funcionado, então este check é defesa em profundidade, não a barreira principal.';

create or replace function public.catalog_remove_product_image(p_image_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_product_id uuid;
  v_was_cover boolean;
  v_next_id uuid;
begin
  select store_id, product_id, is_cover into v_store_id, v_product_id, v_was_cover
  from public.product_images where id = p_image_id
  for update;

  if v_product_id is null then
    raise exception 'image_not_found' using errcode = '02000';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  delete from public.product_images where id = p_image_id;

  -- Comportamento determinístico ao remover a capa: promove a imagem
  -- de menor "position" restante; se não sobrar nenhuma, o produto
  -- fica sem capa (não é um erro).
  if v_was_cover then
    select id into v_next_id from public.product_images
      where product_id = v_product_id
      order by position asc, created_at asc
      limit 1;
    if v_next_id is not null then
      update public.product_images set is_cover = true where id = v_next_id;
    end if;
  end if;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, 'product_image_removed', 'product', v_product_id::text, jsonb_build_object('image_id', p_image_id));
end;
$$;

create or replace function public.catalog_set_cover_image(p_image_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_product_id uuid;
begin
  select store_id, product_id into v_store_id, v_product_id
  from public.product_images where id = p_image_id;

  if v_product_id is null then
    raise exception 'image_not_found' using errcode = '02000';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update public.product_images set is_cover = false where product_id = v_product_id and is_cover;
  update public.product_images set is_cover = true where id = p_image_id;

  insert into public.audit_log (actor_user_id, store_id, action, target_type, target_id, metadata)
  values (auth.uid(), v_store_id, 'product_cover_changed', 'product', v_product_id::text, jsonb_build_object('image_id', p_image_id));
end;
$$;

create or replace function public.catalog_move_product_image(p_image_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_product_id uuid;
  v_position integer;
  v_neighbor_id uuid;
  v_neighbor_position integer;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  select store_id, product_id, position into v_store_id, v_product_id, v_position
  from public.product_images where id = p_image_id;

  if v_product_id is null then
    raise exception 'image_not_found' using errcode = '02000';
  end if;
  if not public.can_manage_store_catalog(v_store_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select id, position into v_neighbor_id, v_neighbor_position
      from public.product_images
      where product_id = v_product_id and position < v_position
      order by position desc limit 1;
  else
    select id, position into v_neighbor_id, v_neighbor_position
      from public.product_images
      where product_id = v_product_id and position > v_position
      order by position asc limit 1;
  end if;

  if v_neighbor_id is null then
    return; -- já é a primeira/última imagem — no-op silencioso
  end if;

  update public.product_images set position = v_neighbor_position where id = p_image_id;
  update public.product_images set position = v_position where id = v_neighbor_id;
end;
$$;

revoke all on function public.catalog_add_product_image(uuid, text, boolean) from public;
revoke all on function public.catalog_remove_product_image(uuid) from public;
revoke all on function public.catalog_set_cover_image(uuid) from public;
revoke all on function public.catalog_move_product_image(uuid, text) from public;
grant execute on function public.catalog_add_product_image(uuid, text, boolean) to authenticated;
grant execute on function public.catalog_remove_product_image(uuid) to authenticated;
grant execute on function public.catalog_set_cover_image(uuid) to authenticated;
grant execute on function public.catalog_move_product_image(uuid, text) to authenticated;

-- ============================================================
-- 10. audit_log_action_check — só ALARGA (nunca estreita, mesma regra
--     de todas as migrations anteriores — ver 0004_account_audit.sql)
-- ============================================================

alter table public.audit_log
  drop constraint audit_log_action_check,
  add constraint audit_log_action_check check (action in (
    'signup_completed',
    'email_verification_completed',
    'password_recovery_requested',
    'password_recovery_grant_issued',
    'password_recovery_authorization_claimed',
    'password_recovery_completed',
    'password_recovery_revoked',
    'store_created',
    'owner_assigned',
    'plan_selected',
    'onboarding_completed',
    'access_denied',
    'category_created',
    'category_updated',
    'category_archived',
    'product_created',
    'product_updated',
    'product_published',
    'product_unpublished',
    'product_archived',
    'product_stock_adjusted',
    'product_image_added',
    'product_image_removed',
    'product_cover_changed'
  ));

comment on constraint audit_log_action_check on public.audit_log is
  'Conjunto de actions só CRESCE entre migrations (nunca estreitar — bloqueador histórico BUG-RT2-006, qa/reports/TASK-002-RETEST.md). TASK-003 adiciona os 12 eventos de catálogo — todos os valores anteriores permanecem intactos.';
