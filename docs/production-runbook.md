# Runbook de Produção

Procedimento operacional para colocar o Commerce Platform em produção (piloto controlado) e operá-lo
no dia a dia. Este documento não substitui `docs/handoff.md` (histórico de decisões técnicas) nem
`docs/release-checklist.md` (checklist curto e marcável) — é o passo a passo detalhado.

**Nenhum valor real (chaves, senhas, domínio, CNPJ) está neste documento.** Todos os pontos que
dependem de dados do Caraffa ou de contas externas estão marcados como `[A DEFINIR]`.

## 1. Pré-requisitos (fornecidos por Caraffa ou criados externamente)

- Conta Vercel (ou host equivalente) com acesso ao repositório.
- Projeto Supabase de **produção** (novo, nunca o local de dev).
- Domínio próprio com DNS configurável.
- Conta/aplicação Mercado Pago (para a loja piloto usar como teste real).
- E-mail de contato do operador da plataforma (para `/termos` e `/privacidade`).
- Dados legais mínimos (razão social/CNPJ/endereço), se disponíveis nesta fase.
- Decisão sobre plataforma de logs externa (opcional — ver `docs/handoff.md`, Fase 8).

## 2. Criar o projeto Supabase de produção

1. Criar um novo projeto no painel Supabase (região próxima ao público-alvo).
2. Anotar: Project Ref, URL do projeto, `anon key`, `service_role key` — nunca compartilhar a
   `service_role key` fora de variáveis de ambiente do servidor.
3. Vincular o CLI local ao projeto (executado manualmente, uma vez, por quem for aplicar as
   migrations — nunca em CI automatizado sem revisão):
   ```bash
   npx supabase link --project-ref <PROJECT_REF>
   ```

## 3. Aplicar as migrations (0001 a 0007)

1. Revisar `supabase/migrations/0001_init.sql` até `0007_payments.sql` (já testadas localmente,
   `supabase/tests/migration-upgrade-check.sh` PASS).
2. Aplicar contra produção:
   ```bash
   npx supabase db push
   ```
3. **Nunca** rodar `npx supabase db reset` contra produção — apaga todos os dados.
4. **Nunca** aplicar `scripts/seed-local.ts` contra produção — o script se recusa a rodar quando
   `NODE_ENV=production` ou quando `NEXT_PUBLIC_SUPABASE_URL` não aponta para um host local
   (`lib/env/local-only-guard.ts`), mas a intenção também não deve ser contornada manualmente.

## 4. Verificar o banco pós-migration (read-only)

Rodar o script de verificação apontando `.env.local`/variáveis de shell para o projeto de produção
(nunca comitar essas variáveis):

```bash
npm run db:verify:production
```

Confirma: tabelas-chave presentes, grants mínimos (anon realmente barrado onde não deveria ler),
funções críticas existentes, bucket `product-images` presente e público, ausência de fixtures locais
conhecidas (`store-a`, `store-b`, `*-fixture`, e-mails `@example.test`). Ver limitações documentadas
no cabeçalho do script — não substitui uma auditoria manual de schema via SQL Editor se houver dúvida.

## 5. Configurar variáveis de ambiente

Copiar `.env.production.example` para a configuração de ambiente do host (Vercel → Project Settings →
Environment Variables), preenchendo cada placeholder com valores reais de produção. Nunca reutilizar
chaves de dev/staging. `lib/env/production-env.ts` (chamado por `instrumentation.ts` no boot) derruba
o processo se qualquer variável obrigatória estiver ausente ou inválida — a mensagem cita só o nome
da variável.

Variáveis obrigatórias em produção: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` (https, não-localhost), `PAYMENT_ENCRYPTION_KEY`,
`CRON_SECRET`. `PAYMENT_GATEWAY_MODE` deve ficar **ausente** (nunca `"fake"`).

## 6. Configurar domínio e HTTPS

1. Apontar o domínio real `[A DEFINIR]` para o projeto na Vercel.
2. Confirmar HTTPS ativo (automático na Vercel para domínios próprios).
3. Definir `NEXT_PUBLIC_SITE_URL=https://<domínio real>`.

## 7. Configurar o Supabase Auth de produção

No painel do projeto de produção → Authentication → URL Configuration:

- **Site URL:** `https://<domínio real>`
- **Redirect URLs** (allowlist exata, mesma usada pela aplicação em `lib/auth/redirects.ts` e pelo
  callback único `app/auth/confirm/route.ts`):
  - `https://<domínio real>/auth/confirm`
  - `https://<domínio real>/auth/confirm?next=/reset-password` (recuperação de senha usa o mesmo
    callback com `next` na query — o GoTrue precisa aceitar a URL completa com querystring)

Também configurar (fora do escopo desta implementação, mas necessário antes do piloto):

- SMTP de produção para envio real de e-mail (local usa Mailpit, nunca envia de verdade).
- CAPTCHA real, se `CAPTCHA_ENABLED=true` for ativado (ver checklist em `docs/handoff.md`).

## 8. Deploy (Vercel)

1. Conectar o repositório ao projeto Vercel (branch de produção = `master`, após merge desta task).
2. Confirmar build de produção local antes do primeiro deploy:
   ```bash
   npm run build
   NODE_ENV=production npm run start
   ```
3. Deploy feito manualmente pelo Caraffa/operador — **este runbook não automatiza deploy**.

## 9. Configurar o Mercado Pago (por loja piloto)

A configuração de credenciais Mercado Pago é feita **pelo próprio lojista**, dentro do painel
(`/dashboard/settings/payments`), não pelo operador da plataforma:

1. O lojista cria uma aplicação no painel do Mercado Pago e obtém o Access Token de produção.
2. Cadastra o Access Token na página de configurações de pagamento da loja (criptografado antes de
   ser salvo — `lib/payments/crypto.ts`).
3. Testa a conexão (botão de teste na própria página) e ativa o Pix da loja.
4. Copia a URL individual do webhook da loja exibida no painel e cadastra no painel do Mercado Pago
   (Notificações → Webhooks) apontando para `https://<domínio real>/api/webhooks/mercado-pago?client=<webhook_key da loja>`.
5. Testa um evento real (ex.: um Pix de valor baixo) e confirma no painel de pedidos que o status
   muda para `completed`/aprovado.

## 10. Configurar o cron de reconciliação

Rota: `POST /api/cron/payments/reconcile`, protegida por `Authorization: Bearer <CRON_SECRET>`.

Na Vercel, usar Vercel Cron (`vercel.json`, já preparado neste repositório) ou, em outro host, um
agendador externo que faça uma requisição `POST`/`GET` autenticada. **Limitação real do plano Hobby da
Vercel:** cron jobs só podem rodar no máximo uma vez por dia — `vercel.json` está configurado para
`0 3 * * *` (03:00 UTC, diariamente). Isso é uma degradação aceita para o piloto: a confirmação de
pagamento continua imediata via webhook (`/api/webhooks/mercado-pago`) na grande maioria dos casos; a
reconciliação diária cobre só os casos em que o webhook falhou ou não chegou. Se o volume do piloto
justificar reconciliação mais frequente, as opções são: (a) upgrade do projeto Vercel para o plano Pro
(libera frequências menores) ou (b) um agendador externo simples (ex.: cron-job.org, GitHub Actions
scheduled workflow) fazendo `POST` autenticado com `CRON_SECRET` na frequência desejada — sem
necessidade de mudar código, só de configurar o novo agendador externo apontando para a mesma rota.
Verificar periodicamente `manual_review` (pagamentos que a reconciliação não conseguiu decidir
sozinha) na tabela `order_payments`/painel de pedidos.

## 11. Smoke test em produção

Ver `docs/release-checklist.md` para a lista curta. Fluxo completo: cadastro → confirmação de e-mail
→ onboarding → loja `pending_payment` → ativação manual (seção 13) → configurar Pix real → catálogo →
carrinho → checkout → pagamento Pix real de valor baixo → pedido `completed` → `/api/health` →
`/termos` e `/privacidade` → viewport mobile.

## 12. Monitoramento

- `/api/health` — checagem simples de app + banco, sem dado sensível. Pode ser usada por um monitor
  de uptime externo (ex.: UptimeRobot, Better Uptime) apontando para
  `https://<domínio real>/api/health`, esperando `200`.
- Falhas de webhook/reconciliação/`manual_review` ficam registradas em `audit_log` (Postgres,
  sanitizado — nunca token/segredo/payload completo) e nos logs do próprio host de deploy (Vercel
  Logs) via `console.error` sanitizado nas rotas relevantes.
- Sem provedor externo de logs configurado nesta fase — ver `docs/handoff.md`, Fase 8, para como
  integrar um futuramente (Vercel Logs já cobre o mínimo: stdout/stderr das funções).

## 13. Ativação manual de loja `pending_payment` → `active`

**Não existe fluxo automatizado de cobrança da mensalidade do SaaS nesta fase** (ver
`docs/handoff.md`/matriz de TASK-006). A ativação é um procedimento manual e deliberado, feito pelo
operador (Caraffa) após confirmar o pagamento da mensalidade fora do sistema (ex.: Pix direto ao
Caraffa). Nunca expor isto como um botão público ou endpoint sem autenticação.

Procedimento seguro (via SQL Editor do painel Supabase, autenticado como o próprio operador, contra o
projeto de produção):

```sql
-- 1. Confirmar a loja e o estado atual antes de qualquer alteração:
select id, slug, name, status from public.stores where slug = '<slug-da-loja>';

-- 2. Só prosseguir se status = 'pending_payment'. Ativar:
update public.stores set status = 'active' where slug = '<slug-da-loja>' and status = 'pending_payment';

-- 3. Confirmar:
select id, slug, status from public.stores where slug = '<slug-da-loja>';
```

Registrar manualmente (fora do banco, ex.: planilha/nota do operador) qual mensalidade foi paga, por
quem e quando — não há auditoria automatizada deste passo específico nesta fase. Automatizar cobrança
recorrente e ativação é trabalho de uma fase futura (Fase 4 do roadmap), fora do escopo desta task.

## 14. Rollback

Ver `docs/handoff.md`, seção "Backup e rollback" (adicionada nesta task), para o procedimento
detalhado de rollback de aplicação, rollback de migration, desativação emergencial do Pix e rotação
de segredos.

## 15. Incidentes de `manual_review`

Pagamentos que a reconciliação não conseguiu decidir sozinha (conflito de estado terminal) ficam em
`manual_review` — nunca são decididos automaticamente. Procedimento:

1. Consultar `order_payments` filtrando `status = 'manual_review'` (ou usar o filtro equivalente no
   painel `/dashboard/orders`).
2. Verificar o pagamento real diretamente no painel do Mercado Pago da loja (usando o Access Token da
   própria loja).
3. Resolver manualmente conforme o estado real observado — este runbook não prescreve uma decisão
   automática porque `manual_review` existe exatamente para os casos ambíguos que não podem ser
   resolvidos por regra fixa.
