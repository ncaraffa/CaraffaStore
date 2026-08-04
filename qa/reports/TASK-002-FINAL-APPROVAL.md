# TASK-002 — Aprovação final

**Commit aprovado:** `b3540ecc51384818b75b9ff764b5b24d4fb6d185`
**Branch:** `feat/TASK-002-auth-onboarding`
**Data:** 2026-08-04
**Revisão externa:** ChatGPT (processo de fechamento acelerado e condicionado, autorizado nesta data)

## Resumo do escopo entregue

Autenticação e onboarding do comerciante: cadastro com verificação de e-mail obrigatória, login/logout,
recuperação de senha, onboarding persistente e retomável, criação atômica da primeira loja com vínculo
`owner`, seleção de plano (30/50/80) como registro, loja terminando em `pending_payment` (nunca `active`
pelo fluxo público), auditoria mínima append-only, arquitetura preparada para múltiplas memberships.

## Histórico de bugs e correções (rodadas anteriores, não alteradas neste fechamento)

| Rodada | Relatório | Resultado | Bugs principais |
|---|---|---|---|
| 1 | `qa/reports/TASK-002.md` | REPROVADO | guards contornáveis, sessão comum acessando reset, classificação por `next`, auditoria com service role, rate limiting, cobertura SQL |
| 2 | `qa/reports/TASK-002-RETEST.md` | REPROVADO | fabricação direta de recovery grant, confirmação usada como recovery e vice-versa, consumo concorrente, RPCs de auditoria fabricáveis, migration 0004 incompatível |
| 3 | `qa/reports/TASK-002-CLAUDE-VERIFICATION.md` | BLOQUEADOR | sessão comum fabricava fluxo de recuperação (BUG-CLAUDE-001/002/003) |
| 4 | `qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md` | BLOQUEADOR | `password_recovery_completed` gravado antes de `updateUser()` ter sucesso (BUG-CLAUDE-VERIF2-001) |
| 5 | `qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md` | BLOQUEADOR | trigger de conclusão correlacionava só por `user_id`/estado — qualquer troca de senha não relacionada concluía um grant abandonado (BUG-CLAUDE-VERIF3-001) |

## Correção final (commit `b3540ec`)

Fecha BUG-CLAUDE-VERIF3-001: `password_recovery_grants` passa a ser uma linha por TENTATIVA (nunca
sobrescrita — emissão revoga explicitamente a anterior, preservando histórico; índice único parcial garante
no máximo uma tentativa ativa por usuário). A trigger automática de conclusão foi removida por completo e
substituída por `complete_password_recovery_attempt(attempt_id, capability)` — server-only, EXECUTE só
`service_role`, chamada pelo reset action somente depois de `updateUser()` ter sucesso real, exigindo
`attempt_id` + completion capability exatos e prova de que o fingerprint da credencial realmente mudou.
Detalhamento completo em `docs/handoff.md`, seção "Quinta correção pós-QA".

## Comandos executados e totais finais (nesta sessão de fechamento)

| Gate | Comando | Resultado |
|---|---|---|
| Testes unitários | `npm test` | **250/250** (24 arquivos) |
| Lint | `npm run lint` | OK |
| Typecheck | `npx tsc --noEmit` | OK |
| Build | `npm run build` | OK |
| Dependências | `npm audit` / `npm audit --omit=dev` | 0 vulnerabilidades |
| RLS TASK-001 | `supabase/tests/isolation_check.sql` | **7/7 PASS** |
| SQL TASK-002 | `supabase/tests/onboarding_isolation_check.sql` | **41 cenários / 56 asserts, todos PASS** |
| Migrations | `supabase/tests/migration-upgrade-check.sh` | PASS — banco novo e upgrade real desde 0002 (9 eventos históricos preservados intactos) |
| Regressão | `bug-claude-001-regression-check.ts` | PASS |
| Regressão | `bug-claude-verif2-001-regression-check.ts` | PASS |
| Regressão | `bug-claude-verif3-001-regression-check.ts` | PASS |
| Regressão | `auth-flow-purpose-check.ts` | PASS |
| Regressão | `recovery-claim-concurrency-check.ts` | PASS |
| Regressão | `slug-concurrency-check.ts` | PASS |

## Resultado das migrations

- Banco novo (`npx supabase db reset`): todas as migrations aplicam sem erro; funções/tabelas antigas
  ausentes.
- Upgrade desde 0002 (`migration-upgrade-check.sh`): 9 linhas históricas variadas sobrevivem intactas;
  `complete_password_recovery_attempt` e o índice único parcial existem após o upgrade; trigger antiga
  (`on_auth_user_password_changed`) e funções antigas confirmadas ausentes.

## Resultado do smoke test (fluxo real, `npm run start` + Mailpit + navegador)

signup → e-mail de confirmação real (Mailpit) → `/auth/confirm` → onboarding → logout → forgot-password →
e-mail de recuperação real (Mailpit) → `/auth/recovery` → `/reset-password` → nova senha → login com a nova
senha → onboarding. Auditoria confirmada diretamente no Postgres para o usuário de teste
(`smoke-close-task002@example.test`): `email_verification_completed` → `password_recovery_grant_issued` →
`password_recovery_authorization_claimed` → `password_recovery_completed`, todos os três últimos eventos
com o mesmo `attempt_id`, sem duplicação.

## Limitações conhecidas não bloqueantes

- Quirk de exibição `127.0.0.1`/`localhost` no ambiente de preview do agente (já documentado em rodadas
  anteriores) — não é regressão de código; o servidor, `site_url` e cookies estão corretos, confirmado
  via consulta direta ao Postgres em cada verificação. Mitigado abrindo aba nova ancorada em `127.0.0.1`.
- Retry de `complete_password_recovery_attempt` após `updateUser()` ter sucesso é local à requisição (2
  tentativas, sem fila assíncrona) — se ambas falharem, o evento de conclusão fica ausente até
  reconciliação manual; comportamento documentado e deliberado (nunca fabricar um evento falso).
- `revoked_at`/`revoke_reason` só são preenchidos por revogação automática (nova emissão); não existe ainda
  revogação administrativa explícita — fora do escopo da TASK-002.

## Confirmações

- Nenhum segredo no diff, nos logs do `npm run start` ou nos bundles `.next/static` (`SERVICE_ROLE`/
  `service_role` ausentes).
- Nenhum relatório de QA anterior foi alterado (`git diff` vazio para `qa/reports/` neste commit).
- Git limpo antes e depois desta verificação.

## Decisão

**APROVADA PARA MERGE.**

Nenhum deploy foi realizado nesta sessão nem em nenhuma rodada anterior da TASK-002.
