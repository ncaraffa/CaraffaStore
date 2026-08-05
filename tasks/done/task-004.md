# TASK-004 — Carrinho, checkout sem pagamento e gestão de pedidos

**Status:** DONE
**Responsável:** Claude Code
**Branch:** feat/TASK-004-cart-orders (mesclada na master via `git merge --no-ff`, histórico preservado)
**HEAD-base:** 66d9760fc6b3dfa5846b8763d389c45e2b233581 (master, TASK-001/002/003 DONE)

**Decisões aprovadas por Caraffa (2026-08-04):** checkout público sem login de cliente; carrinho só no
navegador (localStorage), tudo revalidado no servidor; sem Pix/pagamento nesta tarefa (pedido criado
como `pending`, comerciante combina o pagamento); estoque reservado/reduzido atomicamente na criação
do pedido, devolvido exatamente uma vez no cancelamento; sem variantes (item referencia um produto
simples da TASK-003).

**Aprovação final:** revisão externa (ChatGPT) em 2026-08-04, ver
`qa/reports/TASK-004-FINAL-APPROVAL.md`. Commit testado `1c890bbc9c21bae311bdc2724ab2f0dd19687b42`.

## Objetivo

Permitir que um visitante monte um carrinho no catálogo público, envie um pedido (sem pagamento
online) e o comerciante visualize e administre esse pedido no painel.

## Contexto

Segundo módulo operacional sobre o catálogo da TASK-003 — fecha o ciclo "visitante encontra produto →
faz pedido → comerciante prepara e entrega/retira", sem depender de Pix (Fase 3 separada).

## Regras de negócio

- Pedido não exige conta de cliente.
- Preço/total sempre recalculados no banco a partir do catálogo real — nunca aceitos do cliente.
- Estoque nunca fica negativo; reserva/baixa acontece atomicamente na criação do pedido.
- Cancelamento devolve o estoque exatamente uma vez; pedidos `completed`/`cancelled` são terminais.
- Reenvio de checkout (duplo clique/refresh/retry) nunca duplica pedido nem baixa estoque duas vezes.

## Critérios de aceitação

- Carrinho isolado por loja, revalidado inteiramente no checkout.
- `orders`/`order_items` com RLS restritiva: sem DML direto para `authenticated`, sem leitura para
  `anon`, leitura só para membro da própria loja (loja `active`), escrita administrativa só para
  owner/admin (loja `active`).
- Máquina de estados linear (`pending → confirmed → preparing → ready → completed`, `cancelled` a
  partir de qualquer não-terminal) sem retrocesso/pulo de etapa/reabertura.
- Concorrência real sem overselling, sem deadlock, idempotência e cancelamento seguros.
- Testes Loja A × Loja B, lint, typecheck, build e QA passam.

## Áreas afetadas

Banco (`0006_orders.sql`), RLS, RPCs, `lib/orders/*`, `lib/cart/*`, rotas públicas `/loja/[storeSlug]/
{carrinho,checkout,pedido/[publicCode]/sucesso}`, rotas administrativas `/dashboard/orders*`, testes.

## Dependências

TASK-001, TASK-002, TASK-003 (catálogo/produtos/estoque).

## Riscos

Overselling sob concorrência, deadlock entre pedidos com produtos em comum, duplicação por
reenvio de checkout, vazamento de dados pessoais do cliente no catálogo público, bypass do guard de
loja `active` via RPC direta (mesma classe de bug corrigida na TASK-003).

## Casos de teste

Ver `qa/reports/TASK-004-CLAUDE-VERIFICATION.md` para a lista completa executada (42 cenários do
roteiro original + regressões TASK-001/002/003).

## Fora do escopo

Pix, Mercado Pago, comprovante/nota fiscal, login de cliente, cupom, frete calculado, integração com
WhatsApp, e-mail automático, reserva com expiração, cron de pedidos, devolução parcial, reembolso,
funcionários, TASK-005.
