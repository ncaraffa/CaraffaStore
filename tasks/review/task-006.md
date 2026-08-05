# TASK-006 — Production Readiness e Release Candidate

**Status:** REVIEW
**Responsável:** Claude Code
**Branch:** feat/TASK-006-production-readiness (não mesclada)
**HEAD-base:** cef4b0b430ff304789ef390ada8d783c5533a1a4 (master, TASK-001/002/003/004/005 DONE)

## Objetivo

Verificar o MVP real contra os requisitos comerciais originais, corrigir bloqueadores locais de
produção, preparar infraestrutura/documentação/scripts de deploy e deixar o projeto pronto para um
deploy controlado (piloto). Não é uma nova fase funcional — nenhuma feature de negócio nova foi
adicionada além de `/termos`/`/privacidade` (Fase 10, requisito explícito da própria task) e do
health check (Fase 9, idem).

## Escopo

- Auditoria do MVP original × implementação real (matriz completa em `docs/handoff.md`, seção
  "TASK-006").
- Validação centralizada de variáveis de ambiente de produção, fail-fast no boot.
- Barreiras contra execução acidental de scripts locais/destrutivos contra produção.
- Revisão de auth/URLs/cookies de produção (um bug real encontrado e corrigido — ver abaixo).
- Preparação para Vercel (`vercel.json`: cron + headers de segurança) e runtime Node.js explícito nas
  rotas sensíveis.
- Health check sanitizado (`/api/health`).
- Termos de Uso e Política de Privacidade (minuta, com placeholders explícitos para dados do Caraffa).
- Backup/rollback documentado, incluindo rotação segura de `PAYMENT_ENCRYPTION_KEY`.
- Runbook de produção e checklist de release.
- Preflight automatizado (`npm run release:check`) e verificação read-only pós-migration
  (`npm run db:verify:production`).

## Fora do escopo (confirmado, não implementado nesta task)

- Cobrança recorrente automatizada da mensalidade do SaaS (planos R$ 30/50/80) — ativação de loja
  continua manual e documentada (`docs/production-runbook.md`, seção 13). Fase 4 do roadmap, ainda não
  iniciada.
- Logo/cores customizáveis da loja.
- Deploy real, push, merge.
- Qualquer chamada real ao Mercado Pago (sem credencial real disponível neste ambiente).
- Reescrita do `FakePixGateway` (limitação de dev conhecida da TASK-005, não bloqueia produção real).

## Decisão de release

**PRONTO PARA PILOTO CONTROLADO.** Matriz completa, correções implementadas e evidência de gates em
`docs/handoff.md`, seção "TASK-006".

## Bug real encontrado e corrigido durante o smoke test

`/termos` e `/privacidade` não estavam na allowlist de rotas públicas do middleware
(`lib/auth/middleware-policy.ts`) — um cliente final anônimo clicando no link do rodapé/checkout era
redirecionado para `/login`. Encontrado ao rodar `next start` real (não só leitura de código) e testar
os links no navegador. Corrigido; regressão coberta em `lib/auth/middleware-policy.test.ts`.

## Resultados dos gates

Ver tabela completa em `docs/handoff.md`, seção "TASK-006" → "Gates executados nesta sessão". Resumo:
442/442 testes, lint/typecheck/build/audit OK, `release:check` 18/18, TASK-001-005 SQL (7+56+35+38+24),
concorrência (17+12+12), migration-upgrade-check PASS, smoke test `NODE_ENV=production` real (recusa
subir com config de dev; sobe com placeholders de produção válidos).

## Bloqueadores externos

Ver `docs/handoff.md`, seção "TASK-006" → "Bloqueadores externos". Nenhum valor real foi colocado no
repositório.

## Próxima ação

Aguardando decisão de Caraffa: seguir para o piloto controlado usando `docs/production-runbook.md`, ou
revisar algum ponto da matriz do MVP antes. Não mover para `tasks/done/` sem essa decisão.
