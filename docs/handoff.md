# Handoff

## Estado atual

- Fase: 1 — Fundação técnica.
- Código da aplicação: TASK-001 implementada, em `tasks/review/task-001.md`, aguardando QA do Júnior.
- Branch: `feat/TASK-001-multitenant-foundation` (não mesclada na `master`).
- Responsável pela implementação: Claude Code.
- QA: pendente — ver "Instruções para QA" abaixo.

## TASK-001 — resumo da entrega (2026-08-02)

Fundação Next.js + TypeScript + Supabase com contexto de tenant resolvido
no servidor e isolamento entre lojas provado por testes automatizados.

**O que foi implementado:**

- Projeto Next.js 16 (App Router) + TypeScript, com `npm run dev/lint/typecheck/test/build`.
- Schema mínimo (`stores`, `store_members`, `products`) com RLS negada
  por padrão em `supabase/migrations/0001_init.sql` — ver proposta e
  alternativas em `docs/DECISIONS.md` (PROP-001 a PROP-004).
- Resolução de tenant 100% server-side (`lib/tenant/context.ts`): o
  slug na URL só roteia; autorização vem de `auth.uid()` × `store_members`.
  Nenhum `store_id` enviado pelo cliente é usado como prova de autorização
  (testado explicitamente, inclusive tentando injetar `storeId` no corpo
  da requisição).
- Rota de exemplo `/api/stores/[storeSlug]/products` demonstrando o
  padrão ponta a ponta (GET/POST).
- Fixtures de Loja A (Mercado Aurora) e Loja B (Empório Horizonte)
  idênticas a `docs/TESTING.md`.
- 13 testes automatizados (`npm test`) cobrindo toda a matriz de
  isolamento de `docs/TESTING.md`: leitura/escrita permitida dentro da
  própria loja, negada entre lojas, negada para anônimo, negada para
  cliente autenticado sem vínculo, slug forjado rejeitado, `storeId`
  forjado no payload ignorado, e nomes de produto iguais em lojas
  diferentes sem colisão.
- Script de seed local (`scripts/seed-local.ts`, dev-only, service role)
  e `.env.example` sem segredos reais.

**Limitação conhecida:** o ambiente onde a TASK-001 foi implementada não
tem Docker disponível, então `npx supabase start` (Postgres local) não
pôde ser executado aqui. Os 13 testes automatizados provam a camada de
autorização server-side (TypeScript) com repositório em memória — mesmo
contrato (`StoreRepository`) usado em produção. As policies de RLS reais
(`supabase/migrations/0001_init.sql`) ainda **não foram validadas contra
um Postgres real** nesta execução. Isso é a principal pendência de QA.

**Resultados dos gates (executados nesta sessão):**

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | OK, sem erros |
| Typecheck | `npm run typecheck` | OK, sem erros |
| Testes | `npm test` | 13/13 passando |
| Build | `npm run build` | OK, build de produção concluído |

**Dependências não críticas conhecidas:** `npm audit` reporta 3
vulnerabilidades altas em subdependências transitivas de `next`
(sharp/postcss) e `eslint` (`@eslint/plugin-kit`), todas com correção
disponível apenas via downgrade drástico (`next@9.x`) ou fora do range
declarado — não corrigidas nesta entrega para não introduzir regressão.
Revisar quando houver upgrade coordenado dessas dependências.

## Instruções para QA (Júnior)

1. `git checkout feat/TASK-001-multitenant-foundation`
2. `npm install && npm run lint && npm run typecheck && npm test && npm run build` — todos devem passar.
3. Se Docker Desktop estiver disponível: rodar a validação de RLS real —
   `npx supabase start` → `npx supabase db reset` → `npm run seed:local`
   → seguir as instruções no topo de `supabase/tests/isolation_check.sql`
   (substituir os UUIDs pelos impressos pelo seed e rodar com `psql`).
   Esta etapa está pendente e é o principal risco em aberto da TASK-001.
4. Testar manualmente `npm run dev` e a rota `/api/stores/store-a/products`
   e `/api/stores/store-b/products` (requer sessão autenticada — sem
   painel de login nesta tarefa, fora de escopo).
5. Registrar o resultado em `qa/reports/` conforme `AGENTS.md`.
6. Não mover a TASK-001 para `tasks/done/` sem: testes passando, RLS
   validada com Postgres real (item 3) e aprovação de Caraffa para as
   propostas técnicas em `docs/DECISIONS.md`.

## Antes de implementar

Claude Code deve ler `AGENTS.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/SECURITY.md`, `docs/TESTING.md` e a tarefa completa.

## Antes de implementar

Claude Code deve ler `AGENTS.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/SECURITY.md`, `docs/TESTING.md` e a tarefa completa.

## Restrições

- Não ativar cobrança real.
- Não usar credenciais reais.
- Não fazer deploy, merge na `main` ou migração de produção.
- Não inventar benefícios de planos, provedor Pix ou regras de inadimplência.
- Propor decisões estruturais antes de consolidá-las.

## Retorno esperado do Claude Code

- Branch/worktree e resumo dos arquivos alterados.
- Decisões ou dúvidas bloqueadoras.
- Comandos e resultados de testes, lint e build.
- Evidência dos testes de isolamento.
- Riscos restantes e instruções para QA.
