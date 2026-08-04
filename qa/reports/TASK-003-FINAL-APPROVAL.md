# Aprovação final — TASK-003

**Commit aprovado (feature branch):** `685e3aab7d400c915832b58512216ed9b1a73604`
(`feat(task-003): enforce active-store writes and image limits`, branch
`feat/TASK-003-catalog-products`)

**Decisão: APROVADA PARA MERGE.**

## Três bloqueadores corrigidos (verificados nesta sessão, banco limpo)

1. **CRÍTICO — loja não ativa administrava catálogo via RPC/Storage direta.** Corrigido com
   `can_manage_store_catalog(store_id)` (owner/admin **e** `stores.status = 'active'`), usada pelas
   11 funções `catalog_*` e pelas 2 policies de escrita de `storage.objects`. Verificado: `active`
   permitido em todas as operações (categoria, produto, publicar, estoque, imagem);
   `pending_payment` e `suspended` negados em todas elas, tanto via RPC quanto via upload direto no
   Storage.
2. **CRÍTICO/ALTO — DML direto em `products` contornava as RPCs.** `authenticated` agora só tem
   `SELECT` na tabela (confirmado via `information_schema.role_table_grants` — sem
   INSERT/UPDATE/DELETE/TRUNCATE); as 3 policies de escrita antigas foram derrubadas. `INSERT`,
   `UPDATE` e `DELETE` diretos como `authenticated` negados (`permission denied`); a RPC legítima
   (`catalog_create_product`) continua funcionando normalmente.
3. **ALTO — limite de 5 imagens vencível sob concorrência.** `catalog_add_product_image` agora trava
   a linha do produto (`for update`) antes de contar imagens. Verificado: 4 imagens + 2 inserções
   concorrentes → exatamente 1 sucede, total final 5; 0 imagens + 6 concorrentes → nunca mais de 5;
   5 imagens + nova inserção → sempre rejeitada. Capa única e promoção determinística da próxima
   imagem ao remover a capa continuam corretas.

## Resultados finais (banco limpo, mesma sessão)

| Gate | Resultado |
|---|---|
| `npm test` | **282/282** |
| Lint | OK — 0 erros, 3 warnings `no-img-element` (aceitos, já documentados) |
| `npx tsc --noEmit` | OK, 0 erros |
| `npm run build` | OK |
| `npm audit` / `--omit=dev` | 0 vulnerabilidades |
| TASK-001 RLS (`isolation_check.sql`) | **7/7 PASS** |
| TASK-002 SQL (`onboarding_isolation_check.sql`) | **56/56 PASS** |
| TASK-003 SQL (`catalog_isolation_check.sql`) | **35/35 PASS** (Casos 1-28 originais + 29-42 da correção: matriz de status × RPC, DML direto negado, controle positivo `active`) |
| Concorrência de estoque + imagens (`stock-concurrency-check.ts`) | **17/17 PASS** |
| Privilégios estáticos (`0001`/`0005_catalog.privileges.test.ts`, dentro de `npm test`) | 39/39 PASS |

## Migrations

- Banco novo (`supabase db reset`, 0001→0005): sem erro.
- Upgrade real desde a master (`b7e10c315e94b98293395a8d814e0fdfb0c2b7ca`, via
  `migration-upgrade-check.sh`): histórico de `audit_log` preservado intacto, `public.products`
  confirmada como `ALTER TABLE` (nunca recriada), schema final funcional — **PASS**.

## Smoke test

Login (admin-a, loja `active`) → criar produto → publicar (`Despublicar` exibido) → ajustar estoque
(8→5, "Estoque atualizado.") → catálogo público (`/loja/store-a`) mostra o produto publicado com
preço correto. Sem erros de servidor.

## Limitações não bloqueantes (herdadas, já documentadas, não impedem o merge)

- Bucket de imagens público (leitura por URL direta, mitigada por caminho com UUID aleatório).
- Busca `ilike` simples, sem paginação (adequado à escala do MVP).
- `<img>` nativo em vez de `next/image` (3 warnings de lint aceitos).
- Consistência objeto-Storage × linha `product_images` órfã não testada exaustivamente (aceita no
  desenho, não é vetor cross-tenant).

## Decisão

**APROVADA PARA MERGE.** Nenhum deploy realizado nesta sessão.
