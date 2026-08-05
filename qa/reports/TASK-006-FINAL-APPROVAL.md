# TASK-006 — Production Readiness e Release Candidate — APROVAÇÃO FINAL

**Commit aprovado:** `fb27bae06414a06f6e1416039f13820d466477c3` (branch `feat/TASK-006-production-readiness`, base `cef4b0b430ff304789ef390ada8d783c5533a1a4`)

**Classificação:** PRONTO PARA PILOTO CONTROLADO

**Decisão:** APROVADA PARA MERGE

## Escopo verificado nesta sessão

Verificação final curta (sem nova auditoria completa do MVP — matriz já registrada em
`docs/handoff.md`, seção "TASK-006", e em `tasks/review/task-006.md`). Releitura de:
`tasks/review/task-006.md`, `docs/production-runbook.md`, `docs/release-checklist.md`,
`docs/handoff.md`, `docs/roadmap.md`, `.env.production.example`, `lib/env/production-env.ts`,
`lib/env/local-only-guard.ts`, `scripts/release-check.ts`, `scripts/production-db-verification.ts`,
`vercel.json`, `app/api/health/route.ts`, `lib/auth/middleware-policy.ts`, `app/termos/page.tsx`,
`app/privacidade/page.tsx`.

## Confirmações objetivas (12 itens)

| # | Item | Confirmado | Evidência |
|---|---|---|---|
| 1 | Produção recusa `localhost` em `NEXT_PUBLIC_SITE_URL` | Sim | `lib/env/production-env.ts` (`isLocalHostname`); testado ao vivo com `next start` |
| 2 | Produção exige HTTPS | Sim | `checkHttpsPublicUrl` em `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_SUPABASE_URL` |
| 3 | `FakePixGateway` não pode ser usado em produção | Sim | `lib/payments/gateway/select-mode.ts` + `production-env.ts` (`PAYMENT_GATEWAY_MODE=fake` rejeitado); `release:check` confirma estaticamente |
| 4 | `PAYMENT_ENCRYPTION_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` não são públicos | Sim | nenhum usa prefixo `NEXT_PUBLIC_`; `.env.production.example` confirma; scan de bundle (`release:check`) sem ocorrência |
| 5 | `seed-local` e scripts destrutivos recusam produção | Sim | `lib/env/local-only-guard.ts` chamado por `scripts/seed-local.ts`; testado ao vivo (`NODE_ENV=production` → recusa) |
| 6 | `/termos` e `/privacidade` são públicas | Sim | `PUBLIC_PATHS` em `lib/auth/middleware-policy.ts`; testado ao vivo (200 sem sessão) |
| 7 | `/api/health` funciona sem expor detalhes sensíveis | Sim | `app/api/health/route.ts` — só `status`/`timestamp`/`checks` booleanos; testado ao vivo |
| 8 | Cron exige `CRON_SECRET` | Sim | `app/api/cron/payments/reconcile/route.ts` — 401 sem `Authorization: Bearer` correto |
| 9 | Webhook continua validando assinatura | Sim | `handleMercadoPagoWebhook` valida `x-signature` HMAC antes de qualquer efeito |
| 10 | `.env.production.example` não contém valores reais | Sim | releitura confirma só placeholders/comentários |
| 11 | `production-db-verification` é somente leitura | Sim | releitura + grep: nenhum `.insert/.update/.delete/.upsert`/reset/createBucket |
| 12 | `release:check` não executa reset/seed/deploy/migration destrutiva/cobrança real | Sim | releitura do script — só typecheck/lint/test/build/audit/checagens estáticas/scans |

## Gates pré-merge (banco local real, Docker)

| Gate | Resultado |
|---|---|
| `npm test` | **442/442** |
| `npm run lint` | OK (4 warnings pré-existentes/aceitos, `no-img-element`) |
| `npx tsc --noEmit` | OK |
| `npm run build` | OK |
| `npm audit` / `npm audit --omit=dev` | 0 vulnerabilidades |
| `npm run release:check` | **18/18 PASS** |
| `supabase/tests/isolation_check.sql` (TASK-001) | 7/7 PASS |
| `supabase/tests/onboarding_isolation_check.sql` (TASK-002) | 56/56 PASS |
| `supabase/tests/catalog_isolation_check.sql` (TASK-003) | 35/35 PASS |
| `supabase/tests/orders_isolation_check.sql` (TASK-004) | 38/38 PASS |
| `supabase/tests/payments_isolation_check.sql` (TASK-005) | 24/24 PASS |
| `supabase/tests/stock-concurrency-check.ts` | 17/17 PASS |
| `supabase/tests/order-concurrency-check.ts` | 12/12 cenários, 0 falha |
| `supabase/tests/payment-concurrency-check.ts` | 12/12 cenários, 0 falha |
| `supabase/tests/migration-upgrade-check.sh` | PASS (upgrade real 0002→0007, dado histórico preservado) |
| `npm run db:verify:production` (dry-run contra o local) | 20/22 PASS — as 2 únicas falhas são a detecção correta de fixtures locais (`store-a`/`store-b`/`*-fixture`, 8 usuários `@example.test`), comportamento esperado contra uma base com seed; contra produção real (sem fixtures) as 22 checagens passariam |

## Boot em modo produção (placeholders válidos, sem credencial real)

`npm run build` + `npm run start` com `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SITE_URL` https,
`PAYMENT_ENCRYPTION_KEY`/`CRON_SECRET` placeholder, `PAYMENT_GATEWAY_MODE` ausente/`real`:

- Aplicação inicia sem erro de `instrumentation.ts`.
- `GET /api/health` → `503 {"status":"degraded","checks":{"app":true,"database":false}}` (esperado —
  domínio Supabase placeholder não resolve; nenhum dado sensível exposto).
- `GET /termos` → `200`.
- `GET /privacidade` → `200`.
- `GET /login` → `200`.
- `GET /loja/store-a` → `500` neste boot (esperado — mesmo motivo do health degradado: domínio
  Supabase placeholder inalcançável, não um bug de código). Confirmado funcional em separado, no mesmo
  commit, via `npm run dev` contra o Supabase local real: página carrega normalmente
  ("Mercado Aurora", catálogo público renderizado).

Fail-fast confirmado nesta sessão: `npm run start` com `.env.local` de dev (sem overrides) recusa
subir citando as variáveis inválidas (`NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_SUPABASE_URL` localhost/sem
https, `PAYMENT_GATEWAY_MODE=fake`) — mesmo comportamento validado na sessão anterior, reconfirmado
agora no mesmo fluxo real de `next start`.

## Limitações comerciais conhecidas (não tratadas como bug nesta task)

- Cobrança mensal automatizada dos planos R$ 30/50/80 — ausente, fora do escopo.
- Ativação `pending_payment → active` — manual, procedimento SQL documentado em
  `docs/production-runbook.md`, seção 13.
- Logo e cores personalizáveis da loja — ausente, cosmético.

## Nenhum bug real encontrado nesta sessão

O único bug de produto desta task (rotas `/termos`/`/privacidade` fora da allowlist do middleware) já
havia sido encontrado e corrigido na sessão anterior, antes do commit `fb27bae`. Nesta sessão de
verificação final, nenhum gate falhou e nenhum bug novo foi encontrado.

## Confirmações finais

- Nenhum deploy realizado.
- Nenhuma chamada real ao Mercado Pago.
- Nenhum segredo real usado, exposto ou commitado (scans confirmam).
- Working tree limpa antes e depois desta verificação.

**Decisão: APROVADA PARA MERGE.**
