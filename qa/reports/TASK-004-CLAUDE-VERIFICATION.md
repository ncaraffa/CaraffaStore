# Verificação do implementador (Claude Code) — TASK-004

**Este documento é uma verificação produzida pelo próprio implementador, NÃO um QA independente.**
Claude Code não declara aprovação, não faz merge, não faz deploy e não move a tarefa para DONE.

**Data:** 2026-08-04
**Branch:** `feat/TASK-004-cart-orders`
**Commit-base:** `66d9760fc6b3dfa5846b8763d389c45e2b233581` (master, TASK-001/002/003 DONE)
**Working tree inicial:** limpa

## Arquitetura de `orders`/`order_items`

`orders`: `id`, `store_id` (FK `ON DELETE RESTRICT`, registro de negócio — mesma classe de
`audit_log`), `public_code` (código curto exposto ao cliente, `UNIQUE(store_id, public_code)`),
`idempotency_key` (`UNIQUE(store_id, idempotency_key)`), `request_fingerprint` (hash do conteúdo,
usado para detectar reenvio idêntico vs. conflitante), dados do cliente, `status`, `subtotal_cents`/
`total_cents` (sempre calculados no banco), timestamps (`created_at`/`updated_at`/`cancelled_at`/
`completed_at`).

`order_items`: snapshot imutável (`product_name_snapshot`, `product_slug_snapshot`,
`unit_price_cents`, `quantity`, `line_total_cents`) — nunca lido do produto atual, preserva o pedido
mesmo que o produto seja depois renomeado/repreçado/despublicado/arquivado.

## Fluxo atômico de criação (`create_order`)

Uma única função `SECURITY DEFINER`, chamável por `anon` **e** `authenticated` (checkout sem login):
resolve a loja pelo slug e exige `status='active'`; valida/consolida os itens (soma quantidades
duplicadas, rejeita vazio/malformado); calcula um fingerprint determinístico do pedido; serializa por
`(store_id, idempotency_key)` via `pg_advisory_xact_lock`; bloqueia as linhas dos produtos envolvidos
em `ORDER BY id` (evita deadlock entre pedidos concorrentes com produtos em comum); valida
loja/status/estoque de cada produto com o preço lido **agora** do banco; cria o pedido + os
`order_items` (snapshots) + reduz o estoque via compare-and-swap (`stock >= quantity` no próprio
`WHERE`, nunca SELECT-depois-UPDATE) + grava `order_created`/`order_stock_reserved` na mesma
transação. Qualquer falha desfaz tudo (transação única).

## Estratégia de idempotência

`idempotency_key` (UUID) gerada uma vez pelo navegador por tentativa real de checkout (reenvios —
duplo clique/refresh/retry — reusam a mesma key). `create_order` serializa chamadas com a mesma key
via advisory lock e compara um `request_fingerprint` (hash do conteúdo real: cliente + itens
consolidados, nunca preço): mesma key + mesmo conteúdo → devolve o pedido já existente (idempotente,
sem duplicar nem rebaixar estoque); mesma key + conteúdo diferente → `idempotency_conflict`.
Verificado sob concorrência REAL (2 chamadas HTTP simultâneas com a mesma key): nenhuma falha, mesmo
pedido devolvido, estoque baixado exatamente uma vez.

## Estratégia de estoque

Reserva e baixa acontecem na mesma transação da criação, via compare-and-swap (mesmo padrão de
`catalog_adjust_stock`, TASK-003). Produtos são bloqueados (`FOR UPDATE`) em `ORDER BY id` — ordem
determinística que evita deadlock entre dois pedidos concorrentes com produtos em comum, mesmo
quando os carrinhos os listam em ordem invertida (testado e confirmado). Overselling testado sob
concorrência real: 2 pedidos simultâneos de quantidade 4 sobre estoque 5 → exatamente 1 sucede,
estoque final 1, nunca negativo.

## Cancelamento e devolução de estoque

`order_cancel` trava a linha do **pedido** primeiro (`FOR UPDATE`) — isso sozinho já serializa
cancelamentos concorrentes do mesmo pedido: a segunda chamada só prossegue depois que a primeira
confirma, vê `status='cancelled'` e é rejeitada (`invalid_status_transition`), nunca devolvendo
estoque de novo. `completed`/`cancelled` são terminais. Devolução usa a mesma técnica de lock
determinístico (`ORDER BY id`) sobre os produtos do pedido antes de somar de volta. Testado sob
concorrência real (2 cancelamentos simultâneos do mesmo pedido): exatamente 1 bem-sucedido, estoque
devolvido exatamente uma vez, exatamente 1 evento `order_cancelled`.

## Transições de status

Máquina de estados linear, validada explicitamente por `case/when` (não por tabela de dados):
`pending→confirmed→preparing→ready→completed`; `cancelled` alcançável de qualquer estado não-terminal
via `order_cancel` (nunca via `order_advance_status`). Testado: pular etapa (`pending→completed`
direto), retroceder (`preparing→pending`), reabrir `completed` (avançar ou cancelar) — todos
rejeitados com `invalid_status_transition`.

## RLS e privilégios

`can_view_store_orders(store_id)`: qualquer membro (owner/admin/**staff**) da loja **E** loja
`active` — leitura de pedidos exige loja ativa mesmo para membros (diferente do catálogo da TASK-003,
que não exige; pedidos carregam dados pessoais). `can_manage_store_orders(store_id)`: só owner/admin
**E** loja `active` — usada por `order_advance_status`/`order_cancel`. `authenticated` só tem `SELECT`
em `orders`/`order_items` (sem INSERT/UPDATE/DELETE/TRUNCATE); `anon` não tem GRANT algum em nenhuma
das duas tabelas. Toda mutação exclusivamente via RPC.

Verificado contra Postgres real: DML direto (`INSERT`) em `orders`/`order_items` como `authenticated`
→ `permission denied`. `anon` consultando `orders` → `permission denied`. Loja B não lê nem administra
pedido da Loja A (RLS + `insufficient_privilege`). Staff lê o pedido da própria loja mas é negado ao
tentar avançar status (`insufficient_privilege`). `pending_payment`/`suspended` (mesmo dono, mesma
loja) negados tanto para administrar quanto para **listar** um pedido histórico real da própria loja.

## Rotas públicas

`/loja/[storeSlug]/carrinho`, `/loja/[storeSlug]/checkout`, `/loja/[storeSlug]/pedido/[publicCode]/
sucesso` — todas cobertas pelo prefixo `/loja` já público em `PUBLIC_PATHS`
(`lib/auth/middleware-policy.ts`), nenhuma alteração de middleware necessária. A página de sucesso
**não faz nenhuma consulta ao banco** — só exibe o `publicCode` recebido da resposta do checkout,
garantindo por construção que nenhum dado pessoal/administrativo de qualquer pedido pode vazar ali.

## Rotas administrativas

`/dashboard/orders` (lista, com badges de status) e `/dashboard/orders/[orderId]` (detalhe: dados do
cliente, endereço quando existir, observações, itens/snapshots, ações de transição válidas para o
status atual, cancelar com confirmação). Ambas usam `requireStoreStatus(supabase, "active",
storeSlug)` — mesmo guard da TASK-002/003, sem alteração.

## Carrinho e checkout

`lib/cart/storage.ts` (localStorage puro, chave `cart:<storeSlug>` — isolamento por loja garantido
pela própria chave) + `lib/cart/use-cart.ts` (`useSyncExternalStore`, não `useEffect`+`setState` —
evita cascata de renders e mantém sincronia entre abas/componentes sem Context). Checkout revalida
tudo no servidor (`lib/orders/schemas.ts` + a própria RPC); carrinho só é limpo após sucesso
confirmado (nunca em caso de erro); botão desabilitado durante o envio (`pending` do
`useActionState`).

## Auditoria

5 eventos novos (`order_created`, `order_status_changed`, `order_cancelled`, `order_stock_reserved`,
`order_stock_restored`) — `audit_log_action_check` só ALARGADO. `actor_user_id = auth.uid()` sempre
(NULL para checkout público, nunca escolhido pelo cliente); `store_id`/`target_id` sempre re-derivados
da linha real, nunca do parâmetro cru. Fabricação direta em `audit_log` bloqueada (sem GRANT, mesmo
padrão da TASK-002/003).

## Arquivos criados/modificados

- **Criados**: `supabase/migrations/0006_orders.sql` (+ `.privileges.test.ts`);
  `supabase/tests/orders_isolation_check.sql` (38 cenários), `supabase/tests/order-concurrency-check.ts`;
  `lib/orders/{service,schemas,phone,messages}.ts` (+ testes); `lib/cart/{storage,use-cart}.ts` (+
  teste); `app/loja/[storeSlug]/{add-to-cart-button,cart-badge}.tsx`; `app/loja/[storeSlug]/
  {carrinho,checkout,pedido/[publicCode]/sucesso}/*`; `app/dashboard/orders/**`.
- **Modificados**: `lib/supabase/types.ts` (tabelas/funções/tipos novos); `app/loja/[storeSlug]/
  page.tsx` e `produto/[productSlug]/page.tsx` (carrinho); `app/dashboard/dashboard-nav.tsx` (link
  "Pedidos"); `app/globals.css` (estilos novos); `supabase/tests/migration-upgrade-check.sh` (nova
  fase: upgrade da master atual, com TASK-003 já aplicada, até a TASK-004).

## Resultados reais desta rodada

| Gate | Resultado |
|---|---|
| `npm test` | **338/338** (29 arquivos) |
| `npm run lint` | OK — 0 erros, 3 warnings `no-img-element` pré-existentes (aceitos) |
| `npx tsc --noEmit` / `npm run build` | OK |
| `npm audit` / `--omit=dev` | 0 vulnerabilidades |
| `supabase/tests/isolation_check.sql` (TASK-001 RLS) | 7/7 PASS |
| `supabase/tests/onboarding_isolation_check.sql` (TASK-002) | 56/56 PASS |
| `supabase/tests/catalog_isolation_check.sql` (TASK-003) | 35/35 PASS |
| `supabase/tests/orders_isolation_check.sql` (TASK-004, novo) | **38/38 PASS** |
| `supabase/tests/stock-concurrency-check.ts` (TASK-003, regressão) | 17/17 PASS |
| `supabase/tests/order-concurrency-check.ts` (TASK-004, novo) | **12/12 PASS** — overselling, deadlock, idempotência e cancelamento sob concorrência real |
| `supabase/tests/migration-upgrade-check.sh` | PASS — banco novo e upgrade real desde a master (0001-0005 já aplicadas) até a TASK-004, histórico completo preservado |
| Navegador real — fluxo completo | login → 2 produtos criados/publicados → carrinho (2 itens, quantidade alterada) → checkout (entrega, com endereço) → pedido criado (R$ 70,00) → painel mostra itens/endereço corretos → "Confirmar" avança status → estoque conferido no banco antes/depois |
| Responsivo (375×812 mobile) | sem overflow horizontal em catálogo/carrinho/checkout/painel de pedidos |
| Scan de segredos (bundle `.next/static`) | Nenhuma ocorrência de `SERVICE_ROLE`/`service_role` |

## Limitações e testes não executados

- **Diálogo `window.confirm()` do botão "Cancelar pedido" via navegador automatizado**: o navegador
  headless usado nesta sessão rejeita `window.confirm()` automaticamente (sem suporte a
  aceitar/rejeitar diálogos nativos), então o clique real no botão não completou o fluxo de UI. A
  lógica de cancelamento em si (RPC `order_cancel`) foi validada exaustivamente por outras vias:
  `orders_isolation_check.sql` (Casos 14/20/21), `order-concurrency-check.ts` (cancelamento
  concorrente) e um cancelamento real via `adminA.rpc("order_cancel", ...)` em sessão anterior desta
  mesma branch — o botão em si só invoca essa RPC via Server Action, sem lógica adicional.
- Isolamento de carrinho por loja (localStorage) verificado por teste unitário
  (`lib/cart/storage.test.ts`) e pela própria chave `cart:<storeSlug>` — não retestado manualmente
  navegando entre duas lojas no navegador nesta rodada (mecanismo idêntico ao já provado).
- Falha forçada da auditoria durante `create_order`/`order_cancel` não reproduzida nesta sessão
  (exigiria interromper a transação no meio) — garantida estruturalmente pela função `plpgsql` de
  transação única, mesmo padrão já comprovado por teste real equivalente na TASK-002.
