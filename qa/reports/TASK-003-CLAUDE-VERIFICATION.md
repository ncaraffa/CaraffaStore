# Verificação do implementador (Claude Code) — TASK-003

**VERIFICAÇÃO DO IMPLEMENTADOR — AGUARDANDO REVISÃO EXTERNA DO CHATGPT.**

Este documento é uma verificação adversarial, somente leitura sobre código de produção, produzida
pelo próprio implementador (Claude Code). Não é um QA independente. O Júnior está temporariamente
sem cota; a decisão de aprovação e merge fica a cargo de Caraffa/ChatGPT com base nas evidências
abaixo. Nenhum código de produção, migration, teste existente ou documentação foi alterado nesta
sessão. Nenhum merge, deploy ou movimentação de tarefa foi realizado.

**Data:** 2026-08-04
**Branch:** `feat/TASK-003-catalog-products`
**Commit testado:** `7f7382f206525916a79550281ee94959145f2755`
**Working tree inicial:** limpa

## Resultado

**BLOQUEADOR ENCONTRADO — CRÍTICO.**

Confirmado empiricamente, contra Postgres/PostgREST/Storage reais (Supabase local, sem mocks): uma
loja em estado `pending_payment` ou `suspended` consegue administrar o catálogo por completo
(criar/editar categorias, criar/publicar/arquivar produtos, ajustar estoque, enviar imagens ao
Storage) chamando as funções `catalog_*` e a API de Storage **diretamente**, contornando por
completo o guard `requireStoreStatus(supabase, "active", storeSlug)` — que só existe na camada de
página/Server Action (TASK-002) e nunca foi replicado dentro de nenhuma função `SECURITY DEFINER`
nem em nenhuma policy de `storage.objects`. É exatamente o "Ponto Crítico 1" definido como o teste
mais importante desta missão, e corresponde aos bloqueadores automáticos **#1** e **#2** da lista.

Um segundo problema, também CRÍTICO/ALTO, agrava o primeiro: a tabela `products` (criada na
TASK-001 e só estendida, nunca recriada, pela TASK-003) manteve os GRANTs de `INSERT`/`UPDATE`/
`DELETE` diretos para `authenticated` da TASK-001, e as policies de RLS correspondentes
(`products_insert_admin`/`products_update_admin`/`products_delete_admin`) também só checam
`is_store_admin`, nunca o status da loja. Isso permite escrita administrativa direta na tabela
`products` (status, preço, estoque, categoria, slug, SKU) **sem passar por nenhuma RPC**, sem
gravar nenhum evento de auditoria, e sem respeitar o guard de loja ativa — corresponde ao
bloqueador automático **#4**.

Um terceiro bug, de severidade ALTA, foi confirmado por concorrência real: o limite de 5 imagens
por produto pode ser ultrapassado (bloqueador automático **#11**).

`categories`, `product_images` e `audit_log` **não** têm esse problema de GRANT direto — só
`products` herdou o problema por ter sido estendida em vez de recriada.

---

## 1. Estado inicial do Git

```
$ git status
On branch feat/TASK-003-catalog-products
nothing to commit, working tree clean

$ git branch --show-current
feat/TASK-003-catalog-products

$ git rev-parse HEAD
7f7382f206525916a79550281ee94959145f2755

$ git log --oneline -10
7f7382f docs(task-003): update handoff, roadmap, task status to REVIEW
3069fdd feat(task-003): catalog, products, categories, images and stock
b7e10c3 merge: complete TASK-002 authentication and onboarding
4138630 chore(task-002): close authentication and onboarding task
b3540ec fix(task-002): bind recovery completion to explicit attempt
9879b06 test(qa): verify recovery grant lifecycle and audit correlation
de6c2dc fix(task-002): audit password recovery only after credential update
d53ff79 test(qa): add final TASK-002 remediation verification
cda0ae3 fix(task-002): bind password recovery to verified recovery tokens
3e0548e test(qa): add TASK-002 Claude verification report
```

Estado idêntico ao esperado pela missão. Prosseguido.

## 2. Ambiente

- Node v24.18.0, npm 11.16.0, Supabase CLI 2.111.0.
- Docker/Supabase local já em execução (containers `supabase_*_commerce-platform-local`);
  `npx supabase db reset` executado (aplica 0001–0005 do zero) para uma baseline limpa e
  determinística, seguido de `npm run seed:local`.
- Next.js dev server real (`npm run dev`, via `.claude/launch.json` temporário — removido antes do
  commit) usado para o smoke test de interface; parado ao final.
- `.env.local` já existente, não recriado, não commitado. Nenhuma credencial de produção usada.

## 3. Metodologia

Não confiei no resumo da implementação, nos 275 testes automatizados nem na suíte SQL declarada.
Rodei primeiro a suíte SQL/scripts do próprio implementador (para confirmar o que ela já cobre), e
depois escrevi scripts adversariais próprios (TypeScript, `@supabase/supabase-js`, sessões reais via
`signInWithPassword` com os usuários fixture) para cada Ponto Crítico da missão, executados contra o
Postgres/PostgREST/Storage locais reais — nunca mocks. Também consultei `pg_proc`/`pg_class`/
`information_schema.role_table_grants` diretamente via `docker exec ... psql` para o catálogo real
de privilégios. Todos os scripts adversariais foram temporários (`qa/tmp/*.ts`), apagados antes do
commit deste relatório — `git status` confirmado limpo depois.

---

## 4. Ponto Crítico 1 — Estado da loja × RPC/Storage direta (o teste mais importante)

Testado com os quatro usuários fixture reais do seed (`merchant-pending`, owner de
`loja-pendente-fixture` em `pending_payment`; `merchant-suspended`, owner de
`loja-suspensa-fixture` em `suspended`; `admin-a`, admin de `store-a` em `active`, como controle
positivo), chamando as RPCs e o Storage **diretamente via supabase-js**, sem passar por nenhuma
página/Server Action.

| Operação (RPC/Storage direta) | `pending_payment` | `suspended` | `active` (controle) |
|---|---|---|---|
| `catalog_create_category` | **PERMITIDO** | **PERMITIDO** | permitido (esperado) |
| `catalog_create_product` | **PERMITIDO** | **PERMITIDO** | permitido (esperado) |
| `catalog_set_product_status` (publicar) | **PERMITIDO** | **PERMITIDO** | permitido (esperado) |
| `catalog_adjust_stock` | **PERMITIDO** | **PERMITIDO** | permitido (esperado) |
| `catalog_add_product_image` (metadado) | **PERMITIDO** | **PERMITIDO** | permitido (esperado) |
| Upload real no Storage (`storage.objects`) | **PERMITIDO** | **PERMITIDO** | permitido (esperado) |

Todas as seis operações, nos dois estados não operacionais, retornaram sucesso (sem erro, com a
linha/registro real criado no banco). Nenhuma delas deveria ter sido permitida — o guard de página
`requireStoreStatus(..., "active", ...)` (TASK-002) é a **única** barreira, e é trivialmente
contornável por qualquer chamada direta à API REST/RPC do Supabase (exatamente o que um usuário
com as próprias credenciais consegue fazer sem nenhum acesso privilegiado extra).

**Causa raiz:** todas as onze funções `catalog_*` (`supabase/migrations/0005_catalog.sql`)
autorizam exclusivamente via `is_store_admin(store_id)`:

```sql
select exists (
  select 1 from public.store_members sm
  where sm.store_id = target_store_id and sm.user_id = auth.uid() and sm.role in ('owner', 'admin')
);
```

`is_store_admin`/`is_store_member` (`0001_init.sql`) checam só vínculo de papel — nunca
`stores.status`. As policies de `storage.objects` (`product_images_storage_insert_admin`/
`_delete_admin`) usam exatamente a mesma função, herdando o mesmo problema. `lib/catalog/service.ts`
também não faz nenhuma checagem adicional de status antes de chamar as RPCs — o `requireStoreStatus`
só é chamado nas Server Actions/páginas (`app/dashboard/{categories,products}/actions.ts`,
`app/dashboard/products/[id]/edit/page.tsx`, etc.), nunca dentro do próprio banco.

**Evidência (comando real, saída literal):**

```
catalog_create_category em pending_payment: PERMITIDO (id=614e7fa9-...)
catalog_create_product em pending_payment: PERMITIDO (id=fb9e1de2-...)
catalog_set_product_status(publish) em pending_payment: PERMITIDO
catalog_adjust_stock em pending_payment: PERMITIDO (novo estoque=8)
Storage upload direto em pending_payment: PERMITIDO
```

(idêntico para `suspended`, com IDs diferentes — ver histórico da sessão).

**Severidade: CRÍTICO.** Bloqueador automático #1 e #2 confirmados. Uma loja inadimplente
(`pending_payment`) ou suspensa por violação (`suspended`) — os dois estados que a TASK-002
existe justamente para impedir de operar — consegue publicar produtos novos, alterar preços,
ajustar estoque e enviar imagens ao catálogo, usando só a própria sessão autenticada normal.

## 5. Ponto Crítico 2 — Privilégios reais no catálogo Postgres

Consulta real ao catálogo (`information_schema.role_table_grants`, `pg_proc.proacl`, `pg_class.relacl`)
após `db reset` (0001–0005 aplicadas):

- **`categories`**: `anon`/`authenticated` só têm `SELECT`. `service_role` tem `SELECT/INSERT/
  UPDATE/DELETE`. Nenhuma escrita direta possível para `authenticated` — confirmado empiricamente
  (`INSERT` direto → `permission denied for table categories`).
- **`product_images`**: mesmo padrão de `categories` — só `SELECT` para `authenticated`/`anon`.
  Confirmado (`INSERT` direto → `permission denied`).
- **`audit_log`**: só `service_role` tem `SELECT/INSERT` (nem `UPDATE`/`DELETE` para ninguém, nem
  para `service_role` — append-only real). Confirmado: `INSERT`/`UPDATE`/`DELETE` diretos como
  `authenticated` → `permission denied for table audit_log` nos três casos.
- **`products` (⚠️ achado do dia):** `authenticated` tem `SELECT/INSERT/UPDATE/DELETE` — herdado
  intacto da migração `0001_init.sql` (TASK-001). A TASK-003 estendeu a tabela com seis colunas
  novas sensíveis (`status`, `price_cents`, `sku`, `slug`, `category_id`, `updated_at`) e nunca
  revisou esse GRANT nem as RLS policies de escrita, que continuam sendo só
  `is_store_admin(store_id)`, sem checar `stores.status`.
- **Todas as 11 funções `catalog_*`**: `SECURITY DEFINER`, `search_path=''` (endurecido, sem
  overloads, sem GRANT residual a `public`/`anon`), `EXECUTE` restrito a `authenticated` — nesse
  aspecto específico (blindagem da própria função) o desenho está correto.
- `storage.objects`/`storage.buckets`: `TRUNCATE` corretamente revogado de `anon`/`authenticated`;
  `anon` corretamente sem nenhum privilégio via papel Postgres (leitura pública passa pelo bucket
  público do serviço de Storage, não pelo papel `anon`).
- Nenhuma função `catalog_*` duplicada/sobreposta encontrada.

**Evidência da escrita direta bypassando as RPCs (`products`, loja própria, `active`):**

```
DML direto UPDATE products.status/price (loja própria, active): PERMITIDO
  → status alterado para 'published' e price_cents para 999999 SEM passar por
    catalog_set_product_status/catalog_update_product, SEM nenhum evento em audit_log.
DML direto INSERT products em pending_payment: PERMITIDO
  → produto criado numa loja pending_payment via INSERT cru, sem checar RPC nem guard de estado.
```

**Severidade: CRÍTICO/ALTO** (bloqueador automático #4, especificamente para `products`). Este
achado é estruturalmente o mesmo problema do Ponto Crítico 1 (nenhuma verificação de
`stores.status` em nenhuma camada de banco), só que por uma segunda porta (DML direto em vez de
RPC) — e, adicionalmente, permite mass assignment de `status`/`stock` num único `UPDATE` (contorna
a separação deliberada entre `catalog_update_product` e `catalog_set_product_status`/
`catalog_adjust_stock`) e elimina completamente o rastro de auditoria da mutação.

## 6. Ponto Crítico 3 — Loja A × Loja B (cross-tenant)

Todos os vetores testados com `admin-a`/`admin-b` (admins reais das duas lojas `active`),
`merchant-multi` (staff em `store-a`, não-admin), `cliente-a` (autenticado sem nenhum vínculo) e
`anon`:

| Cenário | Resultado |
|---|---|
| admin-a edita categoria da Loja B | bloqueado (`insufficient_privilege`) |
| admin-a desativa categoria da Loja B | bloqueado (`insufficient_privilege`) |
| admin-a edita produto da Loja B | bloqueado (`insufficient_privilege`) |
| admin-a publica produto da Loja B | bloqueado (`insufficient_privilege`) |
| admin-a ajusta estoque da Loja B | bloqueado (`insufficient_privilege`) |
| `category_id` da Loja B usado em produto da Loja A | bloqueado (`category_store_mismatch`, trigger `products_category_store_check`) |
| cliente-a (sem membership) lista categorias **inativas** da Loja A | 0 linhas — corretamente oculto |
| cliente-a (sem membership) lista categorias **ativas** da Loja A (catálogo público) | visível — comportamento correto/intencional (fix documentado no handoff) |
| staff (`merchant-multi`, não-admin) cria categoria em `store-a` | bloqueado (`insufficient_privilege`) — staff não recebeu escrita administrativa por acidente |
| anon chama RPC administrativa | bloqueado (`permission denied for function`) |

**Resultado: nenhuma leitura/escrita administrativa cross-tenant encontrada.** Isolamento entre
lojas para as RPCs está correto e bem coberto pelos 21 casos de `catalog_isolation_check.sql`
(reexecutados nesta sessão, ver seção 12) mais os cenários adicionais acima.

## 7. Ponto Crítico 4 — Catálogo público

Testado publicando um produto real (`stock=0`, para também cobrir "Esgotado") e comparando a
visibilidade entre `anon`, `cliente-a` (autenticado sem vínculo), `admin-b` (membro de outra loja) e
`admin-a` (membro da própria loja):

- Todos os quatro veem exatamente o mesmo produto `published`, com `stock=0` — catálogo público
  idêntico independente de quem olha, como projetado (`getPublicStore`/`listPublicProducts` filtram
  explicitamente por `status`/`is_active`, nunca dependem só da RLS).
- `draft` e `archived` nunca aparecem, nem para `anon` nem para autenticado sem vínculo (0 linhas em
  ambos os casos, testado com um produto criado e depois arquivado).
- Loja `pending_payment` e loja `suspended` **não aparecem** no `select` público de `stores` (0
  linhas) — a policy `stores_select_public` (`status = 'active'`) protege esse vetor corretamente,
  mesmo com o bug do Ponto Crítico 1 permitindo publicar produtos nessas lojas nos bastidores.
- Busca não mistura tenants: produto da Loja A filtrado por `store_id = Loja B` retorna 0 linhas.
- Entradas maliciosas na busca (`%`, `_`, string vazia, espaços, `'; DROP TABLE products; --`) não
  quebram a query nem retornam resultado inesperado — `ilike` parametrizado via PostgREST, sem
  concatenação de SQL.

**Resultado: catálogo público correto e consistente entre todos os perfis testados.** A correção
documentada no handoff (`to anon` → `to public`) foi validada — nenhuma regressão do bug original
(catálogo "quebrado" para autenticado sem vínculo).

## 8. Ponto Crítico 5 — Estoque e concorrência

Reexecutei `supabase/tests/stock-concurrency-check.ts` (do implementador) e estendi com casos
próprios:

| Caso | Resultado |
|---|---|
| delta zero | rejeitado (`invalid_delta`) |
| delta que produziria estoque negativo | rejeitado (`stock_would_be_negative`) |
| motivo vazio / só espaços | rejeitado (`reason_required`) |
| delta extremo positivo (2 bilhões) | aceito sem quebrar (`integer` do Postgres suporta) |
| ajuste em produto de outra loja | rejeitado (`insufficient_privilege`) |
| ajuste em produto inexistente | rejeitado (`product_not_found`) |
| **5 reduções concorrentes** de -3 sobre estoque=10 | exatamente 3 sucessos, estoque final 1, 3 eventos de auditoria (script do implementador) |
| **10 reduções concorrentes** de -3 sobre estoque=10 | exatamente 3 sucessos, estoque final 1, 3 eventos de auditoria (script próprio) |

Estoque nunca ficou negativo em nenhuma rodada; número de eventos de auditoria bateu exatamente com
o número de ajustes bem-sucedidos em ambas as rodadas de concorrência (5 e 10 threads). O
compare-and-swap no próprio `WHERE` do `UPDATE` (`stock + delta >= 0`) se comportou como projetado.

**Ressalva já coberta na seção 5:** este invariante só vale para ajustes feitos via
`catalog_adjust_stock`. Uma escrita direta em `products.stock` (Ponto Crítico 2) não passa por essa
proteção de forma alguma — nesse caso específico o `CHECK (stock >= 0)` da tabela ainda impede valor
negativo (é uma constraint de banco, não de aplicação), mas não impede a alteração sem auditoria/
sem motivo/sem checagem de estado da loja.

## 9. Ponto Crítico 6 — Imagens e Storage

- Upload real (JPEG) pelo dono da loja: sucesso. Admin de outra loja tentando enviar no caminho da
  Loja A: bloqueado por RLS (`new row violates row-level security policy`). Admin de outra loja
  tentando remover imagem da Loja A: bloqueado, arquivo permanece. (script do implementador,
  reexecutado, 4/4 PASS nesta parte.)
- MIME não permitido (`image/svg+xml`): rejeitado pelo bucket (`mime type ... is not supported`).
- Arquivo acima de 5 MB: rejeitado pelo bucket (`exceeded the maximum allowed size`).
- `storage_path` com prefixo de `store_id` de outra loja: rejeitado por `catalog_add_product_image`
  (`invalid_storage_path`) mesmo que a linha em si fosse inserida na loja "certa".
- Remoção/troca de capa de imagem de outra loja (`admin-b` sobre imagem de produto de `store-a`):
  bloqueado (`insufficient_privilege`) nos dois casos.
- 6ª imagem sequencial (após 5 já existentes): rejeitada (`max_images_reached`).
- Remoção da capa com outras imagens restantes: a imagem de **menor `position`** é promovida a nova
  capa de forma determinística (testado explicitamente: capa removida, a imagem de `position=1`
  vira a nova capa). Remover todas as imagens de um produto não gera erro (produto fica sem capa).
- Mudança concorrente de capa (duas chamadas simultâneas de `catalog_set_cover_image` para imagens
  diferentes do mesmo produto): exatamente 1 capa sobrevive ao final — a unicidade é garantida pelo
  índice único parcial `product_images_one_cover_per_product`, uma das duas chamadas falha com
  `duplicate key value violates unique constraint`.

**Bug encontrado — limite de 5 imagens sob concorrência real:**

Duas chamadas concorrentes de `catalog_add_product_image` para o mesmo produto, com 4 imagens já
existentes, **ambas tiveram sucesso**, resultando em 6 imagens no produto (violando o limite
documentado de 5). Reproduzido de forma determinística em **3 de 3** tentativas independentes:

```
Tentativa 1: sucessos_concorrentes=2 total_final=6
Tentativa 2: sucessos_concorrentes=2 total_final=6
Tentativa 3: sucessos_concorrentes=2 total_final=6
```

**Causa raiz:** ao contrário do ajuste de estoque (que usa compare-and-swap atômico no próprio
`WHERE` do `UPDATE`), o limite de imagens é garantido só pela trigger
`check_product_image_constraints` (`0005_catalog.sql`), que faz `SELECT COUNT(*) ... WHERE
product_id = new.product_id` e compara com 5 **antes** do `INSERT`, sem nenhum lock explícito nem
constraint declarativa (diferente da capa única, que tem um índice único parcial de verdade). Sob
duas transações concorrentes, ambas leem `COUNT = 4` antes de qualquer uma commitar seu `INSERT`, e
ambas passam a checagem — um TOCTOU (check-then-act) clássico.

**Severidade: ALTO.** Bloqueador automático #11 confirmado. Não é vazamento cross-tenant, mas viola
um invariante de negócio documentado explicitamente como "garantido no banco, nunca só na
aplicação" — que na prática não é garantido sob concorrência real, justamente o cenário que a
migração afirma proteger.

Não testado nesta rodada (fora do escopo de risco imediato, ver seção "Limitações"): consistência
entre objeto órfão no Storage sem linha em `product_images` e vice-versa — o desenho já documenta
esse caso como aceito (bucket público, sem transação distribuída real entre Storage e Postgres), e
não é um vetor cross-tenant.

## 10. Ponto Crítico 7 — Categorias e produtos (validações)

18/18 cenários verificados, todos corretos:

- slug duplicado na mesma loja → rejeitado (`slug_taken`); mesmo slug em lojas diferentes →
  permitido.
- SKU duplicado na mesma loja → rejeitado (`slug_or_sku_taken`); mesmo SKU em lojas diferentes →
  permitido; múltiplos produtos com SKU `null` na mesma loja → não colidem.
- preço negativo → rejeitado (`invalid_price`); preço extremo (`2147483647`) → aceito sem quebrar.
- estoque inicial negativo → rejeitado (`invalid_stock`).
- status inventado (`deleted_forever`) → rejeitado (`invalid_status`).
- `category_id` de outra loja na criação → rejeitado (`category_store_mismatch`).
- categoria inativa atribuída a um produto → permitido (comportamento intencional — só afeta
  visibilidade pública, não é uma restrição de integridade).
- produto publicado sem imagem → permitido (não há regra de negócio contrária).
- `catalog_update_product` com tentativa de mass assignment de `status`/`stock` — estruturalmente
  impossível: a assinatura da função nem aceita esses parâmetros; a chamada forjada falha na
  resolução de overload do PostgREST antes mesmo de chegar ao banco. Estado do produto confirmado
  inalterado antes/depois.
- nome vazio → rejeitado (`invalid_name`); descrição de 100 mil caracteres → aceita sem quebrar;
  nome com emoji/acentos/HTML cru (`<script>alert(1)</script>`) → aceito sem quebrar (armazenamento
  cru; sanitização de exibição é responsabilidade da camada de renderização, fora do escopo de
  injeção SQL/RPC verificado aqui).
- slug com formato inválido (espaços/maiúsculas/pontuação) → rejeitado (`invalid_slug`).
- `DELETE` físico direto em `categories` → bloqueado (`permission denied`, sem GRANT) — confirma que
  categorias com produtos vinculados não podem ser excluídas fisicamente por nenhuma via.

## 11. Ponto Crítico 8 — Auditoria

- Fabricar evento via `INSERT` direto em `audit_log` como `authenticated`: bloqueado
  (`permission denied for table audit_log` — sem GRANT algum, nem para `service_role` além de
  `SELECT/INSERT`).
- `UPDATE`/`DELETE` em `audit_log` como `authenticated`: bloqueados (append-only real).
- Todas as 11 funções `catalog_*` gravam `actor_user_id = auth.uid()` (nunca recebido como
  parâmetro do cliente) e `store_id` sempre re-derivado da linha (categoria/produto/imagem)
  consultada no próprio banco, nunca do parâmetro cru do cliente sem validação — mesmo padrão da
  TASK-002, sem a classe de bug do BUG-CLAUDE-VERIF3-001.
- **Ressalva (consequência do achado da seção 5, não um bug de auditoria isolado):** uma escrita
  direta em `products` (bypass de RPC) não gera nenhum evento — não é um evento *fabricado*, é a
  *ausência* de um evento real correspondente a uma mutação real. Corrigir o achado da seção 5
  (GRANTs diretos em `products`) resolve esta ressalva também.

## 12. Regressões — suíte do implementador reexecutada nesta sessão

Todos os números abaixo são desta sessão, contra o ambiente local resetado (`db reset` + `seed:local`),
não copiados de relatórios anteriores:

| Gate | Comando | Resultado nesta sessão |
|---|---|---|
| Testes unitários | `npm test` | **275/275** (25 arquivos) |
| Lint | `npm run lint` | OK — 0 erros, 3 warnings `no-img-element` (mesmos já documentados/aceitos) |
| Typecheck | `npm run typecheck` | OK, 0 erros (após remover os scripts adversariais temporários) |
| Build | `npm run build` | OK, build de produção concluído (Next.js 16.2.12/Turbopack) |
| `npm audit` | — | **0 vulnerabilidades** |
| `npm audit --omit=dev` | — | **0 vulnerabilidades** |
| TASK-001 RLS real | `supabase/tests/isolation_check.sql` | **7/7 PASS** |
| TASK-002 SQL real | `supabase/tests/onboarding_isolation_check.sql` | **56/56 PASS** |
| TASK-003 SQL real | `supabase/tests/catalog_isolation_check.sql` | **21/21 PASS** — nota: esta suíte **não cobre** o cenário do Ponto Crítico 1 (nenhum dos 21 casos usa uma loja `pending_payment`/`suspended` como ator tentando escrever), o que explica por que o bug crítico não foi pego antes |
| Concorrência de estoque | `supabase/tests/stock-concurrency-check.ts` | **PASS** (8/8 verificações — estoque + isolamento de Storage) |
| Migration upgrade | `supabase/tests/migration-upgrade-check.sh` | **PASS** — banco novo (0001–0005) e upgrade real desde o estado da master (`b7e10c3`, 0001–0004 já aplicadas + dados históricos reais de TASK-001/TASK-002) até a TASK-003, sem erro, todo o histórico preservado intacto, schema final funcional |

Privileges tests declarados (`0001..0005_*.privileges.test.ts`, análise estática do SQL versionado)
rodam dentro de `npm test` — os 275 já incluem essa suíte; não há um número separado "24/24" a
reportar isoladamente nesta sessão (o valor "24/24" do handoff parece referir-se a uma contagem
anterior de casos dentro dessa mesma suíte estática, hoje englobada no total de 275).

## 13. Migrations — detalhe

- **Banco limpo:** `npx supabase db reset` aplicou 0001→0005 sem nenhum erro, sem `NOTICE` de
  problema (só `NOTICE`s esperados de idempotência do Postgres/extensões).
- **Upgrade real desde a master:** o script do implementador (`migration-upgrade-check.sh`) foi
  executado de ponta a ponta: recria o estado de 0001+0002, insere 9 linhas históricas variadas de
  `audit_log`, aplica 0003+0004 por cima (sem reset), confirma sobrevivência exata; depois insere 2
  linhas no estilo TASK-002 (simulando o estado real de `b7e10c3`) e aplica 0005 por cima, sem
  reset — confirma que as 11 linhas históricas totais sobrevivem intactas, as 11 funções
  `catalog_*` existem, as tabelas `categories`/`product_images` existem, o bucket `product-images`
  existe e é público, `audit_log_action_check` foi só alargado (nenhum valor antigo perdido), e
  `public.products` foi de fato estendida via `ALTER TABLE` (5 colunas novas confirmadas via
  `information_schema.columns`), nunca recriada.
- Ao final, o próprio script restaura o ambiente (`db reset` + `seed:local`), o que também serviu
  como a baseline limpa usada no restante desta sessão.

## 14. Interface — smoke test real (navegador)

Executado com `npm run dev` real + Supabase local real, login como `admin-a`:

**Desktop (1280×800):**
- Login → dashboard (`/dashboard?store=store-a`) → criar categoria (`/dashboard/categories/new`,
  "Bebidas Smoke Test") → criar produto (`/dashboard/products/new`, preço `19,90`, estoque inicial
  `15`, categoria vinculada) → editar produto → ajustar estoque (`-2`, motivo obrigatório
  preenchido; estoque atualizado de 15 para **13** na tela, com mensagem "Estoque atualizado.") →
  publicar (botão vira "Despublicar", confirmando o novo estado) → catálogo público
  (`/loja/store-a`) mostra o produto publicado com `R$ 19,90` → ajuste de estoque até **0** →
  catálogo público passa a mostrar **"Esgotado"** corretamente → busca (`?q=Smoke`) e página de
  produto individual (`/loja/store-a/produto/produto-smoke-test`) funcionam, com o aviso correto de
  "Compra online ainda não disponível".
- Upload de imagem não testado no navegador nesta rodada (já coberto de forma real e mais
  controlada pelos scripts adversariais das seções 9/anteriores, incluindo upload real de bytes
  JPEG válidos).

**Mobile (375×812):** `document.documentElement.scrollWidth === document.documentElement.clientWidth
=== 375` tanto em `/loja/store-a` (catálogo público) quanto em `/dashboard/products?store=store-a`
(tabela do painel) — **sem overflow horizontal** em nenhuma das duas páginas testadas.

Nenhum erro de servidor (`preview_logs`) nem de console durante o smoke test.

## 15. Bugs encontrados e severidades

| ID | Severidade | Resumo | Bloqueador automático |
|---|---|---|---|
| BUG-CLAUDE-003-001 | **CRÍTICO** | Nenhuma função `catalog_*` nem policy de `storage.objects` verifica `stores.status` — lojas `pending_payment`/`suspended` administram catálogo completo e escrevem no Storage via RPC/API direta, contornando o guard de página da TASK-002 | #1, #2 |
| BUG-CLAUDE-003-002 | **CRÍTICO/ALTO** | `products` manteve GRANT direto de `INSERT/UPDATE/DELETE` para `authenticated` (herdado da TASK-001) sem revisão na TASK-003; RLS de escrita também não checa `stores.status` — permite bypass total das RPCs de catálogo (sem auditoria, sem guard de estado, mass assignment de `status`/`stock` num único UPDATE) | #4 |
| BUG-CLAUDE-003-003 | **ALTO** | Limite de 5 imagens por produto violável sob concorrência real (TOCTOU na trigger `check_product_image_constraints`, sem lock/constraint declarativa) — reproduzido 3/3 vezes | #11 |

Nenhum outro bloqueador automático (dos 17 listados na missão) foi confirmado. Cross-tenant,
catálogo público, validações de categoria/produto, concorrência de estoque, capa única/promoção
determinística e migrations passaram em todos os cenários testados.

## 16. Limitações e testes não executados

- **Concorrência de slug** (mencionada nos "critérios de bloqueio" do roteiro geral, não detalhada
  como ponto crítico específico da TASK-003): não testada isoladamente nesta sessão para
  categorias/produtos — a constraint `UNIQUE(store_id, slug)` é declarativa no banco (não
  check-then-act como o limite de imagens), então o mecanismo é estruturalmente diferente do bug da
  seção 9; risco residual considerado baixo, mas não comprovado por teste de concorrência real.
- **Consistência objeto-Storage × linha-`product_images`** (arquivo órfão sem linha, ou linha sem
  arquivo real): não testada empiricamente nesta sessão. O próprio desenho já documenta esse
  cenário como aceito (bucket público, sem transação distribuída Storage↔Postgres); não é um vetor
  cross-tenant e foi despriorizado frente aos três achados críticos/altos acima, dado o objetivo de
  "validar riscos reais antes do merge" e não esgotar hipóteses de baixo impacto.
- **Falha forçada da auditoria durante `catalog_adjust_stock`** (item 10 do roteiro de estoque): não
  reproduzida nesta sessão (exigiria interromper a transação no meio, ex. via `pg_terminate_backend`
  ou trigger de falha injetada) — a garantia vem da própria estrutura da função (uma única transação
  implícita por chamada de função `plpgsql`; se o `INSERT` em `audit_log` falhar, a função inteira
  falha e o `UPDATE` de estoque é revertido pelo Postgres automaticamente), mesmo padrão já
  comprovado por teste real equivalente na TASK-002 (Caso 26a/26b de
  `onboarding_isolation_check.sql`, reexecutado nesta sessão com sucesso).
- Upload de imagem via navegador (interação de arquivo real na UI) não testado nesta rodada — coberto
  de forma mais direta e controlada pelos scripts adversariais (upload real de bytes JPEG/PNG,
  rejeição de SVG e de arquivo >5MB).

## 17. git status final

```
$ git status
On branch feat/TASK-003-catalog-products
Changes to be committed:
  new file:   qa/reports/TASK-003-CLAUDE-VERIFICATION.md
```

(Único arquivo novo commitado nesta sessão. Todos os scripts adversariais temporários e o
`.claude/launch.json` usado para o smoke test foram apagados antes deste commit.)

## 18. Confirmações explícitas

- Nenhum código de produção, migration, teste existente ou documentação alterado nesta sessão.
- Nenhum merge realizado. Nenhum deploy realizado.
- TASK-003 continua em `REVIEW` (`tasks/review/task-003.md` não modificado).
- **Aguardando revisão externa do ChatGPT** antes de qualquer correção, aprovação ou merge.
