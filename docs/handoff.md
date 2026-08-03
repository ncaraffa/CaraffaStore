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
