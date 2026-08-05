# Aprovação final — TASK-004

**Branch:** `feat/TASK-004-cart-orders`
**Commit aprovado (feature branch):** `1c890bbc9c21bae311bdc2724ab2f0dd19687b42`
(`feat(task-004): add cart checkout and order management`)

**Decisão: APROVADA PARA MERGE** (autorização externa registrada no prompt de fechamento desta
sessão — todos os testes críticos e gates abaixo passaram em banco limpo, mesma sessão).

## Escopo entregue

Carrinho público (`localStorage`, isolado por `storeSlug`), checkout sem login/sem pagamento,
criação atômica de pedido (preço/total sempre recalculados no banco), estoque reduzido
atomicamente na criação e devolvido exatamente uma vez no cancelamento, idempotência por
`store_id + idempotency_key` com `request_fingerprint`, locks de produtos em `ORDER BY id`,
máquina de estados linear (`pending → confirmed → preparing → ready → completed`, `cancelled` a
partir de qualquer estado não-terminal), gestão de pedidos no painel, RLS restritiva em
`orders`/`order_items`. Sem Pix/pagamento real. Detalhes de arquitetura em `docs/handoff.md`,
seção "Entrega da TASK-004".

## Criação atômica

Verificado via `supabase/tests/orders_isolation_check.sql` (Casos 1-11): pedido válido em loja
`active` aceito com preço/total do banco; loja `pending_payment`/`suspended` rejeitada
(`store_not_active`); carrinho vazio rejeitado; produto `draft`/`archived`/de outra loja
rejeitado; quantidade zero/negativa/decimal e `product_id` inválido rejeitados
(`invalid_item`); produto esgotado e quantidade acima do estoque rejeitados; entrega sem
endereço rejeitada. Falha em qualquer item não deixa rastro (transação única, sem `order`/
`order_items`/baixa de estoque/auditoria órfãos — confirmado pelo próprio desenho transacional da
RPC, reforçado pelos Casos 2-11 que nunca criam linha nenhuma ao rejeitar).

## Idempotência

Casos 13a-13d: reenvio idêntico (mesma `idempotency_key`/conteúdo) devolve o mesmo pedido sem
duplicar nem baixar estoque de novo; mesma key com conteúdo diferente rejeitada
(`idempotency_conflict`) sem alterar o pedido original. Sob concorrência real
(`order-concurrency-check.ts`): 2 chamadas simultâneas com a mesma key — nenhuma falha, mesmo
pedido retornado, estoque baixado exatamente uma vez.

## Concorrência

`order-concurrency-check.ts`, 12/12 PASS: estoque 5 com 2 pedidos concorrentes de qty=4 —
exatamente 1 sucede, a outra falha com `insufficient_stock`, estoque final 1, exatamente 1 pedido
persistido; 2 pedidos com produtos em comum em ordem invertida — ambos concluem sem deadlock,
estoque de ambos reduzido corretamente; 2 cancelamentos simultâneos do mesmo pedido — exatamente 1
sucede, estoque devolvido exatamente uma vez, exatamente 1 evento `order_cancelled`. A corrida
`completed` × `cancelled` não tem um teste dedicado nesta rodada, mas usa o mesmo mecanismo de
serialização já comprovado empiricamente no teste de duplo-cancelamento: `order_advance_status` e
`order_cancel` fazem `select ... for update` na linha do pedido antes de checar o status
(`0006_orders.sql`, funções `order_advance_status`/`order_cancel`), então as duas chamadas
concorrentes são serializadas pelo lock de linha do Postgres; a segunda, ao adquirir o lock,
relê o status já terminal e rejeita — mesma garantia estrutural validada para cancelamento
duplo.

## Cancelamento e estados

Casos 14a-14c e 15a-15d: cancelamento devolve estoque e marca `cancelled`; segundo cancelamento
rejeitado (terminal); estoque não devolvido duas vezes; `pending → completed` direto rejeitado;
retrocesso (`preparing → pending`) rejeitado; pedido `completed` não pode ser cancelado nem
reaberto. Smoke test real confirmou a cadeia completa `pending → confirmed → preparing → ready →
completed` no painel, sem pular etapa, e um segundo pedido cancelado com devolução de estoque
confirmada em banco (ver "Smoke test" abaixo).

## Isolamento / privacidade

Casos 16-21: admin-b (Loja B) não lê nem administra pedido da Loja A; staff (membro não
owner/admin) lê mas não administra; autenticado sem vínculo não lista nenhum pedido; lojas
`pending_payment`/`suspended` não administram nem listam pedido próprio via RPC/RLS mesmo sendo o
dono. Página pública de sucesso não consulta o banco (só ecoa o `publicCode` recebido do
checkout) — sem vetor de vazamento por manipulação de URL.

## DML direto

Casos 22-24: `INSERT` direto em `orders`/`order_items` como `authenticated` negado (`permission
denied`); `anon` negado ao consultar `orders` (sem nenhum GRANT). Reforçado estaticamente por
`0006_orders.privileges.test.ts` (dentro de `npm test`): `authenticated` só recebe `SELECT` nas
duas tabelas (nenhum GRANT de INSERT/UPDATE/DELETE), `anon` não recebe GRANT algum — como o
schema faz `revoke all` antes de conceder seletivamente, `UPDATE`/`DELETE`/`TRUNCATE` diretos
seguem a mesma negação estrutural já comprovada para `INSERT`. RPCs legítimas (`create_order`,
`order_advance_status`, `order_cancel`) continuam funcionando normalmente durante todo o smoke
test.

## Auditoria

`create_order` grava `order_created`/`order_stock_reserved` na mesma transação;
`order_cancel` grava `order_cancelled`/`order_stock_restored` uma única vez por cancelamento
(Caso 14c/concorrência: nenhuma duplicata); `order_advance_status` registra a transição real.
`audit_log_action_check` só foi alargado (nunca estreitado) — verificado em
`0006_orders.privileges.test.ts`. Proteção de `audit_log` contra UPDATE/DELETE/TRUNCATE herdada
das tarefas anteriores, sem alteração nesta.

## Resultados dos gates (banco limpo, mesma sessão)

| Gate | Resultado |
|---|---|
| `npm test` | **338/338** |
| `npm run lint` | OK — 0 erros, 3 warnings `no-img-element` pré-existentes (aceitos) |
| `npx tsc --noEmit` | OK, 0 erros |
| `npm run build` | OK |
| `npm audit` | 0 vulnerabilidades |
| TASK-001 RLS (`isolation_check.sql`) | **7/7 PASS** |
| TASK-002 SQL (`onboarding_isolation_check.sql`) | **56/56 PASS** |
| TASK-003 SQL (`catalog_isolation_check.sql`) | **35/35 PASS** |
| TASK-004 SQL (`orders_isolation_check.sql`) | **38/38 PASS** |
| Concorrência de estoque/imagens (`stock-concurrency-check.ts`) | **17/17 PASS** |
| Concorrência de pedidos (`order-concurrency-check.ts`) | **12/12 PASS** |
| `migration-upgrade-check.sh` | PASS — banco novo (0001→0006) e upgrade real desde a 0002 (com histórico TASK-002/003/004) |

## Migrations

Banco novo (`supabase db reset`, 0001→0006): sem erro. Upgrade real desde a migration 0002 (com
13 linhas de histórico de auditoria de TASK-002/TASK-003) até a TASK-004: histórico preservado
intacto, as 5 funções de pedidos e as tabelas `orders`/`order_items` presentes após o upgrade,
`audit_log_action_check` alargado sem perda de valor anterior, `authenticated` sem GRANT de
escrita direta — **PASS**.

## Smoke test

Fluxo completo executado no navegador contra Postgres local real (produto `Café Aurora`
publicado para o teste, loja `store-a`/Mercado Aurora):

1. Catálogo público (`/loja/store-a`) → adicionar ao carrinho → alterar quantidade (1→2,
   subtotal recalculado R$ 15,00→R$ 30,00) → checkout (retirada) → pedido criado
   (`5EC54823`) → página de sucesso exibe só o código.
2. Login admin-a → `/dashboard/orders` lista o pedido com os dados corretos → abrir pedido →
   avançar `pending → confirmed → preparing → ready → completed`, uma etapa por vez, sem pular
   nem retroceder — botão "Cancelar pedido" desaparece ao chegar em `completed`.
3. Estoque conferido em banco: 20 → 18 após o pedido concluído (quantidade 2).
4. Segundo pedido criado (`A0A99F34`, quantidade 1, estoque 18→17). Botão "Cancelar pedido" do
   painel usa `window.confirm()` nativo, não aceitável pelo navegador headless desta sessão
   (limitação de ferramenta já documentada em `docs/handoff.md`, não é bug do produto) — o
   cancelamento foi então exercido diretamente via `order_cancel` como `admin-a` autenticado
   (mesma RPC que o botão chama): pedido passou a `cancelled`, estoque devolvido 17→18.
5. Nenhum erro de servidor em nenhum passo (`preview_logs` sem novas ocorrências além dos 4 erros
   pré-existentes de refresh-token expirado de sessão anterior, não relacionados a este fluxo).
6. Mobile (375×812): `/dashboard/orders` sem overflow horizontal (`scrollWidth <=
   clientWidth`).

Banco resetado e re-semeado ao final para devolver o ambiente ao estado limpo.

## Limitações não bloqueantes

- Botão "Cancelar pedido" usa `window.confirm()` nativo — não testável ponta a ponta por
  navegador headless (mesma limitação documentada na entrega original); a RPC em si foi validada
  exaustivamente por SQL, concorrência real e chamada direta.
- Corrida `completed` × `cancelled` validada por inspeção de código (mesmo lock `for update` já
  comprovado no teste de duplo-cancelamento), não por um teste de concorrência dedicado a essa
  combinação específica.
- Sem reserva com expiração, cupom, frete calculado, e-mail/WhatsApp automático, Pix — fora do
  escopo aprovado desta tarefa (Fase 3 separada).

## Decisão

**APROVADA PARA MERGE.** Nenhum deploy realizado nesta sessão.
