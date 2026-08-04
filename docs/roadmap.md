# Roadmap

## Fase 0 — Produto e organização

- Definir MVP, arquitetura preliminar e regras de trabalho.
- Propor divisão dos planos para aprovação.
- Manter documentação, Loja A, Loja B e matriz de isolamento.

## Fase 1 — Fundação técnica

- Next.js, TypeScript, Supabase, autenticação, lojas e membros.
- Contexto de tenant, RLS, isolamento, testes e ambientes separados.
- **Fundação multi-tenant: concluída** (TASK-001, `tasks/done/task-001.md`, aprovada em `qa/reports/TASK-001-RETEST-4.md`).
- **Autenticação e onboarding do comerciante: concluída** (TASK-002, `tasks/done/task-002.md`, aprovada em `qa/reports/TASK-002-FINAL-APPROVAL.md`).

## Fase 2 — Loja virtual e painel

- Personalização, produtos, categorias, estoque e loja pública.
- Carrinho, checkout, pedidos e painel do comerciante.
- **Catálogo, produtos, categorias e estoque: concluída** (TASK-003, `tasks/done/task-003.md`,
  aprovada em `qa/reports/TASK-003-FINAL-APPROVAL.md`).
- **Carrinho, checkout sem pagamento e gestão de pedidos: em revisão** (TASK-004,
  `tasks/review/task-004.md`, branch `feat/TASK-004-cart-orders`, aguardando aprovação externa —
  ver `docs/handoff.md`).

## Fase 3 — Pix

- Configuração, cobrança, webhooks, confirmação e idempotência.
- Reserva/baixa de estoque, expiração, logs seguros e testes.

## Fase 4 — SaaS e assinaturas

- Planos de R$ 30, R$ 50 e R$ 80 via Pix.
- Renovação, vencimento, tolerância, suspensão, reativação e superadmin.
- Limites de plano somente após aprovação de Caraffa.

## Fase 5 — Recursos comerciais

- Cupons, banners, avaliações, relatórios, chat, domínio próprio, importação e melhorias visuais.

## Fase 6 — Lançamento

- Segurança, QA completo, políticas, termos, privacidade e backup.
- Monitoramento, onboarding e primeiras lojas piloto.
