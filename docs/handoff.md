# Handoff

## Estado atual

- Fase: 1 — Fundação técnica.
- **TASK-001: DONE.** Aprovada no reteste final do Júnior
  (`qa/reports/TASK-001-RETEST-4.md`, 2026-08-03, commit testado
  `83b2e6421370f07e42516fd8c5d0ac62c5f1c061`) e mesclada na `master` via
  `git merge --no-ff` (histórico de implementação/correções/QA
  preservado, sem squash). Arquivo da tarefa em `tasks/done/task-001.md`.
  Branch `feat/TASK-001-multitenant-foundation` preservada (não
  excluída).
- Responsável pela implementação: Claude Code.
- Histórico de QA (5 rodadas até a aprovação):
  1. `qa/reports/TASK-001.md` — "APROVADO COM RESSALVAS" (4 ressalvas).
  2. `qa/reports/TASK-001-RETEST.md` — **REPROVADO** (RETEST-BUG-001: GRANTs de tabela ausentes; corrigido).
  3. `qa/reports/TASK-001-RETEST-2.md` — RLS **aprovada** (7/7), **REPROVADO** por FINAL-BUG-001 (`.env.local` não carregava automaticamente; corrigido).
  4. `qa/reports/TASK-001-RETEST-3.md` — RLS/seed/29 testes/gates/audits **aprovados**, **REPROVADO** por FINAL-BUG-002 (senha de dev impressa nos logs do seed; corrigido).
  5. `qa/reports/TASK-001-RETEST-4.md` — **APROVADO**, sem ressalvas: 36/36 testes, lint, typecheck, build, `npm audit`/`npm audit --omit=dev` (0 vulnerabilidades), seed idempotente sem vazamento em 2 execuções, RLS real 7/7 PASS em 2 execuções sem estado residual, falha sem `.env.local` sanitizada, Git limpo, nenhum bloqueador restante.
- **Próxima tarefa recomendada: TASK-002 — Autenticação e onboarding do
  comerciante** (`tasks/backlog/task-002.md`, depende da fundação
  multi-tenant desta TASK-001). Ainda em `BACKLOG`, não implementada
  nesta sessão — segue o processo normal de `AGENTS.md` (Júnior refina e
  move para `tasks/ready/` antes de Claude Code implementar).

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
FINAL-BUG-002 — ver detalhamento abaixo):**

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | OK, sem erros |
| Typecheck | `npm run typecheck` | OK, sem erros |
| Testes | `npm test` | **36/36** passando (29 anteriores + 7 novos de não-vazamento de credenciais no seed) |
| Build | `npm run build` | OK, build de produção concluído |
| RLS real (Docker) | `supabase/tests/isolation_check.sql` | 7/7 PASS, em 2 execuções seguidas, em processo limpo |
| Seed real (Docker) | `npm run seed:local` | OK, 2 execuções idênticas (idempotente), sem export manual, sem nenhuma credencial na saída — ver detalhamento abaixo |

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

## Correção do FINAL-BUG-002 (2026-08-03) — senha de dev exposta nos logs do seed

Quarto reteste independente do Júnior
(`qa/reports/TASK-001-RETEST-3.md`, não alterado — arquivo do Júnior):
**REPROVADO**, mas apenas por este item — `.env.local` carregado
automaticamente, seed idempotente, RLS 7/7 PASS em duas execuções, 29/29
testes, lint, typecheck, build e audits já estavam todos aprovados.

### Causa exata

`scripts/seed-local.ts`, última linha de `main()`, imprimia a constante
`DEV_ONLY_PASSWORD` diretamente:

```ts
console.log(`\nSenha de dev (não usar fora do ambiente local): ${DEV_ONLY_PASSWORD}`);
```

Essa senha só existe para satisfazer o parâmetro obrigatório `password`
do `admin.auth.admin.createUser(...)` do Supabase Auth ao criar os
usuários fictícios locais — nunca precisava ser exibida.

Verificações adicionais pedidas pelo roteiro (item "antes de alterar"):

- **Outro log que pudesse revelar credenciais:** o `catch` final de
  `main()` fazia `console.error(error)`, imprimindo o objeto de erro
  completo. Nenhuma chamada atual joga um segredo dentro de um `Error`,
  mas um objeto de erro de uma lib HTTP *poderia* carregar detalhes de
  requisição (ex.: um `Authorization: Bearer <service_role_key>`) em uma
  propriedade extra — `console.error(error)` imprimiria isso junto.
  Corrigido por precaução (ver abaixo), mesmo sem uma ocorrência real
  identificada — é o mesmo tipo de vazamento pedido para investigar.
- **Objetos completos de usuário do Supabase Auth:** nenhuma chamada
  atual imprime `data.user`/`existing.users` — confirmado, nada a
  corrigir aqui.
- **Valores de ambiente em stack traces:** as únicas mensagens de erro
  lançadas pelo próprio script (`ensureUser`/`ensureStore`) usam só
  `error?.message` (texto, nunca o objeto/valor); a validação de env
  (`lib/supabase/env.ts`) já cita apenas nomes de variável desde o
  FINAL-BUG-001.

### Arquivos alterados

- **`scripts/seed-output.ts`** (novo): duas funções pequenas e
  reutilizáveis.
  - `logSeedSummary(ids)` — a assinatura só aceita identificadores não
    sensíveis (UUIDs, e-mails via fixtures); não há parâmetro por onde
    uma senha/token passaria, nem por engano numa edição futura.
  - `logSeedFailure(error)` — imprime só `error.message` (ou
    `String(error)` para não-`Error`), nunca o objeto/propriedades
    extras.
- **`scripts/seed-local.ts`**: `main()` agora chama `logSeedSummary(...)`
  em vez de uma sequência de `console.log` com a senha no final;
  `main().catch(...)` chama `logSeedFailure(error)` em vez de
  `console.error(error)`. `DEV_ONLY_PASSWORD` continua existindo (ainda
  necessária para `createUser`), só não é mais impressa em lugar nenhum.
- **`scripts/seed-output.test.ts`** (novo, 7 testes): regressão do
  não-vazamento — ver abaixo.

### O que deixou de ser impresso

- A senha de desenvolvimento (`DEV_ONLY_PASSWORD`) — completamente,
  sem substituição por máscara parcial.
- O objeto de erro completo no `catch` final (agora só a mensagem).

### O que continua sendo impresso (não sensível)

- `Ambiente carregado de: .env.local` (nome do arquivo, nunca o
  conteúdo).
- `Seed local concluído.`
- Os 6 UUIDs (admin-a, admin-b, cliente-a, cliente-b, store-a, store-b),
  necessários para preencher `supabase/tests/isolation_check.sql`.
- Os e-mails fictícios (`admin-a@example.test` etc.) e os nomes lógicos
  `admin-a`/`admin-b`/`cliente-a`/`cliente-b`.

### Testes de regressão (`scripts/seed-output.test.ts`, 7 casos)

Capturam a saída real de `logSeedSummary`/`logSeedFailure` via
`vi.spyOn(console, "log"/"error")` — não dependem de Docker nem checam
strings de documentação, testam o que a função realmente imprime:

1. senha de dev, anon key e service role key (valores conhecidos/fake)
   nunca aparecem na saída de sucesso;
2. nenhum padrão `password|secret|service_role|bearer|authorization`
   aparece na saída de sucesso;
3. `logSeedFailure` com um `Error` que carrega um token vazado numa
   propriedade extra (`error.config.headers.Authorization`) — só a
   mensagem aparece, o token e a palavra "Bearer" não;
4. `logSeedFailure` com um valor que não é `Error` (objeto solto com uma
   propriedade `token`) também não vaza essa propriedade;
5. os 6 UUIDs e os nomes `admin-a`/`admin-b`/`cliente-a` continuam
   presentes e identificáveis na saída;
6. a saída de sucesso contém "Seed local concluído" sem nenhuma
   credencial conhecida;
7. guarda estática: o código-fonte de `scripts/seed-local.ts` não tem
   nenhuma linha com `console.*` referenciando `DEV_ONLY_PASSWORD` —
   trava contra reintrodução acidental do vazamento original.

### Validação real (Docker, processo limpo, sem export manual)

Mesmo fluxo das rodadas anteriores (`stop --no-backup` → `start` →
`db reset` → `.env.local` novo → `npm run seed:local`), com a saída de
**ambas** as execuções capturada em arquivo e verificada com `grep -iE
"password|secret|service_role|bearer|authorization|dev-local-only-not-a-real-secret"`
e busca literal pelo prefixo JWT das chaves reais (`eyJhbGci...`):
**nenhuma ocorrência** em nenhum dos dois logs, confirmando tanto
manualmente (leitura direta) quanto automaticamente (grep).

- Seed execução 1: exit `0`, `Ambiente carregado de: .env.local`, 6
  UUIDs impressos, nenhuma credencial.
- Seed execução 2: exit `0`, saída **idêntica** à execução 1 (`diff`
  confirmou) — idempotente.
- RLS execução 1: **7/7 PASS**, exit `0`.
- RLS execução 2 (sem `db reset`): **7/7 PASS**, exit `0`, sem estado
  residual.
- Gates: lint, typecheck, **36/36 testes**, build — todos OK.
- `npm audit` e `npm audit --omit=dev`: **0 vulnerabilidades**.
- `.env.local` removido e `npm run seed:local` executado de novo: exit
  `1`, `Seed local falhou: Variável(is) de ambiente ausente(s) ou
  inválida(s): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY.
  ...` — cita só os nomes, nenhum valor, e agora nem mostra mais o stack
  trace completo (efeito colateral positivo de `logSeedFailure`).

### Segurança

`.env.local` desta validação usava as chaves de demonstração padrão que
o próprio `supabase start` imprime (públicas, iguais em qualquer
instalação local da ferramenta), removido ao final;
`git check-ignore .env.local` confirmado; `git status` limpo após o
commit desta correção.

## Encerramento da TASK-001 (2026-08-03)

**Aprovação final:** `qa/reports/TASK-001-RETEST-4.md` (não alterado —
arquivo do Júnior), **APROVADO**, commit testado
`83b2e6421370f07e42516fd8c5d0ac62c5f1c061`. Nenhuma ressalva ou
bloqueador restante. Não há aviso do tipo "Exec failed" nesse relatório
representando um teste obrigatório reprovado — confirmado por leitura
integral antes do encerramento.

Evidência consolidada da aprovação:

- 36/36 testes, lint, typecheck e build aprovados.
- `npm audit` e `npm audit --omit=dev`: 0 vulnerabilidades.
- Seed (`npm run seed:local`) aprovado em duas execuções: idempotente,
  `.env.local` carregado automaticamente sem export manual, nenhum
  segredo (senha/anon key/service role key/token/cookie/connection
  string) em nenhum dos dois logs — inspeção manual e automática
  (`grep`).
- RLS real (`supabase/tests/isolation_check.sql`) — **7/7 PASS** em
  duas execuções seguidas, sem `db reset` entre elas, sem estado
  residual.
- Falha sem `.env.local`: controlada e sanitizada (só nomes de
  variável, sem valor, sem stack trace).
- Git limpo antes e depois do reteste; nenhuma credencial versionada.

**Ação:** TASK-001 movida para `tasks/done/task-001.md` (status `DONE`)
e branch `feat/TASK-001-multitenant-foundation` mesclada na `master`
via `git merge --no-ff` (sem squash — histórico de implementação,
correções e QA preservado). Branch da tarefa **não** excluída. Nenhum
deploy realizado.

## Próximos passos

- **TASK-002 — Autenticação e onboarding do comerciante**
  (`tasks/backlog/task-002.md`): próxima tarefa recomendada, depende
  diretamente da fundação multi-tenant desta TASK-001. Segue o processo
  normal de `AGENTS.md` — Júnior refina e move para `tasks/ready/`
  antes de qualquer implementação.
- Propostas técnicas registradas em `docs/DECISIONS.md` (PROP-001 a
  PROP-004) seguem aguardando aprovação explícita de Caraffa antes de
  novas tarefas se apoiarem nelas como decisão consolidada.

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

## Verificação administrativa pós-merge da TASK-001 (2026-08-03)

Verificação independente, sem alteração de código e sem deploy:

- branch atual: `master`;
- HEAD confirmado: `db0ed437804acc67c08f971b69ebdaf6ab7fb0a6`;
- commit de encerramento informado: `9d4e6f5300347051c760f2d7e420114af4294015`;
- commit de merge informado: `04f8ea44486de1894257ea8e700aa8b0dfe544ce`;
- `tasks/done/task-001.md`: presente e com status `DONE`;
- `qa/reports/TASK-001-RETEST-4.md`: presente;
- `docs/ROADMAP.md`: fundação multi-tenant marcada como concluída;
- este handoff já continha encerramento, evidências e histórico da TASK-001;
- Git status: limpo no início da preparação da TASK-002;
- deploy: não realizado.

## Preparação da TASK-002 — autenticação e onboarding (2026-08-03)

A TASK-002 foi refinada integralmente e promovida para `tasks/ready/task-002.md`, cobrindo autenticação, recuperação, verificação de e-mail, onboarding persistente, criação atômica da loja/owner/plano/auditoria, slug, registro inicial dos planos R$ 30/R$ 50/R$ 80 sem cobrança, estados da loja, redirecionamentos, múltiplos memberships, auditoria, isolamento e testes negativos.

**Estado: READY.** Caraffa aprovou integralmente as decisões 1 a 10 e aprovou a decisão 11 com política de senha reforçada. As decisões estão registradas como `T2-DEC-001` a `T2-DEC-011` em `docs/DECISIONS.md`.

Prompt executável para o Claude Code, sem placeholders pendentes: `docs/CLAUDE_PROMPT_TASK-002.md`. Ele autoriza implementação somente em branch/worktree própria, sem merge nem deploy.

### Escopo incluído no refinamento

- cadastro, login, logout, verificação e recuperação segura;
- progresso do onboarding salvo e retomável;
- primeira loja + vínculo `owner` + plano inicial em operação atômica/idempotente;
- slug seguro, único e protegido contra concorrência;
- estados `onboarding`, `pending_payment`, `active`, `suspended`;
- matriz de redirecionamento e proteção server-side/RLS;
- usuário sem loja e com múltiplos memberships;
- auditoria mínima sem segredos;
- testes Loja A × Loja B, negativos, autorização e Supabase real.

### Fora do escopo preservado

- cobrança/Pix/Mercado Pago reais;
- renovação, inadimplência ou reativação automática;
- checkout, pedidos ou catálogo completo;
- benefícios/limites definitivos de plano;
- domínio personalizado;
- deploy/produção;
- convites de funcionários, salvo decisão explícita que exija novo refinamento.

### Decisões consolidadas

- cadastro por e-mail e senha;
- verificação obrigatória antes da criação da loja;
- arquitetura multi-loja, com criação limitada a uma loja própria no MVP;
- múltiplos memberships tratados; sem convites nesta tarefa;
- plano após nome/slug e antes da confirmação;
- conclusão em `pending_payment`; fluxo público nunca chega a `active`;
- área limitada antes do pagamento e tela de pendência apenas informativa;
- nome do comerciante, nome da loja, WhatsApp, slug e plano obrigatórios;
- slug editável durante onboarding e bloqueado depois;
- senha mínima de 15 caracteres, suporte a pelo menos 64, espaços/passphrases, sem composição arbitrária ou rotação periódica sem comprometimento;
- proteção contra senhas vazadas, rate limiting e CAPTCHA preparado;
- redirects internos allowlisted;
- loja + owner + plano + auditoria atômicos e idempotentes;
- campos do cliente nunca definem owner, tenant, papel, estado ou permissões.

### Próxima ação

Claude Code pode implementar a TASK-002 seguindo `tasks/ready/task-002.md` e `docs/CLAUDE_PROMPT_TASK-002.md`, em branch/worktree própria. Ao terminar, deve entregar evidências ao Júnior para QA independente; não pode mover para DONE, fazer merge ou deploy.

## Entrega da TASK-002 — autenticação e onboarding (2026-08-03)

**Status: REVIEW.** Implementada integralmente em branch própria, sem merge, sem deploy, sem Pix/Mercado Pago/cobrança real, sem credenciais reais. Não movida para `tasks/done/`. Aguarda QA independente do Júnior.

- **Branch:** `feat/TASK-002-auth-onboarding`
- **HEAD-base (master, limpo antes de começar):** `ca2435146b9d3cc63ea589410284e9e14d31c034`
- **Commit desta entrega:** ver hash informado ao final desta sessão (branch ainda não mesclada; `git log feat/TASK-002-auth-onboarding` mostra o histórico completo).
- Todas as decisões `T2-DEC-001` a `T2-DEC-011` (`docs/DECISIONS.md`) foram implementadas exatamente como aprovadas — nenhuma reinterpretação ou ampliação de escopo.

### Arquivos e migrações principais

**Migração nova:** `supabase/migrations/0002_auth_onboarding.sql` — mínima, local/dev, reversível (drop das tabelas/funções novas), documentada em comentários:
- `stores`: + colunas `status` (enum fechado `onboarding|pending_payment|active|suspended`, default `onboarding`) e `whatsapp`.
- Tabelas novas: `merchant_profiles`, `onboarding_progress`, `store_plans`, `audit_log` — todas com RLS negada por padrão (só `merchant_profiles`/`onboarding_progress`/`store_plans` têm policy de `select` da própria linha/loja; `audit_log` não tem NENHUMA policy nem grant para `anon`/`authenticated`, só `service_role`).
- Funções `SECURITY DEFINER` (`search_path=''`, grants mínimos, mesmo padrão de `is_store_member`/`is_store_admin` da 0001): `onboarding_ensure_progress`, `onboarding_save_profile`, `onboarding_save_store_name`, `onboarding_save_slug`, `onboarding_save_plan`, `onboarding_complete` (zero parâmetros de negócio — só lê o progresso já validado etapa a etapa), `is_slug_available`. Helpers puros: `normalize_slug`, `is_reserved_slug`, `onboarding_step_rank`/`onboarding_advance_step`.
- Guarda de regressão por análise estática (mesmo padrão da 0001, RETEST-BUG-001): `supabase/migrations/0002_auth_onboarding.privileges.test.ts` (14 testes, roda em `npm test`, não depende de Docker).

**Camada de aplicação (Next.js App Router):**
- `proxy.ts` (renomeado de `middleware.ts` — Next.js 16 depreciou a convenção antiga, mesma API) + `lib/auth/middleware-policy.ts`: refresh de sessão SSR, gate de anônimo/não-verificado/sessão-de-recuperação. Lógica pura testável separada do I/O de cookies.
- `lib/auth/`: `redirects.ts` (allowlist anti-open-redirect), `rate-limit.ts` (limiter em memória por IP+ação), `captcha.ts` (verificação preparada, no-op se desativado), `password-policy.ts` (15–128 chars, sem composição, checagem HIBP opcional), `schemas.ts` (zod), `messages.ts` (textos neutros fixos), `jwt.ts` (leitura do claim `amr` para detectar sessão de recuperação), `site-url.ts`, `action-state.ts`, `form-errors.ts`.
- `lib/onboarding/`: `service.ts` (wrapper tipado dos RPCs), `steps.ts` (resolução de etapa/retomada), `messages.ts` (mapeamento de erro SQL → texto).
- `lib/tenant/`: `membership.ts` (matriz de destino por nº de lojas), `store-redirect.ts`, `resolve-optional-store.ts` (reforça `resolveAuthorizedStore` já existente da TASK-001).
- `lib/audit/log.ts`: auditoria de eventos de conta via cliente service-role (server-only), com `hashForAudit` para não guardar e-mail em texto puro nos eventos de recuperação.
- `lib/supabase/client.ts`: cliente browser (existe, não usado ainda — todo formulário é Server Action).
- Rotas: `app/(auth)/{signup,login,verify,forgot-password,reset-password}`, `app/auth/confirm/route.ts` (callback único de confirmação/recuperação, troca de código PKCE), `app/logout/route.ts` (POST-only), `app/onboarding/*` (5 etapas + revisão), `app/select-store`, `app/pending-payment`, `app/suspended`, `app/dashboard` (placeholder), `app/page.tsx` (resolvedor central de redirecionamento).
- `lib/data/repository.ts`/`supabase-repository.ts`/`fixtures.ts`: `Store` ganhou o campo `status` (extensão mínima da TASK-001, sem quebrar a interface existente).
- `scripts/seed-local.ts`/`seed-output.ts`: fixtures novas da TASK-002 (ver abaixo).
- `supabase/config.toml`: `enable_confirmations=true`, `minimum_password_length=15`, `password_requirements=""`, `[auth.rate_limit]` explícito, `[auth.captcha]` preparado/desativado, `additional_redirect_urls` restrito a `/auth/confirm`.
- `.env.example`: variáveis novas documentadas (`NEXT_PUBLIC_SITE_URL`, `CAPTCHA_*`, `HIBP_PASSWORD_CHECK_ENABLED`).

### Decisões estruturais tomadas nesta implementação (revisão bem-vinda)

- **WhatsApp modelado em `stores.whatsapp`** (não em `merchant_profiles`), pois `docs/PRODUCT.md` já lista WhatsApp como dado de configuração da loja, não do comerciante como pessoa. `merchant_profiles.display_name` guarda só o nome do comerciante.
- **`onboarding_progress.step`** é só o marcador de "etapa mais avançada alcançada" para fins de retomada — o bloqueio real de salto de etapa vem de cada função `onboarding_save_*` exigir que os campos da etapa anterior já estejam preenchidos (validado no banco, não só na UI). O usuário pode voltar e editar uma etapa já alcançada via `?step=`, nunca avançar além da primeira incompleta (`lib/onboarding/steps.ts`).
- **Distinção cadastro vs. recuperação no mesmo callback** (`app/auth/confirm/route.ts`): como o fluxo PKCE usa o mesmo `code` de troca para os dois casos, a Server Action de recuperação passa `?next=/reset-password` no próprio `redirectTo` — o GoTrue preserva essa query ao anexar `code`. Validado empiricamente que o GoTrue aceita `redirectTo` com querystring quando a origem+caminho batem com `additional_redirect_urls`.
- **Rate limiting é em memória, por processo** — suficiente para dev local/MVP de instância única; documentado como pendência para produção multi-instância (precisa de Redis/Upstash compartilhado). Os limites nativos do GoTrue (`[auth.rate_limit]`) continuam valendo como segunda camada independente.
- **Bloqueio de senha vazada (HIBP)** implementado em nível de aplicação (`lib/auth/password-policy.ts`, k-anonimato — só o prefixo de 5 caracteres do hash sai da máquina), porque o Supabase self-hosted local não expõe essa opção em `config.toml` (só existe nativamente no painel hospedado). Desativado por padrão (depende de rede externa); documentado no `.env.example` e no checklist abaixo.

### Checklist para configuração futura (depende do painel hospedado do Supabase)

Nada abaixo foi validado nesta sessão além da preparação local — precisa de decisão/execução futura fora deste ambiente:

- [ ] **CAPTCHA real** (hCaptcha/Turnstile): criar conta no provedor, preencher `CAPTCHA_SECRET_KEY`/`NEXT_PUBLIC_CAPTCHA_SITE_KEY` e espelhar em `supabase/config.toml [auth.captcha]` (ou no painel hospedado, se for projeto gerenciado). Trocar `CAPTCHA_ENABLED=true`. Requer também adicionar o widget real no HTML dos formulários de cadastro/recuperação (hoje há só um campo oculto vazio).
- [ ] **Bloqueio de senha vazada nativo do Supabase hospedado**: o painel gerenciado (diferente do self-hosted local) tem uma opção nativa equivalente — avaliar se substitui ou complementa a checagem HIBP em nível de aplicação já implementada.
- [ ] **SMTP de produção** para envio real de e-mail (local usa Mailpit/Inbucket, que nunca envia e-mail de verdade) — preencher `[auth.email.smtp]`.
- [ ] **`site_url`/`additional_redirect_urls`** precisam apontar para o domínio real de produção antes de qualquer ambiente compartilhado.
- [ ] Confirmar qual cabeçalho (`x-forwarded-for` ou outro) o proxy/edge de produção realmente controla, para `lib/auth/rate-limit.ts` (`getClientIp`) não confiar num header que o próprio cliente possa forjar.
- [ ] Rate limiter em memória → migrar para armazenamento compartilhado (Redis/Upstash) antes de qualquer deploy multi-instância.

### Matriz de estados e redirecionamentos (implementada exatamente como aprovada)

| Situação | Destino |
|---|---|
| Anônimo em rota protegida | `/login?next=<destino validado>` |
| Autenticado não verificado (qualquer rota fora de `/verify`, `/logout`, `/auth/confirm` — inclusive `/login`/`/signup`/`/reset-password`) | `/verify` |
| Sessão de recuperação de senha (fora de `/reset-password`, `/logout`) | `/reset-password` |
| Autenticado verificado, sem loja | `/onboarding` (retoma na primeira etapa incompleta) |
| Autenticado verificado, já é owner (`already_has_store`) | destino conforme status da loja |
| Uma loja em `onboarding` | `/onboarding` |
| Uma loja em `pending_payment` | `/pending-payment?store=slug` (informativa, painel bloqueado) |
| Uma loja `active` | `/dashboard?store=slug` (placeholder — painel real fora do escopo) |
| Uma loja `suspended` | `/suspended?store=slug` |
| Múltiplas lojas | `/select-store` (seleção explícita, nunca a primeira silenciosamente) |
| `?store=` forjado/sem vínculo em qualquer página de estado | redirecionado a `/select-store` (revalida via `resolveAuthorizedStore`, mesma mensagem genérica de "sem acesso") |

### Resultados dos gates

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | OK, sem erros |
| Typecheck | `npm run typecheck` | OK, sem erros |
| Testes | `npx vitest run` | **158/158** passando (102 dos módulos novos de auth/onboarding + 14 da guarda de privilégios da 0002 + os 36 herdados da TASK-001, mais os acréscimos da revisão de segurança) |
| Build | `npm run build` | OK, build de produção concluído (Turbopack) |
| `npm audit` | `npm audit` | **0 vulnerabilidades** |
| `npm audit --omit=dev` | `npm audit --omit=dev` | **0 vulnerabilidades** |

Nenhuma dependência nova foi adicionada — mesmo `package.json` da TASK-001 (`@supabase/ssr`, `@supabase/supabase-js`, `zod`, `next`, `react`), já auditado.

### Evidência Supabase/Postgres real (Docker)

**`supabase/tests/isolation_check.sql` (TASK-001, regressão):** 7/7 PASS após `db reset` + reseed com os fixtures novos — sem quebra.

**`supabase/tests/onboarding_isolation_check.sql` (novo, 16 cenários, roda contra Postgres real via Docker, resolve usuários/lojas por e-mail/slug — não depende de colar UUID manualmente):**

| # | Cenário | Resultado |
|---|---|---|
| 1 | Usuário lê o próprio `onboarding_progress` | PASS |
| 2 | `onboarding_progress` de outro usuário invisível mesmo filtrando pelo `user_id` dele | PASS |
| 3 | Usuário lê o próprio `merchant_profiles` | PASS |
| 4 | `merchant_profiles` de outro usuário invisível | PASS |
| 5 | Owner lê o plano da própria loja (`store_plans`) | PASS |
| 6 | Admin de outra loja não vê o plano de uma loja alheia | PASS |
| 7 | Usuário com múltiplos memberships vê o plano das 2 lojas vinculadas (não só uma) | PASS |
| 8 | Anônimo bloqueado em `onboarding_progress`/`merchant_profiles`/`store_plans`/`audit_log` | PASS |
| 9 | `authenticated` bloqueado em `audit_log` (sem GRANT de select — só `service_role`) | PASS |
| 10 | INSERT direto forjado em `stores` bloqueado (bypass de `onboarding_complete`) | PASS |
| 11 | INSERT direto forjado em `store_members` com `role='owner'` bloqueado | PASS |
| 12 | UPDATE direto forjado em `stores.status` (tentativa de auto-ativação) bloqueado | PASS |
| 13 | `onboarding_save_plan(999)` (plano forjado fora de 30\|50\|80) rejeitado | PASS |
| 14 | Slug bloqueado para edição após conclusão do onboarding (T2-DEC-009) | PASS |
| 15 | Retry de `onboarding_complete()` idempotente — mesma loja, 1 membership `owner`, sem duplicar | PASS |
| 16 | Anônimo bloqueado em qualquer função `onboarding_*` (sem GRANT EXECUTE) | PASS |

**Concorrência real de slug (`supabase/tests/slug-concurrency-check.ts`, dois usuários reais, duas sessões HTTP independentes, `Promise.all` — não apenas sequencial):** executado 2x, resultado consistente e não-determinístico na ordem do vencedor (prova que é concorrência real, não uma ordem fixa) — exatamente 1 sucesso, exatamente 1 falha com `slug_taken`, exatamente 1 loja gravada no banco em ambas as execuções.

**Testado manualmente ponta a ponta no navegador** (Docker + Mailpit para capturar e-mails reais localmente, sem SMTP/e-mail real): cadastro → e-mail de confirmação capturado no Mailpit → confirmação → onboarding completo (5 etapas incluindo normalização de slug com espaços/maiúsculas/símbolos: `"Loja do Fulano!!"` → `loja-do-fulano`) → `pending_payment` → idempotência (recarregar `/onboarding` após concluído redireciona, não reexibe o formulário) → logout → login com senha errada (mensagem genérica idêntica) → login correto → recuperação de senha completa (e-mail capturado no Mailpit, sessão de recuperação restrita a `/reset-password`/`/logout`, troca de senha, login com a senha nova).

### Achados da revisão de segurança independente e correções aplicadas

Revisão adversarial dedicada (subagente independente, sem acesso ao raciocínio da implementação) sobre toda a superfície de auth/RLS/callbacks/tokens. Resultado: **nenhum CRITICAL, nenhum HIGH**. 3 MEDIUM encontrados e corrigidos nesta sessão:

1. **Usuário autenticado não verificado conseguia acessar `/login`, `/signup`, `/forgot-password`, `/reset-password`** (rotas públicas para anônimo também liberavam sessão não verificada, contrariando T2-DEC-002 — inclusive permitindo trocar a senha em `/reset-password` sem confirmar o e-mail). **Corrigido**: `lib/auth/middleware-policy.ts` agora checa restrições de sessão autenticada (não-verificada/recuperação) *antes* de `PUBLIC_PATHS`, não depois.
2. **Sessão de recuperação de senha era uma sessão autenticada comum, sem restrição de rota** — clicar o link de recuperação e depois navegar para `/dashboard`/`/onboarding` (computador compartilhado, aba deixada aberta, e-mail encaminhado) dava acesso total à conta, não só à troca de senha. **Corrigido**: `lib/auth/jwt.ts` (novo) decodifica o claim `amr` do access token para detectar `method: "recovery"`; `proxy.ts`/`lib/auth/middleware-policy.ts` restringem essa sessão a `/reset-password` e `/logout`. Validado manualmente no navegador (ver evidência acima) e com 4 testes automatizados novos.
3. **Checagem de senha vazada (HIBP) rodava antes da verificação de sessão** em `/reset-password` — um visitante sem sessão de recuperação válida ainda disparava a chamada de rede externa (quando `HIBP_PASSWORD_CHECK_ENABLED=true`). **Corrigido**: reordenado para checar a sessão primeiro.

Achados LOW/INFO (aceitos, documentados, não bloqueantes): hash de e-mail em `audit_log` sem pepper (impacto baixo — tabela só acessível por `service_role`); `is_slug_available()` concedida mas não chamada por nenhuma UI ainda (superfície não usada, sem exploração possível); `console.error(error)` bruto em `app/api/stores/[storeSlug]/products/route.ts` é código pré-existente da TASK-001, fora do escopo desta revisão.

**Nota de transparência:** durante o desenvolvimento, um `console.error` temporário chegou a imprimir cookies/JWT de sessão no terminal local para depurar um bug real de propagação de cookie em Route Handler (ver próxima seção). Foi identificado como problema de higiene mesmo sendo saída de terminal local/dev, e removido antes de finalizar — confirmado por leitura do código-fonte final e por uma captura de log limpa (cadastro→confirmação→onboarding) sem nenhuma ocorrência de `password|secret|service_role|bearer|authorization|eyJ|base64-` depois da remoção.

### Bugs reais encontrados e corrigidos durante a implementação (não achados de segurança, bugs de funcionamento)

1. Arquivos `"use server"` só podem exportar funções async — as constantes `initialXState` exportadas junto com as Server Actions quebravam em runtime ("A 'use server' file can only export async functions, found object"). Movidas para `lib/auth/action-state.ts` (fora de qualquer arquivo `"use server"`).
2. `app/auth/confirm/route.ts` assumia o fluxo antigo (`token_hash`+`type`), mas esta versão do `@supabase/ssr` usa PKCE por padrão — o GoTrue redireciona com `?code=...`. Corrigido para `exchangeCodeForSession`, com `token_hash`/`type` mantido como caminho alternativo por robustez.
3. Cookies de sessão da troca de código não chegavam ao navegador: o Route Handler usava o helper `createServerSupabaseClient()` (pensado para Server Components/Actions, grava via `cookies()` ambiente do `next/headers`) em vez de vincular os cookies diretamente ao `NextResponse` retornado. Corrigido seguindo o mesmo padrão de `proxy.ts` (cliente Supabase criado com cookies vinculados à resposta explícita).
4. Comentário JSDoc continha `*/` no meio do texto (`onboarding_save_*/onboarding_ensure_progress`), fechando o comentário cedo e quebrando o parse de `scripts/seed-local.ts`.
5. `getPublicSupabaseEnv()` lançava antes de qualquer chamada a `cookies()`, então o Next.js tentava pré-renderizar páginas de auth estaticamente no build e falhava sem variáveis de ambiente presentes. Corrigido com `export const dynamic = "force-dynamic"` em toda página que lê sessão por requisição.
6. `store_plans` das fixtures `store-a`/`store-b` (TASK-001) não existiam, quebrando o teste de múltiplos memberships (uma loja `active` sem plano nunca aconteceria de verdade, já que `active` só existe depois de onboarding). Fixtures corrigidas para incluir plano nas lojas A/B.

### Riscos e limitações conhecidos (não bloqueantes, documentados)

- Rate limiting em memória, por processo — não sobrevive a múltiplas instâncias/restart. Ver checklist de produção acima.
- CAPTCHA e HIBP preparados mas desativados no dev local (dependem de configuração externa/rede).
- `app/dashboard` é só um placeholder de guard — painel operacional real é explicitamente fora do escopo da TASK-002.
- Auditoria (`audit_log`) não tem nenhuma UI de leitura nesta tarefa — só existe para registro mínimo, consulta seria via `service_role` direto.

### Roteiro reproduzível de QA

```bash
git checkout feat/TASK-002-auth-onboarding
npm install
npx supabase start
npx supabase db reset
npm run seed:local
npm run lint && npm run typecheck && npx vitest run && npm run build
npm audit && npm audit --omit=dev

# RLS/atomicidade/idempotência reais (Postgres via Docker):
docker exec -i <container_postgres> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/isolation_check.sql          # 7/7 PASS esperado (regressão TASK-001)
docker exec -i <container_postgres> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/onboarding_isolation_check.sql   # 16/16 PASS esperado
npx tsx supabase/tests/slug-concurrency-check.ts     # PASS esperado (idempotente, roda quantas vezes quiser)

# Fluxo real no navegador (Mailpit em http://127.0.0.1:54324 para capturar e-mails):
npm run dev -- --port 3000
# abrir http://127.0.0.1:3000/signup (usar 127.0.0.1, não localhost — precisa bater com
# NEXT_PUBLIC_SITE_URL/additional_redirect_urls do supabase/config.toml, senão o cookie
# de sessão não é reconhecido entre a origem do e-mail de confirmação e o app)
```

Usuários fixture disponíveis após `npm run seed:local` (senha de todos: a mesma constante `DEV_ONLY_PASSWORD` de `scripts/seed-local.ts`, nunca impressa em log): `admin-a@example.test`/`admin-b@example.test` (staff das lojas `active` A/B), `merchant-onboarding@example.test` (meio do onboarding, parado na etapa slug), `merchant-pending@example.test` (loja `pending_payment` completa), `merchant-suspended@example.test` (loja `suspended`), `merchant-multi@example.test` (owner de uma loja + staff de `store-a`, para testar o seletor de múltiplas lojas).

### Confirmações explícitas

- Nenhum merge na `master` foi feito.
- Nenhum deploy foi realizado.
- Nenhuma cobrança, Pix, QR Code ou integração Mercado Pago real foi implementada ou simulada.
- Nenhuma credencial real foi usada — só as chaves de demonstração padrão do Supabase local (mesmas de qualquer instalação `supabase start`, já usadas e documentadas desde a TASK-001).
- `tasks/in-progress/task-002.md` está com status `IN_PROGRESS` → será atualizado para `REVIEW` nesta mesma sessão, não `DONE`.

## Remediação pós-QA da TASK-002 (2026-08-03) — REPROVADO, corrigido nesta sessão

**QA do Júnior:** `qa/reports/TASK-002.md` (não alterado — arquivo do Júnior), commit avaliado `42e36dfb11be3aa77bc351608c4b77dde6a1252f`. Resultado: **REPROVADO**. RLS real e testes existentes passaram, mas 5 bugs de autorização (2 ALTA, 3 MÉDIA) e 1 ressalva foram encontrados. Todos corrigidos nesta sessão, com nova validação real completa (Postgres + navegador). **Status ao final desta remediação: continua REVIEW — esta entrega não se autoaprova; QA independente do Júnior decide.**

### Bugs corrigidos

#### BUG-T2-001 (ALTA) — guards de estado contornáveis por acesso direto à URL

**Causa-raiz:** cada página de estado (`/dashboard`, `/pending-payment`, `/suspended`, `/onboarding`) reimplementava sua própria resolução de loja via `resolveOptionalStoreName` (`lib/tenant/resolve-optional-store.ts`, removido nesta remediação). Sem `?store=` na URL, essa função retornava `null` silenciosamente em vez de resolver a loja real do usuário, e a página renderizava seu conteúdo genérico sem checar se o status real da loja combinava com a rota — qualquer usuário autenticado digitando `/dashboard` direto na URL, independente do status real da sua loja, via essa lacuna.

**Correção:** camada única de guards em `lib/tenant/access-control.ts` (novo), usada por todas as páginas de estado:
- `requireVerifiedSession(supabase)`: resolve sessão, redireciona anônimo→`/login`, não verificado→`/verify`, sessão de recuperação→`/reset-password`.
- `requireStoreStatus(supabase, requiredStatus, requestedSlug?)`: sempre resolve a loja real — com `?store=` válido, revalida via `resolveAuthorizedStore` (RLS-backed, TASK-001); sem `?store=`, resolve via `resolveMembershipSituation` (nunca `null` silencioso: `none`→`/onboarding`, `multiple`→`/select-store`, `one`→a loja real). Status resolvido diferente do exigido pela rota → redireciona para o destino real, nunca renderiza a rota errada.
- `requireOnboardingAccess(supabase)`: mesma resolução; permite `none` e `onboarding`, qualquer outro status redireciona para o destino real.
- `resolveMembershipSituation` (extraído de `lib/tenant/membership.ts`) é a única fonte de verdade sobre "quantas lojas o usuário tem e em que estado" — usada tanto pelos guards quanto pelo resolvedor de destino pós-login.

#### BUG-T2-002 + BUG-T2-003 (ALTA + MÉDIA) — sessão de recuperação comum acessível/aberta a redirect via `next`

**Investigação empírica (Supabase local real, antes de implementar):** a hipótese original de usar o claim `amr` do JWT para diferenciar recuperação de login comum foi checada diretamente contra o GoTrue local — confirmação de cadastro e recuperação de senha produzem exatamente `amr=[{"method":"otp"}]`, indistinguíveis. Abandonada.

**Causa-raiz real:** um único callback (`app/auth/confirm/route.ts`) tratava cadastro e recuperação, usando um parâmetro `next` client-controlled para decidir se a sessão resultante era "de recuperação" — contornável pelo cliente (BUG-T2-003) e sem prova real de proveniência (BUG-T2-002): login comum podia chegar em `/reset-password` e trocar a senha sem ter passado pelo fluxo de recuperação.

**Correção:**
- Rotas separadas por fluxo: `app/auth/confirm/route.ts` (só cadastro, sempre → `/`) e `app/auth/recovery/route.ts` (novo, só recuperação, sempre → `/reset-password`, **sem nenhum parâmetro `next`/`type` configurável pelo cliente**). É a rota executada — decidida só pelo `redirectTo` configurado no servidor ao disparar o e-mail — que classifica o fluxo, nunca uma query string.
- Prova real de proveniência: tabela `recovery_grants` (`supabase/migrations/0003_recovery_session.sql`) — `session_id` gravado automaticamente do JWT da própria sessão (`DEFAULT ((auth.jwt()->>'session_id')::uuid)`), reforçado por **CHECK constraint** (`session_id = (auth.jwt()->>'session_id')::uuid`) que impede o cliente de forjar um `session_id` diferente mesmo enviando o campo explicitamente — descoberto durante smoke test próprio (o DEFAULT sozinho é contornável se o cliente informa a coluna). RLS: só o próprio usuário lê/escreve sua linha.
- `lib/tenant/recovery-session.ts` (novo): `isCurrentSessionRecovery(supabase)` compara o `session_id` do JWT atual com o gravado em `recovery_grants`; só `true` se baterem exatamente. `consumeRecoveryGrant(supabase)` apaga o grant após o uso.
- `proxy.ts`/`lib/tenant/access-control.ts` usam `isCurrentSessionRecovery` (não mais `amr`) para restringir a sessão a `/reset-password`/`/logout`.
- Ao concluir a troca de senha (`app/(auth)/reset-password/actions.ts`): grava auditoria, **consome o grant** e **encerra a sessão** (`supabase.auth.signOut()`) antes de redirecionar a `/login` — não sobrevive à troca nem é reaproveitável.

#### BUG-T2-004 (MÉDIA) — service role em fluxo de usuário, auditoria não append-only, catch vazio

**Causa-raiz:** `lib/audit/log.ts` (removido) usava cliente **service role** dentro de um Route Handler que responde requisição de usuário, dentro de um `catch` que engolia erros silenciosamente. `audit_log` também não bloqueava `UPDATE`/`DELETE` por `service_role`.

**Correção:**
- `lib/audit/log.ts` deletado inteiramente (confirmado por grep — sem referências restantes).
- Dois eventos novos (`email_verification_completed`, `password_recovery_completed`) como funções `SECURITY DEFINER` de **zero parâmetros de negócio** (`supabase/migrations/0004_account_audit.sql`) — `auth.uid()` lido internamente, nunca recebido como argumento. `GRANT EXECUTE` só para `authenticated`.
- `signup_completed`/`password_recovery_requested` removidos do `audit_log_action_check`: já registrados nativamente por `auth.audit_log_entries` do GoTrue (só `service_role`) — decisão de não duplicar, documentada na migração.
- **Append-only real:** `revoke update, delete on public.audit_log from service_role` — antes só `authenticated`/`anon` eram bloqueados.
- `console.error` nos dois pontos de chamada loga só a mensagem (nunca o objeto completo) e não bloqueia o fluxo principal (a ação já aconteceu no GoTrue, sem rollback possível) — documentado no código.

#### BUG-T2-005 (MÉDIA) — rate limiter em memória com IP forjável

**Causa-raiz:** `getClientIp()` confiava incondicionalmente em `x-forwarded-for`/`x-real-ip`, forjáveis pelo próprio cliente sem um proxy reverso real reescrevendo-os.

**Correção:**
- `TRUSTED_PROXY_ENABLED` (novo, `.env.example`, default `false`): só quando `true` (ambiente atrás de proxy real que sobrescreve o cabeçalho) `getClientIp()` lê `x-forwarded-for`/`x-real-ip`; caso contrário sempre `"untrusted-origin"`.
- `buildRateLimitKey` prioriza `userId` > `email` (hash SHA-256 truncado, `lib/security/hash.ts`, novo) + IP > IP sozinho — nunca e-mail em texto puro.
- Interface `RateLimitBackend` pluggável (`hit`/`reset`/`clear`), `InMemoryRateLimitBackend` como padrão, `setRateLimitBackend()` para trocar por backend compartilhado em produção — pendência já documentada.

#### RESSALVA-T2-001 (BAIXA) — testes SQL alegando mais cobertura do que testavam

- Caso 13: comentário corrigido (`invalid_plan` é o erro real observado, não `slug_required`).
- Caso 16: expandido de 1 para as 7 funções `onboarding_*` (16a–16g).
- Casos 17–21 (novos): `session_id` auto-preenchido pelo JWT; CHECK bloqueia valor forjado; anônimo bloqueado em `recovery_grants`; as duas funções de auditoria novas atribuem `auth.uid()` sem parâmetro forjável; `audit_log` append-only para `authenticated` **e** `service_role`.
- Cabeçalho do arquivo atualizado para os 21 cenários reais.

### Testes de regressão adicionados

| Arquivo | Casos | Cobre |
|---|---|---|
| `lib/tenant/access-control.test.ts` (novo) | 19 | Todas as combinações de guard do BUG-T2-001 |
| `lib/tenant/recovery-session.test.ts` (novo) | 8 | `isCurrentSessionRecovery`/`consumeRecoveryGrant` |
| `lib/tenant/membership.test.ts` (novo) | 8 | `resolveMembershipSituation`/`resolveUserDestination` |
| `supabase/migrations/0003_recovery_session.privileges.test.ts` (novo) | 5 | Grants/RLS/CHECK de `recovery_grants` |
| `supabase/migrations/0004_account_audit.privileges.test.ts` (novo) | 6 | Grants/append-only/funções de auditoria |
| `lib/supabase/admin-usage.test.ts` (novo) | 1 | Nenhum arquivo fora de `lib/supabase/admin.ts` importa o cliente service role |
| `lib/security/hash.test.ts` (novo) | 5 | `hashIdentifier` |
| `lib/auth/rate-limit.test.ts` (reescrito) | ampliado | `buildRateLimitKey`, `getClientIp` com/sem proxy confiável |
| `lib/auth/jwt.test.ts` (reescrito) | ajustado | `getSessionId` (substitui os testes do `isRecoverySession` removido) |
| `supabase/tests/onboarding_isolation_check.sql` | 21 (de 16) | Ver RESSALVA-T2-001 |

`lib/audit/log.test.ts` removido (código correspondente deletado).

### Resultados dos gates (processo limpo, após a remediação)

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | OK, sem erros |
| Typecheck | `npm run typecheck` | OK, sem erros |
| Testes | `npm test` | **213/213** passando (23 arquivos) |
| Build | `npm run build` | OK, `/auth/recovery` e `/auth/confirm` como rotas separadas |
| `npm audit` | `npm audit` | 0 vulnerabilidades |
| `npm audit --omit=dev` | `npm audit --omit=dev` | 0 vulnerabilidades |

### Validação real (Docker/Supabase reiniciado do zero após as migrações novas)

`npx supabase stop` + `npx supabase start` (recarrega `config.toml`, incluindo o `additional_redirect_urls` novo de `/auth/recovery`) + `npm run seed:local` antes de validar.

- `supabase/tests/isolation_check.sql` (TASK-001, regressão): **7/7 PASS**.
- `supabase/tests/onboarding_isolation_check.sql` (21 cenários): **29/29 asserts PASS**, 0 FAIL, 0 ERROR (Caso 16 sozinho tem 7 sub-verificações).
- `supabase/tests/slug-concurrency-check.ts` (corrida real, duas sessões HTTP independentes): PASS — exatamente 1 sucesso, 1 falha `slug_taken`, 1 linha gravada.
- **Navegador real (Docker + Mailpit), guards de estado — todas as combinações do relatório do Júnior reproduzidas e confirmadas corrigidas:**

| Cenário direto por URL | Resultado |
|---|---|
| `pending_payment` → `/dashboard` | bloqueado, volta para `/pending-payment` |
| `pending_payment` → `/suspended` | bloqueado, volta para `/pending-payment` |
| `active` → `/pending-payment` | bloqueado, volta para `/dashboard` |
| `active` → `/suspended` | bloqueado, volta para `/dashboard` |
| `suspended` → `/dashboard` | bloqueado, volta para `/suspended` |
| usuário sem loja → `/dashboard` | bloqueado, volta para `/onboarding` |
| `onboarding` (loja incompleta) → `/dashboard`, inclusive com `?store=` da própria loja | bloqueado, volta para `/onboarding` |

- **Navegador real, fluxo de recuperação (BUG-T2-002/003) — 2 rodadas completas independentes**, a segunda após `supabase stop`+`start` completo: `forgot-password` → e-mail real no Mailpit → `/auth/recovery` (troca PKCE real) → `/reset-password` → senha alterada → sessão encerrada → login com a senha nova funciona → **sessão comum bloqueada de `GET /reset-password`** (mesma mensagem genérica) → **reuso do link consumido rejeitado pelo GoTrue** (`otp_expired`).

### Achado ambiental (não é bug de código, documentado por transparência)

Ao seguir o link de recuperação por navegação direta no navegador de automação usado nesta validação, o destino às vezes aparece rotulado como `localhost:3000` em vez de `127.0.0.1:3000`. Investigado: `curl -D -` confirma que o `Location` que o próprio GoTrue devolve está sempre correto, em `127.0.0.1:3000` (`site_url`/`additional_redirect_urls` de `supabase/config.toml` só referenciam `127.0.0.1`). Navegar explicitamente para `http://127.0.0.1:3000/reset-password` logo em seguida sempre mostra a sessão de recuperação válida — a aplicação está correta; o rótulo `localhost` é uma característica da ferramenta de navegador desta validação, mesma ressalva "usar 127.0.0.1, não localhost" já documentada na entrega original da TASK-002. QA deve repetir sempre com `127.0.0.1` explícito.

### Scan de segredos nos logs

Log completo do servidor de desenvolvimento desta sessão e as capturas do Mailpit revisados manualmente. Nenhuma senha, token de acesso/refresh, cookie, cabeçalho `Authorization` ou chave `service_role` foi impresso pela aplicação. Único item de transparência: o log padrão do `next dev` (comportamento do framework, não código nosso) inclui o `code` PKCE de uso único na linha de acesso (`GET /auth/recovery?code=...`) — código de uso único, expira, inútil sem o `code_verifier` correspondente (nunca logado, só em cookie do navegador).

### Limitações e riscos restantes (não bloqueantes, já documentados)

- Rate limiting em memória por padrão — backend pluggable existe, mas nenhum backend compartilhado foi implementado nesta sessão; pendência de produção multi-instância.
- CAPTCHA e HIBP continuam desativados no dev local.
- `app/dashboard` continua placeholder.
- `TRUSTED_PROXY_ENABLED` precisa do cabeçalho certo identificado antes de deploy atrás de proxy real.

### Instruções para o próximo QA do Júnior

1. Commit a validar: hash informado ao final desta sessão (`git log feat/TASK-002-auth-onboarding`).
2. `npx supabase stop && npx supabase start && npx supabase db reset && npm run seed:local` (reinício completo recomendado, não só `db reset`, para garantir `config.toml` — incluindo `additional_redirect_urls` de `/auth/recovery` — carregado).
3. `npm run lint && npm run typecheck && npx vitest run && npm run build && npm audit && npm audit --omit=dev`.
4. `docker exec -i <container_postgres> psql -U postgres -d postgres -f supabase/tests/isolation_check.sql` (7/7 esperado) e `-f supabase/tests/onboarding_isolation_check.sql` (21 cenários, todos PASS).
5. `npx tsx supabase/tests/slug-concurrency-check.ts`.
6. Navegador real, sempre `http://127.0.0.1:3000` (nunca `localhost`): repetir as 7 combinações de acesso direto por URL da tabela acima; repetir o fluxo de recuperação completo e confirmar que sessão comum não acessa `/reset-password` e que o link usado não é reaproveitável.
7. **Esta remediação não deve ser considerada aprovada por esta entrega** — cabe exclusivamente ao QA independente do Júnior decidir o resultado.

## Segunda remediação pós-QA da TASK-002 (2026-08-03) — reteste REPROVADO, corrigido nesta sessão

**Reteste do Júnior:** `qa/reports/TASK-002-RETEST.md` (não alterado — arquivo do Júnior), commit avaliado `104eefb4ec03287b5c70938d829f447de836240d`. Resultado: **REPROVADO**. Os guards de estado (BUG-T2-001) e o fluxo legítimo de recuperação passaram, mas o mecanismo `recovery_grants` era criticamente contornável: qualquer sessão comum inseria a própria linha e ganhava acesso a `/reset-password` (BUG-RT2-001, CRÍTICA); códigos PKCE de confirmação e de recuperação eram intercambiáveis entre `/auth/confirm`/`/auth/recovery` nos dois sentidos (BUG-RT2-003/004, CRÍTICAS); duas trocas de senha concorrentes eram aceitas (BUG-RT2-002, ALTA); RPCs de auditoria eram fabricáveis por qualquer sessão comum (BUG-RT2-005, ALTA); a migração 0004 quebrava sobre dados históricos da 0002 (BUG-RT2-006, ALTA); `ON DELETE SET NULL` em `audit_log.store_id` alterava indiretamente eventos históricos (RESSALVA-RT2-001). Todos corrigidos nesta sessão. **Status ao final: continua REVIEW — esta remediação não se autoaprova; QA independente do Júnior decide.**

### Redesenho: `public.recovery_grants` → `public.auth_flow_grants`

**Causa-raiz comum a BUG-RT2-001/002/003/004:** a primeira correção pós-QA confiava em RLS (`user_id = auth.uid()`) mais um `DEFAULT`/`CHECK` de `session_id` para provar "esta sessão veio de recuperação" — mas `authenticated` tinha `GRANT INSERT` na tabela, então qualquer sessão comum inserida a própria linha diretamente, sem jamais ter passado por um e-mail de recuperação (BUG-RT2-001). Separadamente, `exchangeCodeForSession`/`verifyOtp` do GoTrue devolvem uma sessão válida para QUALQUER código de e-mail legítimo, sem vincular o código à rota Next.js que o consumiu — trocar um código de confirmação em `/auth/recovery` (ou vice-versa) funcionava igual (BUG-RT2-003/004). Não havia `expires_at`/`consumed_at`, então nada impedia reuso/concorrência (BUG-RT2-002).

**Arquitetura final** (`supabase/migrations/0003_recovery_session.sql`, reescrita completa): tabela `public.auth_flow_grants` (`id` uuid, `user_id`, `purpose` — `email_confirmation`\|`password_recovery`, `session_id`, `created_at`, `expires_at` not null, `consumed_at`, unique `(user_id, purpose)`) — **zero GRANT de tabela para `anon`/`authenticated`**, RLS habilitada sem nenhuma policy (ninguém acessa a linha diretamente, nem por engano via RLS mal escrita). Toda a superfície é um punhado de funções `SECURITY DEFINER`, nenhuma aceitando `user_id`/`session_id`/nonce vindo do cliente:

1. **Confirmação de cadastro** — pedido pendente nasce SOZINHO via `TRIGGER AFTER INSERT ON auth.users` (`handle_new_user_confirmation_grant()`, expira em 24h) — só o próprio GoTrue insere ali ao criar um usuário de verdade; não existe RPC de emissão chamável por um cliente.
2. **Recuperação de senha** — `request_password_recovery_grant(p_email text)` (EXECUTE: `anon`, `authenticated`) resolve o usuário pelo e-mail internamente (anti-enumeração: e-mail sem conta não gera linha nem erro visível) e grava um pedido PENDENTE (expira em 30min) — chamar isto sozinho **não concede nada**, só marca "existe um pedido".
3. **Ativação** — `consume_auth_flow_grant(p_purpose text)` (EXECUTE só `authenticated`) — chamada pelas rotas logo após uma troca de código real bem-sucedida. UPDATE condicional ATÔMICO num único statement (`user_id = auth.uid() and purpose = p_purpose and consumed_at is null and expires_at > now()`) — sem "consultar depois agir". `false` = nada pendente para este usuário+propósito (sessão comum, código de finalidade errada, expirado ou já consumido). A auditoria de `email_verification_completed` é gravada DENTRO do mesmo UPDATE — sem exception handler ao redor, então uma falha no insert desfaz também o consumo do grant (rollback completo, provado no Caso 24 do SQL real).
4. **Reivindicação da troca de senha** — `claim_recovery_grant_for_password_change()` (EXECUTE só `authenticated`, zero parâmetros) — DELETE condicional atômico (`consumed_at is not null and expires_at > now()`), chamado IMEDIATAMENTE ANTES de `updateUser({password})`, nunca depois. Sob duas requisições concorrentes com a mesma sessão, o lock de linha do Postgres serializa as duas: só uma encontra a linha ainda presente. Grava `password_recovery_completed` no mesmo DELETE atômico.
5. **Leitura** — `is_current_session_recovery_grant()` (EXECUTE só `authenticated`, zero parâmetros) — usada por `lib/tenant/recovery-session.ts`/guards/`proxy.ts`; só `true` entre o consumo (passo 3) e a reivindicação (passo 4).

**Como as rotas usam isso** (`app/auth/confirm/route.ts`/`app/auth/recovery/route.ts`, reescritas): depois de `exchangeCodeForSession`/`verifyOtp` bem-sucedido, chamam `consume_auth_flow_grant` com o `purpose` fixo da PRÓPRIA rota (`email_confirmation`/`password_recovery`). Se `false` — código de finalidade incompatível, ou nada pendente — a rota chama `supabase.auth.signOut()` IMEDIATAMENTE antes de redirecionar para `/login?error=invalid_link`: nenhuma sessão sobrevive a uma troca de finalidade incompatível, nos dois sentidos. Também corrigido um bug de cookies nas duas rotas: o padrão anterior recriava `NextResponse.redirect(...)` a cada chamada de `setAll`, perdendo cookies de uma chamada anterior sempre que `setAll` disparava mais de uma vez (ex.: exchange seguido de signOut) — agora os cookies são acumulados numa lista e aplicados numa ÚNICA resposta final, construída só no `return`.

**Consumo atômico, explicado:** a "prova não fabricável" não depende de nenhum nonce apresentado pelo cliente numa URL — vem inteira do banco: `auth.uid()` (a sessão JÁ provou identidade ao GoTrue) cruzado com uma linha PENDENTE que só um mecanismo interno (trigger/função restrita a um propósito) pôde ter criado. Isso evita a superfície adicional de "aceitar um nonce como parâmetro", que — se mal desenhada — reabriria a mesma classe de bug ao permitir registrar um grant para um `user_id` arbitrário escolhido pelo cliente.

### BUG-RT2-005 — RPCs de auditoria fabricáveis

**Causa-raiz:** `log_email_verification_completed()`/`log_password_recovery_completed()` só exigiam `auth.uid()` não nulo — qualquer sessão comum as chamava diretamente e fabricava os dois eventos.

**Correção:** as duas funções foram REMOVIDAS (`drop function`, em `supabase/migrations/0004_account_audit.sql`). A auditoria agora acontece DENTRO das funções atômicas de `0003_recovery_session.sql` (passos 3 e 4 acima) — não existe mais nenhuma RPC de auditoria isolada e chamável diretamente por um cliente para estes dois eventos.

### BUG-RT2-006 — migração 0004 quebrava sobre dados históricos da 0002

**Causa-raiz:** a versão anterior de `0004_account_audit.sql` fazia `drop constraint audit_log_action_check` + `add constraint ... check (action in (...))` REMOVENDO `'signup_completed'`/`'password_recovery_requested'` do conjunto permitido. Um banco com linhas históricas gravadas sob a 0002 (que já permitia esses dois valores) quebrava com `check_violation` ao aplicar essa migração.

**Correção:** a migração corrigida NÃO toca mais em `audit_log_action_check` — o conjunto definido em `0002_auth_onboarding.sql` já inclui TODOS os valores necessários (inclusive `email_verification_completed`/`password_recovery_completed`, já usados desde a primeira correção pós-QA), então não há nada a estreitar nem a alargar. Nenhum evento histórico é apagado, alterado ou reinterpretado — a aplicação só para de ESCREVER os dois valores antigos (já não escrevia desde a primeira correção), mas eles continuam válidos para qualquer linha antiga existente.

**Validado com teste real de upgrade** (`supabase/tests/migration-upgrade-check.sh`, novo): move 0003/0004 para fora → `supabase db reset` (só 0001+0002 aplicadas) → insere uma linha real com `action='signup_completed'` → devolve 0003/0004 → `supabase migration up` (aplica sobre o banco JÁ POPULADO, sem resetar — o caminho real de upgrade) → confirma: sem erro, linha histórica sobrevive INTACTA, as 4 funções novas existem e respondem, `audit_log_store_id_fkey` está `ON DELETE RESTRICT`. **PASS** em execução real.

### RESSALVA-RT2-001 — `ON DELETE SET NULL` alterava auditoria histórica

**Causa-raiz:** `audit_log.store_id` usava `on delete set null` — apagar uma loja (via `service_role`) alterava retroativamente uma linha histórica de auditoria (`store_id` virava `NULL`), contradizendo "append-only": auditoria verdadeiramente imutável não pode ser afetada nem indiretamente por uma operação em outra tabela.

**Correção:** `alter table ... drop constraint audit_log_store_id_fkey, add constraint ... foreign key (store_id) references public.stores (id) on delete restrict`. Excluir uma loja com histórico de auditoria associado agora é bloqueado pelo próprio banco (`foreign_key_violation`), em vez de silenciosamente mutar o evento histórico — validado no Caso 25 do SQL real (cria loja temporária, grava evento referenciando-a, tenta excluir a loja — bloqueado).

### Testes de regressão adicionados/reescritos

| Item | O que cobre |
|---|---|
| `supabase/migrations/0003_recovery_session.privileges.test.ts` (reescrito) | Zero GRANT de tabela a anon/authenticated; RLS sem policy; nenhuma função aceita user_id/session_id/nonce do cliente; EXECUTE correto por função; atomicidade (UPDATE/DELETE condicionais únicos); auditoria sem exception handler ao redor (rollback completo); SECURITY DEFINER + search_path vazio nas 5 funções |
| `supabase/migrations/0004_account_audit.privileges.test.ts` (reescrito) | Não estreita `audit_log_action_check`; `ON DELETE RESTRICT` em vez de `SET NULL`; as duas RPCs de auditoria antigas foram removidas |
| `supabase/tests/onboarding_isolation_check.sql` (Casos 17–26, substituem os antigos 17–21) | INSERT direto bloqueado (17); pedido pendente sozinho não concede acesso (18); auto-fabricação via `consume_auth_flow_grant` sem pedido pendente falha e não grava auditoria (19); grant expirado falha (20); grant consumido não é reutilizável (21); usuário incompatível falha (22); claim sem consumo prévio falha + ciclo completo pendente→consumido→reivindicado (23); falha obrigatória de auditoria propaga exceção E desfaz o UPDATE do grant — atomicidade real, testada com um gatilho temporário dentro de um savepoint (24); `ON DELETE RESTRICT` bloqueia exclusão de loja com histórico (25); `audit_log` append-only para authenticated e service_role (26, reaproveita o antigo 21) |
| `supabase/tests/recovery-claim-concurrency-check.ts` (novo) | Duas requisições reais e concorrentes (mesmo access/refresh token, duas conexões HTTP independentes) chamando `claim_recovery_grant_for_password_change()` — exatamente uma autorização, exatamente um evento de auditoria |
| `supabase/tests/auth-flow-purpose-check.ts` (novo) | Ponta a ponta real (Next.js + Supabase + Mailpit + PKCE real): código de confirmação em `/auth/recovery` falha e não deixa sessão viva; confirmação legítima continua funcionando; código de recuperação em `/auth/confirm` falha e não deixa sessão viva; recuperação legítima continua funcionando |
| `supabase/tests/migration-upgrade-check.sh` (novo) | Upgrade real desde a 0002 (com dado histórico) até o schema final — ver BUG-RT2-006 acima |
| `lib/tenant/recovery-session.test.ts` (reescrito) | `isCurrentSessionRecovery`/`claimRecoveryGrantForPasswordChange` via mock de RPC; assinatura de função sem parâmetro algum (requisito 14 do reteste) |
| `lib/auth/jwt.ts`/`jwt.test.ts` | **Removidos** — decodificação de JWT no cliente não é mais necessária (toda a lógica de sessão/propósito vive nas funções `SECURITY DEFINER`, via `auth.uid()`/`auth.jwt()` server-side) |

**Total de testes automatizados (`npm test`): 217/217** (era 213 antes desta rodada; 22 arquivos, um a menos que antes por causa da remoção de `jwt.test.ts`, mas com mais casos nos arquivos que cresceram).

### Resultados dos gates

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | OK, sem erros |
| Typecheck | `npx tsc --noEmit` | OK, sem erros |
| Testes | `npm test` | **217/217** passando (22 arquivos) |
| Build | `npm run build` | OK, `/auth/confirm` e `/auth/recovery` continuam rotas separadas |
| `npm audit` | `npm audit` | 0 vulnerabilidades |
| `npm audit --omit=dev` | `npm audit --omit=dev` | 0 vulnerabilidades |

### Validação real (Docker/Supabase, múltiplos ciclos de reset completo)

- `supabase/tests/isolation_check.sql` (TASK-001, regressão): **7/7 PASS**.
- `supabase/tests/onboarding_isolation_check.sql` (26 cenários): **37/37 asserts PASS**, 0 FAIL, 0 ERROR.
- `supabase/tests/slug-concurrency-check.ts`: PASS (exatamente 1 sucesso, 1 falha `slug_taken`, 1 loja gravada).
- `supabase/tests/recovery-claim-concurrency-check.ts` (novo): PASS (exatamente 1 autorização, exatamente 1 evento de auditoria, sob corrida real com o mesmo token em duas conexões independentes).
- `supabase/tests/auth-flow-purpose-check.ts` (novo, ponta a ponta real com Next.js rodando): **4/4 PASS** — código de confirmação rejeitado em `/auth/recovery` sem deixar sessão viva; confirmação legítima funciona; código de recuperação rejeitado em `/auth/confirm` sem deixar sessão viva; recuperação legítima funciona.
- `supabase/tests/migration-upgrade-check.sh` (novo): PASS — upgrade real desde a 0002 com dado histórico, sem erro, dado preservado, schema final funcional.
- **Navegador real**: cadastro → confirmação real via Mailpit → onboarding; sessão comum bloqueada de `GET /reset-password` (mesma reprodução exata do BUG-RT2-001); recuperação real via Mailpit → `/reset-password` → senha trocada → login com a senha nova funciona.

### Scan de segredos

Log completo do servidor de desenvolvimento desta sessão e do container do GoTrue (`docker logs supabase_auth_...`) revisados — buscas automatizadas por `password|bearer|authorization|service_role_key` e inspeção manual: **nenhuma ocorrência**. Mesmo item de transparência já documentado (não novo): o log padrão do `next dev` inclui o `code` PKCE de uso único na linha de acesso — comportamento do framework, código de uso único, inútil sem o `code_verifier` correspondente.

### Privilégios SQL — resumo do que foi revogado/concedido nesta rodada

| Objeto | Antes | Depois |
|---|---|---|
| `public.recovery_grants` (tabela) | `authenticated`: SELECT/INSERT/UPDATE/DELETE (via RLS "own row") | **Removida** — substituída por `public.auth_flow_grants` |
| `public.auth_flow_grants` (tabela) | — | **Zero grant** para `anon`/`authenticated`; `service_role`: SELECT/INSERT/UPDATE/DELETE (uso administrativo, RLS sem policy) |
| `request_password_recovery_grant(text)` | — | EXECUTE: `anon`, `authenticated` |
| `consume_auth_flow_grant(text)` | — | EXECUTE: `authenticated` (nunca `anon`) |
| `claim_recovery_grant_for_password_change()` | — | EXECUTE: `authenticated` (nunca `anon`) |
| `is_current_session_recovery_grant()` | — | EXECUTE: `authenticated` (nunca `anon`) |
| `handle_new_user_confirmation_grant()` (trigger) | — | Nenhum EXECUTE direto — só invocável pelo próprio mecanismo de trigger em `auth.users` |
| `log_email_verification_completed()` / `log_password_recovery_completed()` | EXECUTE: `authenticated` | **Removidas** (`drop function`) |
| `audit_log_action_check` | Estreitada pela 0004 anterior (removia 2 valores) | **Inalterada** desde a 0002 (bloqueador 6) |
| `audit_log.store_id` FK | `on delete set null` | `on delete restrict` |

### Limitações restantes (não bloqueantes, inalteradas desde a rodada anterior)

- Rate limiting em memória por padrão; CAPTCHA/HIBP desativados local; `app/dashboard` placeholder; `TRUSTED_PROXY_ENABLED` precisa do cabeçalho certo antes de deploy atrás de proxy real. Rate limiter distribuído, Redis, CAPTCHA e HIBP explicitamente fora do escopo desta rodada.

### Instruções para o próximo QA do Júnior

1. Commit a validar: hash informado ao final desta sessão (`git log feat/TASK-002-auth-onboarding`).
2. `npx supabase stop && npx supabase start` seguido de `npx supabase db reset --local && npm run seed:local` (reinício completo necessário — `supabase stop` sem `--no-backup` pode restaurar um backup em vez de aplicar as migrações atuais; `db reset --local` garante reconstrução a partir dos arquivos de migração correntes).
3. `npm run lint && npx tsc --noEmit && npm test && npm run build && npm audit && npm audit --omit=dev`.
4. `docker exec -i <container_postgres> psql -U postgres -d postgres -f supabase/tests/isolation_check.sql` (7/7 esperado, requer substituir os 3 placeholders de UUID pelos IDs impressos por `npm run seed:local`) e `-f supabase/tests/onboarding_isolation_check.sql` (26 cenários, todos PASS).
5. `npx tsx supabase/tests/slug-concurrency-check.ts` e `npx tsx supabase/tests/recovery-claim-concurrency-check.ts`.
6. Com o Next.js rodando (`npm run dev -- --port 3000`): `npx tsx supabase/tests/auth-flow-purpose-check.ts` (4/4 esperado).
7. `bash supabase/tests/migration-upgrade-check.sh` (requer bash/Docker; restaura o ambiente ao final).
8. Navegador real, sempre `http://127.0.0.1:3000`: repetir a reprodução exata do BUG-RT2-001 (sessão comum → `GET /reset-password` → deve mostrar "Link inválido"), e o fluxo completo de recuperação via Mailpit.
9. **Esta remediação não deve ser considerada aprovada por esta entrega** — cabe exclusivamente ao QA independente do Júnior decidir o resultado.
