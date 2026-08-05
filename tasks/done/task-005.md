# TASK-005 — Pix e pagamentos (Mercado Pago, por loja)

**Status:** DONE
**Responsável:** Claude Code
**Branch:** feat/TASK-005-pix-payments (mesclada na master via `git merge --no-ff`, histórico preservado)
**HEAD-base:** 70efe3556753cdbfaa7967ca2b061fdd6126104d (master, TASK-001/002/003/004 DONE)

**Decisões aprovadas por Caraffa (2026-08-04):** Mercado Pago via `POST /v1/payments`; cada loja usa
suas próprias credenciais (sem OAuth, sem split, sem conta global do Caraffa); credenciais cadastradas
manualmente pelo comerciante e criptografadas (AES-256-GCM); reembolso fora do escopo (pedido pago
cancelado só com erro seguro `paid_order_requires_refund`); checkout público passa a exigir Pix
configurado e ativo na loja — pedidos manuais anteriores à TASK-005 são preservados como
`payment_mode = 'manual'`, nunca alterados.

**Aprovação final:** revisão externa (ChatGPT) em 2026-08-05, ver
`qa/reports/TASK-005-FINAL-APPROVAL.md`. Commit testado `e46d8d068126c9c001d92f5f84d7a7799dc48d43`.

## Objetivo

Permitir que o comerciante receba pagamentos Pix reais (Mercado Pago) por pedido, com confirmação
automática via webhook/reconciliação, mantendo o isolamento multi-tenant e a segurança de credenciais.

## Contexto

Terceiro módulo operacional sobre o checkout da TASK-004 — fecha o ciclo "pedido criado → pagamento
cobrado → pagamento confirmado → pedido preparado/entregue" sem exigir reembolso, split ou OAuth
nesta fase (Fase 4, assinaturas do SaaS, é separada e não usa este mesmo fluxo de pagamento por loja).

## Regras de negócio

- Cada loja usa suas próprias credenciais Mercado Pago — nunca uma conta global.
- Checkout público exige Pix configurado e ativo; sem isso, pedido é recusado antes de qualquer
  reserva de estoque.
- Preço/valor sempre vêm do pedido já calculado no banco (TASK-004) — nunca aceitos do cliente nem do
  corpo do webhook.
- Estado real do pagamento é sempre consultado diretamente no Mercado Pago (webhook nunca é
  fonte de verdade sozinho) antes de qualquer transição.
- Aprovado confirma o pedido uma vez, nunca baixa estoque de novo (já reservado na criação).
- Rejeitado/cancelado/expirado cancela o pedido e devolve o estoque exatamente uma vez, só se o
  pedido ainda estiver `pending`.
- Conflito de estado terminal (aprovado depois de cancelado, ou vice-versa) nunca decide sozinho —
  vira `manual_review` com auditoria crítica.
- Pedido pago não pode ser cancelado pelo fluxo comum (sem reembolso nesta tarefa).
- CPF/CNPJ completo nunca é persistido — só tipo + últimos 4 dígitos.

## Critérios de aceitação

- Credenciais por loja criptografadas (AES-256-GCM), nunca devolvidas ao navegador, mascaradas na UI.
- `store_payment_settings`/`order_payments`/`payment_webhook_events` com RLS restritiva: zero acesso
  direto para `anon`/`authenticated` além do necessário (settings sem nenhuma policy; pagamentos só
  owner/admin de loja `active`; eventos só via RPC sanitizada).
- Webhook valida assinatura (HMAC documentado do Mercado Pago) antes de qualquer efeito; idempotente
  sob entrega duplicada e concorrência real.
- Reconciliação usa a mesma função de aplicação de estado do webhook — mesma garantia de idempotência.
- Concorrência real sem duplicar confirmação/cancelamento/baixa/devolução de estoque.
- Regressão completa de TASK-001/002/003/004 (RLS + concorrência) continua passando.

## Áreas afetadas

Banco (`0007_payments.sql`), RLS, RPCs, `lib/payments/*`, checkout (`lib/orders/schemas.ts`,
`app/loja/[storeSlug]/checkout/*`), rota pública `/loja/[storeSlug]/pedido/[publicCode]/pagamento`,
webhook (`app/api/webhooks/mercado-pago`), cron (`app/api/cron/payments/reconcile`), painel
(`/dashboard/settings/payments`, `/dashboard/orders*`), testes.

## Dependências

TASK-001, TASK-002, TASK-003, TASK-004 (pedidos/estoque/carrinho).

## Riscos

Vazamento de credenciais (mitigado por AES-256-GCM + zero RLS pública + módulos server-only
dedicados), webhook forjado (mitigado por validação de assinatura + sempre reconsultar o provedor),
corrida entre webhook/reconciliação/ação administrativa (mitigada por lock de linha em
`order_payments`/`orders`, mesma técnica de `order_cancel` da TASK-004), duplicação de cobrança em
retry (mitigada por idempotency key estável por tentativa).

## Casos de teste

Ver `qa/reports/TASK-005-CLAUDE-VERIFICATION.md` para a lista completa executada.

## Fora do escopo

Cartão, boleto, OAuth Mercado Pago, split, marketplace fee, assinatura, reembolso (total/parcial),
chargeback, disputa, nota fiscal, saque, conciliação financeira avançada, comissão da plataforma, Pix
para mensalidade do SaaS, TASK-006.
