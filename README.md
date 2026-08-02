# Commerce Platform — Fundação (TASK-001)

Fundação executável do projeto: Next.js + TypeScript + Supabase, com
contexto de tenant resolvido no servidor e isolamento entre lojas
provado por testes automatizados. Consulte `docs/` para produto,
arquitetura, decisões, segurança e testes; `tasks/` para o backlog.

## Requisitos

- Node.js 20+
- Para rodar Supabase local de verdade (opcional para os comandos abaixo,
  necessário para validar RLS): Docker Desktop + `npx supabase`.

## Comandos

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm test           # testes de isolamento Loja A x Loja B (em memória)
npm run build
```

## Configuração de ambiente

```bash
cp .env.example .env.local
```

Preencha com valores do **seu Supabase local** (nunca de produção). Para
subir um Supabase local completo:

```bash
npx supabase start   # requer Docker Desktop em execução
npx supabase db reset  # aplica supabase/migrations/0001_init.sql
npm run seed:local    # cria Loja A, Loja B e usuários fictícios de teste
```

O comando `npx supabase start` imprime a URL, a anon key e a service role
key locais — copie para `.env.local`.

## O que existe nesta fundação

- `app/` — Next.js App Router. Página inicial mínima e uma rota de API
  de exemplo (`/api/stores/[storeSlug]/products`) que demonstra o padrão
  de autorização ponta a ponta.
- `lib/supabase/` — clientes Supabase: `server.ts` (sessão do usuário,
  respeita RLS) e `admin.ts` (service role, **somente** para scripts
  locais de seed, nunca usado a partir de uma requisição de usuário).
- `lib/tenant/context.ts` — resolução do tenant: deriva a loja autorizada
  a partir da sessão autenticada + `store_members`; nunca confia em um
  `store_id`/slug enviado pelo cliente como prova de autorização.
- `lib/data/` — `repository.ts` (contrato), `supabase-repository.ts`
  (implementação real) e `memory-repository.ts` (implementação em
  memória usada nos testes e fixtures).
- `lib/products/service.ts` — camada fina de negócio/autorização
  compartilhada pela rota de API real e pelos testes automatizados
  (mesmo código, sem infraestrutura live nos testes).
- `supabase/migrations/0001_init.sql` — schema (`stores`,
  `store_members`, `products`) com RLS **negada por padrão**.
- `supabase/tests/isolation_check.sql` — script de validação manual das
  policies de RLS contra Postgres real (ver `docs/HANDOFF.md`).
- `scripts/seed-local.ts` — cria Loja A/B e usuários fictícios de teste
  em um Supabase local.

## Modelo de dados (mínimo, proposto)

- `stores`: uma loja (tenant).
- `store_members`: vínculo autorizado usuário↔loja com papel
  (`owner` | `admin` | `staff`) — papéis mínimos propostos, sujeitos a
  revisão.
- `products`: recurso de negócio mínimo (nome + estoque) usado para
  provar isolamento. Catálogo completo está fora do escopo da TASK-001.

## Estratégia de tenant (proposta)

O slug da loja na URL serve apenas para **roteamento** (qual loja o
cliente diz que quer acessar). A **autorização** nunca vem do slug/ID
enviado — vem exclusivamente do cruzamento entre `auth.uid()` (sessão
autenticada) e `store_members`, verificado no servidor
(`lib/tenant/context.ts`) e reforçado no banco via RLS
(`supabase/migrations/0001_init.sql`). Ver proposta detalhada e
alternativas em `docs/DECISIONS.md`.

## Limitação conhecida deste ambiente de implementação

O ambiente usado para implementar esta tarefa não tem Docker disponível,
então `npx supabase start` (que depende de Docker para subir o Postgres
local) não pôde ser executado aqui. Os testes automatizados (`npm test`)
cobrem toda a matriz de isolamento de `docs/TESTING.md` na camada de
autorização server-side, usando um repositório em memória com o mesmo
contrato (`StoreRepository`) usado em produção. As políticas de RLS em
si (`supabase/migrations/0001_init.sql`) ainda precisam ser validadas
contra um Postgres real — instruções exatas em `docs/HANDOFF.md` e
`supabase/tests/isolation_check.sql`.
