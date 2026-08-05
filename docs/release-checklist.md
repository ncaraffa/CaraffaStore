# Checklist de Release

Checklist curto e marcável para o piloto controlado. Detalhes de cada item em
`docs/production-runbook.md`.

## Antes do deploy

- [ ] `npm test` — todos os testes passando.
- [ ] `npm run lint` — sem erros.
- [ ] `npx tsc --noEmit` — sem erros.
- [ ] `npm run build` — build de produção OK.
- [ ] `npm audit` — 0 vulnerabilidades.
- [ ] `npm run release:check` — todas as etapas PASS.
- [ ] Testes SQL de isolamento (TASK-001 a TASK-005) — todos PASS.
- [ ] Testes de concorrência (estoque, pedidos, pagamentos) — todos PASS.
- [ ] `supabase/tests/migration-upgrade-check.sh` — PASS.
- [ ] `git status` limpo, sem segredo nenhum staged.

## Infraestrutura externa (fornecida pelo Caraffa)

- [ ] Conta Vercel (ou host equivalente) criada.
- [ ] Projeto Supabase de produção criado.
- [ ] Domínio próprio apontado e HTTPS ativo.
- [ ] Conta/aplicação Mercado Pago disponível para a loja piloto.
- [ ] E-mail de contato do operador definido (para `/termos` e `/privacidade`).

## Banco de produção

- [ ] Migrations 0001–0007 aplicadas (`npx supabase db push`).
- [ ] `npm run db:verify:production` — todas as checagens PASS.
- [ ] Nenhuma fixture local (`store-a`, `*-fixture`, `@example.test`) presente.
- [ ] Backup inicial confirmado antes da primeira migration (ver `docs/handoff.md`, seção "Backup e
      rollback").

## Variáveis de ambiente

- [ ] `.env.production.example` copiado e todos os placeholders preenchidos com valores reais.
- [ ] `PAYMENT_ENCRYPTION_KEY` gerada nova, exclusiva de produção.
- [ ] `CRON_SECRET` gerado novo, exclusivo de produção.
- [ ] `PAYMENT_GATEWAY_MODE` **ausente** (não definido) em produção.
- [ ] `NEXT_PUBLIC_SITE_URL` = domínio real, https, não-localhost.

## Supabase Auth

- [ ] Site URL configurado com o domínio real.
- [ ] Redirect URLs cadastradas (`/auth/confirm` e variante com `?next=/reset-password`).
- [ ] SMTP de produção configurado (envio real de e-mail).

## Mercado Pago / Webhook / Cron

- [ ] Lojista piloto configurou Access Token real em `/dashboard/settings/payments`.
- [ ] Webhook individual da loja cadastrado no painel do Mercado Pago.
- [ ] Um evento real de Pix testado e refletido no painel de pedidos.
- [ ] Cron de reconciliação agendado (`vercel.json` ou agendador externo) contra
      `/api/cron/payments/reconcile` com `CRON_SECRET`.

## Legal

- [ ] `/termos` e `/privacidade` revisados (placeholders de dados do Caraffa preenchidos ou
      conscientemente mantidos para revisão jurídica posterior).
- [ ] Aviso de "precisa de revisão jurídica" mantido visível até essa revisão acontecer de fato.

## Smoke test em produção

- [ ] Cadastro/login/confirmação de e-mail.
- [ ] Onboarding completo até `pending_payment`.
- [ ] Ativação manual de uma loja piloto (`docs/production-runbook.md`, seção 13).
- [ ] Catálogo, produto, imagem, estoque.
- [ ] Carrinho → checkout → pedido.
- [ ] Pagamento Pix real de valor baixo → `completed`.
- [ ] `/api/health` retorna `200`.
- [ ] `/termos` e `/privacidade` acessíveis.
- [ ] Viewport mobile sem overflow óbvio.

## Pós-deploy

- [ ] Monitor de uptime apontando para `/api/health`.
- [ ] TASK-006 movida para `tasks/review/task-006.md`.
- [ ] `docs/handoff.md` e `docs/roadmap.md` atualizados.
