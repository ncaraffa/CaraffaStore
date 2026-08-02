# Handoff

## Estado atual

- Fase: 1 — Fundação técnica.
- Código da aplicação: TASK-001 implementada; correções de 3 rodadas de QA aplicadas (`qa/reports/TASK-001.md`, `qa/reports/TASK-001-RETEST.md`, `qa/reports/TASK-001-RETEST-2.md`), em `tasks/review/task-001.md` — **ainda REVIEW, não DONE**.
- Branch: `feat/TASK-001-multitenant-foundation` (não mesclada na `master`).
- Responsável pela implementação: Claude Code.
- QA: 1ª rodada — "APROVADO COM RESSALVAS" (`qa/reports/TASK-001.md`); 2ª rodada (RLS com Docker real) — **REPROVADO** (`qa/reports/TASK-001-RETEST.md`, RETEST-BUG-001: GRANTs de tabela ausentes, corrigido); 3ª rodada (reteste final) — RLS **aprovada** (7/7 PASS), mas **REPROVADO** por FINAL-BUG-001: `npm run seed:local` não carregava `.env.local` automaticamente (`qa/reports/TASK-001-RETEST-2.md`). FINAL-BUG-001 corrigido e revalidado nesta sessão — ver "Correção do FINAL-BUG-001" abaixo. **Aguardando o último reteste independente do Júnior** antes de qualquer aprovação.

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

**Atualização (ver seção "Correção do RETEST-BUG-001" abaixo):** Docker
passou a estar disponível no ambiente e a RLS real foi validada contra
Postgres local de fato — a limitação abaixo (texto original desta
entrega) foi superada, mantida aqui só como histórico.

~~**Limitação conhecida:** o ambiente onde a TASK-001 foi implementada não
tem Docker disponível, então `npx supabase start` (Postgres local) não
pôde ser executado aqui. Os 13 testes automatizados provam a camada de
autorização server-side (TypeScript) com repositório em memória — mesmo
contrato (`StoreRepository`) usado em produção. As policies de RLS reais
(`supabase/migrations/0001_init.sql`) ainda não foram validadas contra
um Postgres real nesta execução. Isso é a principal pendência de QA.~~

**Resultados dos gates (rodada mais recente, após correção do
FINAL-BUG-001 — ver detalhamento abaixo):**

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | OK, sem erros |
| Typecheck | `npm run typecheck` | OK, sem erros |
| Testes | `npm test` | **29/29** passando (13 originais + 8 de regressão de privilégios SQL + 8 novos de carregamento de ambiente) |
| Build | `npm run build` | OK, build de produção concluído |
| RLS real (Docker) | `supabase/tests/isolation_check.sql` | 7/7 PASS, em 2 execuções seguidas, em processo limpo |
| Seed real (Docker) | `npm run seed:local` | OK, em processo limpo, sem export manual — ver detalhamento abaixo |

**Dependências:** `npm audit` e `npm audit --omit=dev` reportam **0
vulnerabilidades** (correção BUG-003, confirmada novamente nesta rodada).

## Correções aplicadas após o QA do Júnior (2026-08-02)

QA completo em `qa/reports/TASK-001.md` (não alterado — arquivo do
Júnior). Resultado: "APROVADO COM RESSALVAS", com 4 bugs/ressalvas.
Correções desta rodada (**histórico** — o item BUG-001 abaixo foi
posteriormente concluído quando Docker ficou disponível; ver
"Correção do RETEST-BUG-001" mais abaixo para o estado atual):

- **BUG-001 — RLS real ainda não validada (ALTO, bloqueado pelo ambiente):**
  não corrigido nesta rodada — continua exigindo Docker Desktop, que não
  estava disponível no ambiente de implementação até então. *(Concluído
  posteriormente — ver "Correção do RETEST-BUG-001".)*
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

## Correção do RETEST-BUG-001 (2026-08-02) — GRANTs de tabela ausentes

Reteste independente do Júnior com Docker/Supabase local real
(`qa/reports/TASK-001-RETEST.md`, não alterado — arquivo do Júnior):
**REPROVADO**. `npm run seed:local` falhava com
`permission denied for table stores`; o script de RLS falhava no Caso 1
com `permission denied for table products`, mesmo com
`current_user = authenticated` correto.

### Causa-raiz

A migração habilitava RLS e criava as *policies*, mas nunca concedia os
**GRANTs de tabela** (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) a
`authenticated`/`service_role`. RLS e GRANT são mecanismos independentes:
RLS decide **quais linhas** uma consulta pode ver/alterar; o GRANT decide
**se a operação pode ao menos ser tentada**. Sem o GRANT, o Postgres nega
com "permission denied" antes mesmo de chegar a avaliar qualquer policy.

Diagnóstico confirmado em Postgres real (`information_schema.role_table_grants`
antes da correção): `anon`, `authenticated` e `service_role` tinham apenas
`REFERENCES`, `TRIGGER` e `TRUNCATE` nas três tabelas — concedidos
automaticamente pela própria plataforma Supabase via
`ALTER DEFAULT PRIVILEGES` para toda tabela nova, não por esta migração.
Nenhum desses três é suficiente para a aplicação funcionar, e **`TRUNCATE`
é particularmente grave: ignora RLS por completo** e permitiria a
qualquer usuário autenticado apagar a tabela inteira de uma vez.

### GRANTs e REVOKEs adicionados (`supabase/migrations/0001_init.sql`)

```sql
grant usage on schema public to anon, authenticated, service_role;

revoke all on public.stores, public.store_members, public.products
  from public, anon, authenticated, service_role;

-- anon: nenhum GRANT (sem storefront público nesta fundação).

grant select on public.stores to authenticated;
grant select on public.store_members to authenticated;
grant select, insert, update, delete on public.products to authenticated;

grant select, insert, update, delete
  on public.stores, public.store_members, public.products
  to service_role;
```

- `anon`: revogado tudo, **zero GRANTs** concedidos de volta — confirmado
  na consulta pós-correção (nenhuma linha para `anon` em
  `role_table_grants` nas três tabelas).
- `authenticated`: exatamente as operações com policy de RLS
  correspondente — `SELECT` em `stores`/`store_members` (só há policy de
  leitura nelas), `SELECT`/`INSERT`/`UPDATE`/`DELETE` em `products`
  (mesmas 4 policies existentes).
- `service_role`: `SELECT`/`INSERT`/`UPDATE`/`DELETE` nas três tabelas —
  uso administrativo/seed local (`scripts/seed-local.ts`), nunca a partir
  de uma requisição de usuário (`lib/supabase/admin.ts`/`env.ts` já
  impediam isso antes desta correção). Sem `TRUNCATE`/`REFERENCES`/`TRIGGER`
  residuais.
- Sequences: não há colunas `serial`/`identity` nesta migração (todas as
  PKs são `uuid` + `gen_random_uuid()`) — item não se aplica, documentado
  explicitamente no SQL.
- Funções `SECURITY DEFINER` (`is_store_member`/`is_store_admin`):
  `search_path` endurecido de `public` para `''` (vazio) — sem mudança de
  comportamento, pois todas as referências internas já eram qualificadas
  com `public.`; `EXECUTE` continua restrito a `authenticated`
  (já revogado de `public` desde a versão anterior).
- **Teste de regressão novo:** `supabase/migrations/0001_init.privileges.test.ts`
  (8 casos, roda em `npm test`, não depende de Docker) — análise estática
  do SQL versionado, garante que os GRANTs/REVOKEs mínimos, a ausência de
  `TRUNCATE`, o `search_path` vazio e a ausência de GRANT a `anon`
  continuam presentes em edições futuras da migração.

### Resultado do seed (após a correção, Postgres real)

`npm run seed:local` concluído com sucesso — Loja A, Loja B, 4 usuários
fictícios, memberships e os 2 produtos de fixture criados sem erro
(antes: `permission denied for table stores`).

### Resultado dos 7 casos de RLS real (Postgres real, via Docker)

`supabase/tests/isolation_check.sql` agora tem **7 cenários** (foram
adicionados o Caso 5 e o Caso 6 nesta rodada, para cobrir explicitamente
a simetria B→A por escrita e o bloqueio de usuário autenticado sem
vínculo, que o reteste do Júnior apontou como não alcançados):

| Caso | Cenário | Resultado |
|---|---|---|
| 1 | Admin A lê produto da própria loja | PASS |
| 2 | Admin A não lê produto da Loja B | PASS |
| 3 | Admin A não insere produto na Loja B (`store_id` forjado) | PASS |
| 4 | Admin B não lê produto da Loja A | PASS |
| 5 | Admin B não insere produto na Loja A (`store_id` forjado, simetria do 3) | PASS |
| 6 | Cliente autenticado sem vínculo de staff não lê produtos da Loja A | PASS |
| 7 | Anônimo não lê produtos nem lojas | PASS |

**7/7 PASS**, executado por `docker exec -i <container_postgres> psql ... -f supabase/tests/isolation_check.sql`, saída `ROLLBACK` final, exit code `0`.

### Segunda execução (repetibilidade / ausência de estado residual)

Script executado uma segunda vez, sem `db reset` entre as execuções:
resultado idêntico, **7/7 PASS**, exit code `0`. Contagem de linhas antes
e depois: 2 lojas, 2 produtos (fixtures), **0 produtos forjados** — nada
persistiu de nenhuma das duas execuções.

### Confirmações explícitas (todas verificadas contra Postgres real)

- `service_role` consegue realizar o seed — sim.
- `authenticated` alcança as policies de RLS (não é mais bloqueado antes
  delas) — sim.
- Loja A não lê nem altera Loja B — sim (Casos 2 e 3).
- Loja B não lê nem altera Loja A — sim (Casos 4 e 5).
- Usuário autenticado sem vínculo é bloqueado — sim (Caso 6).
- Anônimo é bloqueado — sim (Caso 7).
- `store_id` forjado é bloqueado — sim (Casos 3 e 5).
- Nenhuma função `SECURITY DEFINER` permite contornar o isolamento —
  `is_store_member`/`is_store_admin` só retornam verdadeiro com uma linha
  real em `store_members` casando `auth.uid()`; todos os casos que
  dependem delas (1 a 6) se comportaram como esperado.
- Nenhum segredo foi versionado — `.env.local` usado nesta validação
  tinha as chaves de demonstração padrão do Supabase local (as mesmas
  documentadas publicamente pela própria ferramenta para todo `supabase start`,
  não específicas deste projeto) e está no `.gitignore`; `git status`
  confirmado limpo após o commit desta correção.
- Git limpo após o commit — confirmado.

## Correção do FINAL-BUG-001 (2026-08-02) — `.env.local` não carregado pelo seed

Terceiro reteste independente do Júnior
(`qa/reports/TASK-001-RETEST-2.md`, não alterado — arquivo do Júnior):
**REPROVADO**, mas apenas por este item — RLS real (7/7 PASS em duas
execuções + 4/4 testes cross-tenant adicionais), 21/21 testes, build e
audits já estavam todos aprovados.

### Causa-raiz

`npm run seed:local` executa `tsx scripts/seed-local.ts`. Diferente de
`next dev`/`next build`/`next start` — que chamam `loadEnvConfig`
internamente antes de qualquer código da aplicação rodar —, `tsx` não
carrega `.env.local` sozinho. O script só lia `process.env` diretamente
(`lib/supabase/env.ts`), então funcionava apenas se as variáveis já
estivessem exportadas manualmente no shell antes do comando, contrariando
o fluxo documentado (`.env.local` + `npm run seed:local`).

### Arquivos alterados

- **`lib/env/load-local-env.ts`** (novo): wrapper de `loadEnvConfig` de
  `@next/env` — a mesma função que `next dev`/`build`/`start` usam
  internamente, já disponível como dependência transitiva do `next`
  (`16.2.12`) e agora declarada explicitamente em `devDependencies` na
  mesma versão. Só é importado por `scripts/seed-local.ts`; nenhuma rota
  ou módulo do app o importa.
- **`scripts/seed-local.ts`**: chama `loadLocalEnv()` como primeira ação
  de `main()`, antes de criar o cliente admin. Imprime
  `Ambiente carregado de: <arquivos>` quando encontra algo.
- **`lib/supabase/env.ts`**: mensagens de erro agora citam o(s) nome(s)
  exato(s) da(s) variável(is) ausente(s)/inválida(s) (via
  `parsed.error.issues`, só os *nomes* dos campos — nunca
  `issue.message`/valor), em vez de um texto genérico.
- **`package.json`**: `@next/env` adicionado a `devDependencies`, fixado
  em `16.2.12` (mesma versão do `next` já usado).
- **`lib/env/load-local-env.test.ts`** e **`lib/supabase/env.test.ts`**
  (novos, 8 testes): regressão do carregador e das mensagens sanitizadas.

### Mecanismo e precedência aplicada

`loadEnvConfig(dir, dev, log, forceReload)` do `@next/env` — mesma
precedência documentada do Next.js: variáveis já presentes em
`process.env` **nunca** são sobrescritas por arquivo; entre arquivos, a
ordem é `.env.$(NODE_ENV).local` → `.env.local` (pulado apenas se
`NODE_ENV=test`) → `.env.$(NODE_ENV)` → `.env`. Puro Node.js
(`fs`/`path`), sem nada específico de shell — funciona igual no Windows.
`dir` é `process.cwd()` por padrão, igual ao Next.js (raiz do projeto de
onde o comando é rodado).

### Resultado do seed em processo limpo (Docker real)

Fluxo completo executado do zero, sem nenhuma variável `SUPABASE`/`NEXT_PUBLIC` pré-exportada (confirmado com `env | grep SUPABASE` antes de começar):

```text
npx supabase stop --no-backup
npx supabase start
npx supabase db reset
# .env.local criado com as credenciais impressas pelo start
npm run seed:local
```

Saída: `Ambiente carregado de: .env.local` seguida de
`Seed local concluído.`, **exit code 0**, sem nenhuma exportação manual.
Executado uma segunda vez sem alterações: mesmos IDs, mesmo resultado —
`ensureUser`/`ensureStore` reaproveitam registros existentes e
`ensureMembership`/`ensureProduct` usam `upsert`, então o script é
idempotente.

### Resultado quando `.env.local` está ausente

`.env.local` removido e `npm run seed:local` executado novamente:

```text
Error: Variável(is) de ambiente ausente(s) ou inválida(s): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY. Copie .env.example para .env.local e preencha com valores do seu Supabase local (nunca de produção).
```

**Exit code 1**, nomeia exatamente as duas variáveis ausentes, nenhum
valor exposto (não havia nenhum, mas a mensagem também nunca ecoaria um
valor inválido presente — coberto pelos testes de regressão).

### RLS real (após a correção, mesmo fluxo limpo)

Script `supabase/tests/isolation_check.sql` (7 cenários) executado duas
vezes seguidas contra o Postgres deste mesmo fluxo limpo:
**7/7 PASS** em ambas, exit code `0`, sem `ERROR`, sem estado residual
(2 lojas, 2 produtos, 0 forjados após as duas execuções).

### Gates (mesma sessão, após a correção)

Lint, typecheck, **29/29 testes** (21 anteriores + 8 novos:
`load-local-env.test.ts` e `env.test.ts`), build, `npm audit` e
`npm audit --omit=dev` — todos OK / 0 vulnerabilidades.

### Segurança

Nenhum segredo real usado ou versionado — `.env.local` desta validação
usava as chaves de demonstração padrão que o próprio `supabase start`
imprime (públicas, iguais em qualquer instalação local da ferramenta) e
foi removido ao final; `git check-ignore .env.local` confirmado; `git
status` limpo após o commit desta correção; `.env.local` nunca é lido
por nenhuma rota da aplicação (só por `scripts/seed-local.ts`).

## Instruções para o (último) reteste independente do Júnior

1. `git checkout feat/TASK-001-multitenant-foundation` e `git log -1` para confirmar o commit desta correção (hash no final deste documento).
2. `npm install && npm run lint && npm run typecheck && npm test && npm run build` — todos devem passar (29/29 testes).
3. `npm audit && npm audit --omit=dev` — ambos devem retornar 0 vulnerabilidades.
4. **Fluxo completo com Docker Desktop, em processo/terminal novo:**
   1. Confirmar que nenhuma variável `SUPABASE`/`NEXT_PUBLIC` está exportada manualmente (`env | grep -i SUPABASE`, ou `Get-ChildItem Env:` no PowerShell, deve vir vazio).
   2. `npx supabase stop --no-backup` (só se já houver uma instância local de uma sessão anterior).
   3. `npx supabase start`.
   4. `npx supabase db reset` — aplica `supabase/migrations/0001_init.sql`.
   5. Copiar `.env.example` para `.env.local` e preencher com a `API_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY` impressas pelo `supabase start`.
   6. `npm run seed:local` **direto, sem exportar nada manualmente** — deve imprimir `Ambiente carregado de: .env.local` e terminar com exit code `0`. **Este é o ponto que reprovou na rodada anterior.**
   7. Rodar `npm run seed:local` de novo, sem alterar nada — deve terminar igual (idempotente).
   8. **copie os UUIDs de `admin-a`, `admin-b` e `cliente-a` impressos no final** e edite `supabase/tests/isolation_check.sql` (ou uma cópia fora do repositório) substituindo `SUBSTITUA_PELO_ID_ADMIN_A`/`SUBSTITUA_PELO_ID_ADMIN_B`/`SUBSTITUA_PELO_ID_CLIENTE_A`.
   9. Rodar: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/isolation_check.sql` (ou `docker exec -i supabase_db_commerce-platform-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < arquivo.sql`, se `psql` não estiver instalado localmente).
   10. Esperado: **7 mensagens `NOTICE: PASS - Caso N - ...`**, sem nenhum `ERROR`, exit code `0`.
   11. Rodar o mesmo comando uma segunda vez, sem `db reset` entre as execuções — resultado deve ser idêntico.
   12. Remover `.env.local` e rodar `npm run seed:local` mais uma vez — deve falhar com exit code diferente de `0`, citando pelo nome as variáveis ausentes, sem expor nenhum valor.
   13. `npx supabase stop` ao terminar.
5. Testar manualmente `npm run dev` e a rota `/api/stores/store-a/products` / `/api/stores/store-b/products` (requer sessão autenticada — sem painel de login nesta tarefa, fora de escopo).
6. Registrar o resultado em `qa/reports/` conforme `AGENTS.md`.
7. Não mover a TASK-001 para `tasks/done/` sem: todos os itens acima aprovados de forma independente e aprovação de Caraffa para as propostas técnicas em `docs/DECISIONS.md`.

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
