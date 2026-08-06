# TASK-008 — Handoff (redesign visual completo da CaraffaStore)

**Branch:** `feat/TASK-008-full-frontend-redesign`
**Base:** `master` em `48c92a7028bff23a691644e1960c8074cd985e46` (TASK-001 a TASK-006 `DONE`, pilot ativo)
**HEAD atual:** `219e9e14a302bfa0f44c2381cbad933d70e376a0`
**Status:** EM ANDAMENTO — **reprovado visualmente**, continuar na mesma branch

## ⚠️ Leia isto antes de continuar

A implementação funcional está completa (todas as 8 prioridades A–H do escopo original) e foi
inspecionada visualmente por Caraffa no ambiente local. Resultado da inspeção (2026-08-06):

> "os fluxos parecem funcionais; não encontrei quebra evidente nas páginas testadas; porém, o
> visual ainda está muito longe do padrão comercial que quero para a CaraffaStore; portanto, a
> TASK-008 NÃO está aprovada."

**Não é um problema funcional.** Login, onboarding, painel, pagamentos, produtos, pedidos,
catálogo, carrinho, checkout e Pix (fake) foram todos navegados sem erro. O que falta é
**refinamento visual profundo** — o resultado atual é "funcional e organizado", mas ainda não
atinge o padrão de acabamento comercial pedido (SaaS premium, branco predominante, azul de
destaque, hierarquia visual forte, sensação de produto pronto).

**Próximo objetivo desta task:** uma segunda passada de refinamento visual em cima do que já
existe — não é para recomeçar do zero. O design system (`components/ui/*`), o shell do painel
(`components/dashboard/DashboardShell`) e a estrutura de cada página já estão no lugar; o trabalho
agora é elevar o polimento (tipografia, espaçamento, hierarquia, micro-interações, densidade visual,
qualidade de composição) até parecer um produto comercial de verdade, não uma reorganização de HTML
cru em componentes.

## Commits da TASK-008 (9, todos na branch, nenhum mesclado)

| Commit | Descrição |
|---|---|
| `e50182f` | Design system (tokens, Inter, componentes `components/ui/*`) + shell do painel |
| `1d5833f` | Redesign de pagamentos, categorias e produtos |
| `50b55c4` | Redesign de pedidos (lista + detalhe) |
| `0c210d6` | Fix: sidebar mobile usa `left` em vez de `transform` (mais confiável) |
| `3c91b3a` | Landing page pública da CaraffaStore (nova) + `/` liberado para anônimo |
| `6c93d5e` | Redesign das páginas de autenticação (login/cadastro/recuperação/verificação) |
| `fd5546f` | Redesign do onboarding (stepper) + pending-payment/select-store/suspended |
| `6a3fb4f` | Redesign do storefront público (catálogo, produto, carrinho, checkout, Pix) |
| `219e9e1` | Troca das últimas menções visíveis de "Commerce Platform" por "CaraffaStore" + página 404 |

## Rotas já redesenhadas (28)

`/` (landing), `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify`,
`/onboarding` (5 etapas), `/pending-payment`, `/select-store`, `/suspended`, `/dashboard`,
`/dashboard/categories` (+ `new`, `[id]/edit`), `/dashboard/products` (+ `new`, `[id]/edit`),
`/dashboard/orders` (+ `[orderId]`), `/dashboard/settings/payments`, `/loja/[storeSlug]`,
`/loja/[storeSlug]/produto/[productSlug]`, `/loja/[storeSlug]/carrinho`,
`/loja/[storeSlug]/checkout`, `/loja/[storeSlug]/pedido/[publicCode]/pagamento`,
`/loja/[storeSlug]/pedido/[publicCode]/sucesso`, `/not-found`.

`/termos` e `/privacidade` não foram redesenhadas nesta rodada (mantidas com a estilização mínima
de TASK-006) — candidatas para a próxima passada, se fizer sentido dar acabamento visual completo
também nelas.

## Testes e gates executados (todos verdes ao final de cada commit)

- `npx tsc --noEmit` — limpo
- `npm run lint` — 0 erros, 0 warnings
- `npm test` — **443/443**
- `npm run build` — OK, todas as rotas compilando
- Responsividade real (scrollWidth/overflow via JS, sem screenshot): **1440, 1024, 768, 390, 360px
  — sem overflow horizontal** em landing, catálogo, painel e tabela de pedidos
- Inspeção visual manual de Caraffa no ambiente local (`http://localhost:3000`, Supabase local,
  contas fixture `admin-a@example.test`/`admin-b@example.test`) — **fluxos aprovados
  funcionalmente, reprovados visualmente**

## Confirmação de preservação de funcionalidade

- Nenhuma Server Action foi reescrita — todas continuam com a mesma assinatura, os mesmos campos
  de formulário (`name="..."`) e o mesmo comportamento.
- Nenhuma migration, policy de RLS, grant ou função SQL foi tocada.
- Nenhuma lógica de negócio (idempotência de checkout, reserva de estoque, máquina de estados de
  pedido/pagamento, criptografia de credenciais) foi alterada — só markup e CSS.
- `FakePixGateway` continua bloqueado em produção (guard em `lib/payments/gateway/select-mode.ts`,
  inalterado nesta task).

## Estado do deploy

- Nenhum merge na `master`.
- Nenhum deploy em produção (`commerce-platform-pi.vercel.app` permanece no código pré-TASK-008).
- Um Preview deployment da Vercel desta branch falhou por variáveis de ambiente ausentes no escopo
  Preview (diagnosticado, não corrigido por decisão explícita de Caraffa — não copiar segredos de
  produção para o Preview). A verificação visual passou a ser feita via ambiente local.

## Próximo objetivo (para a próxima sessão)

**Refinamento visual profundo de toda a CaraffaStore**, mantendo a base já construída
(`components/ui/*`, `DashboardShell`, `OnboardingShell`, `StorefrontHeader`, `StatusPage`).
Não recomeçar o design system do zero — evoluir o que existe. Sugestões de foco (a validar com
Caraffa antes de executar em massa):

- Tipografia: hierarquia mais forte entre títulos/corpo, tamanhos e pesos mais deliberados.
- Espaçamento: revisar densidade — pode estar genérico/uniforme demais em vez de composto.
- Cards e superfícies: sombras, bordas e contraste podem precisar de mais intenção visual.
- Landing page: hero, mockup do painel e seções provavelmente precisam de mais trabalho de
  composição para parecer "produto comercial" em vez de "template".
- Consistência de acabamento entre painel administrativo e storefront público.
- Pedir a Caraffa referências visuais concretas (screenshots de SaaS que ele considera no padrão
  desejado) antes de iterar às cegas.

## Instrução explícita para a próxima sessão

**Continuar nesta mesma branch (`feat/TASK-008-full-frontend-redesign`), a partir deste commit.
Não recomeçar o trabalho. Não recriar o design system. Não reescrever páginas que já estão
estruturalmente corretas — refinar visualmente em cima delas.**
