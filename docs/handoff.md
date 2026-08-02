# Handoff

## Estado atual

- Fase: 1 — Fundação técnica.
- Código da aplicação: TASK-001 implementada, correções do QA do Júnior aplicadas, em `tasks/review/task-001.md` — **ainda REVIEW, não DONE**.
- Branch: `feat/TASK-001-multitenant-foundation` (não mesclada na `master`).
- Responsável pela implementação: Claude Code.
- QA: primeira rodada concluída pelo Júnior (`qa/reports/TASK-001.md`, "APROVADO COM RESSALVAS"); correções aplicadas, aguardando reteste — ver "Instruções para QA" abaixo.

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

**Dependências:** `npm audit` e `npm audit --omit=dev` reportam **0
vulnerabilidades** após a correção abaixo (BUG-003).

## Correções aplicadas após o QA do Júnior (2026-08-02)

QA completo em `qa/reports/TASK-001.md` (não alterado — arquivo do
Júnior). Resultado: "APROVADO COM RESSALVAS", com 4 bugs/ressalvas.
Correções desta rodada:

- **BUG-001 — RLS real ainda não validada (ALTO, bloqueado pelo ambiente):**
  não corrigido nesta rodada — continua exigindo Docker Desktop, que não
  está disponível no ambiente de implementação. Ver "Instruções para QA"
  abaixo para o passo a passo exato de validação com Docker.
- **BUG-002 — `supabase/tests/isolation_check.sql` usava `SET LOCAL ROLE`
  fora de transação explícita (MÉDIO):** corrigido. Em modo autocommit,
  cada `SET LOCAL` valia só para o próprio statement e revertia antes do
  próximo — as consultas seguintes rodavam como `postgres` (superusuário,
  ignora RLS), então o script poderia "passar" mesmo com policies
  quebradas. Reescrito com uma transação (`BEGIN`/`ROLLBACK`) envolvendo
  `SAVEPOINT`s por cenário (`SET LOCAL` e `set_config` são transacionais
  e revertem corretamente em `ROLLBACK TO SAVEPOINT`, isolando cada
  simulação de papel sem estado residual entre elas), com asserts
  automáticos (`RAISE NOTICE`/`RAISE EXCEPTION`) e exibição de
  `current_user`/`auth.uid()` antes de cada consulta. Script continua sem
  ter sido executado nesta sessão (sem Docker) — a correção é estrutural,
  a validação real ainda depende do item BUG-001.
- **BUG-003 — 3 vulnerabilidades altas em dependências (MÉDIO):**
  corrigido sem downgrade de `next` e sem `npm audit fix --force`. Ver
  seção "Vulnerabilidades de dependências (BUG-003) — investigação"
  abaixo para o detalhamento completo.
- **BUG-004 — seção "Antes de implementar" duplicada em
  `docs/HANDOFF.md` (BAIXO):** corrigido, duplicata removida.

### Vulnerabilidades de dependências (BUG-003) — investigação

Comandos executados:

```bash
npm audit
npm audit --omit=dev
```

Antes da correção, ambos reportavam as mesmas 3 vulnerabilidades altas
(nenhuma exclusiva de devDependencies):

| Pacote | Caminho | Advisory | Causa raiz |
|---|---|---|---|
| `postcss` | `next` (dependência direta, versão fixa) → `postcss` | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 | `next@16.2.12` fixa `postcss` na versão exata `8.4.31` no seu `package.json` |
| `sharp` | `next` (optionalDependency) → `sharp` | GHSA-f88m-g3jw-g9cj (CVEs de libvips) | `next@16.2.12` declara `sharp: ^0.34.5`, que não alcança a versão corrigida `0.35.0` |
| `next` | dependência direta | herdada de `postcss`/`sharp` acima | `next@16.2.12` é a versão `latest` publicada — não existe versão mais nova do Next.js que corrija isso hoje |

`npm audit fix --force` sugeria instalar `next@9.3.3` (downgrade de 7
major versions) — rejeitado por ser regressão inaceitável, não por falta
de tentativa de correção segura.

**Correção aplicada:** `package.json` → campo `overrides`, forçando
`postcss` e `sharp` para versões patcheadas *somente quando resolvidas
como dependência do `next`*, sem alterar a versão do `next` em si nem
adicioná-los como dependências diretas do projeto:

```json
"overrides": {
  "next": {
    "postcss": "8.5.25",
    "sharp": "0.35.3"
  }
}
```

Ambas são atualizações dentro da mesma linha `8.x`/`0.3x` já usada pelo
`next`, não downgrades nem saltos de major. Após `npm install`:
`npm ls postcss sharp next` confirma `next@16.2.12` (inalterado),
`postcss@8.5.25 overridden`, `sharp@0.35.3 overridden`; `npm audit` e
`npm audit --omit=dev` retornam **0 vulnerabilidades**. Os 4 gates
(lint/typecheck/test/build) foram reexecutados após a mudança e
continuam passando — o build do Next.js (que usa `postcss`
internamente para CSS e `sharp` para otimização de imagem) funciona
normalmente com as versões sobrescritas.

**Afeta runtime ou apenas desenvolvimento?** Ambos os pacotes eram
dependências de runtime do `next` (processamento de CSS e otimização de
imagem em produção), não apenas de build/dev — por isso a correção era
relevante mesmo sem nenhuma feature de upload/imagem implementada ainda
nesta fundação.

## Instruções para QA (Júnior)

1. `git checkout feat/TASK-001-multitenant-foundation` e `git pull`/`git log -1` para confirmar que está no commit mais recente desta rodada de correções.
2. `npm install && npm run lint && npm run typecheck && npm test && npm run build` — todos devem passar.
3. `npm audit && npm audit --omit=dev` — ambos devem retornar 0 vulnerabilidades (confirma BUG-003).
4. Conferir que `docs/HANDOFF.md` não tem mais seção duplicada (BUG-004) — já corrigido, só checar visualmente.
5. **Validação de RLS real com Docker Desktop (BUG-001, ainda pendente — principal risco em aberto):**
   1. Instalar/abrir o Docker Desktop.
   2. `npx supabase start` (sobe Postgres local; na primeira vez baixa as imagens, pode demorar).
   3. `npx supabase db reset` — aplica `supabase/migrations/0001_init.sql`.
   4. `npm run seed:local` — cria Loja A/B e usuários fictícios; **copie os UUIDs de `admin-a` e `admin-b` impressos no final**.
   5. Abrir `supabase/tests/isolation_check.sql` e substituir `SUBSTITUA_PELO_ID_ADMIN_A`/`SUBSTITUA_PELO_ID_ADMIN_B` pelos UUIDs copiados.
   6. Rodar: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/isolation_check.sql`
   7. Esperado: 5 mensagens `NOTICE: PASS - Caso N - ...`, uma por cenário, sem nenhum `ERROR`. Qualquer `ERROR: FAIL - ...` indica uma policy de RLS quebrada e deve ser reportado.
   8. `npx supabase stop` ao terminar (libera os containers).
6. Testar manualmente `npm run dev` e a rota `/api/stores/store-a/products` / `/api/stores/store-b/products` (requer sessão autenticada — sem painel de login nesta tarefa, fora de escopo).
7. Registrar o resultado em `qa/reports/` conforme `AGENTS.md`.
8. Não mover a TASK-001 para `tasks/done/` sem: testes passando, RLS validada com Postgres real (item 5) e aprovação de Caraffa para as propostas técnicas em `docs/DECISIONS.md`.

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
