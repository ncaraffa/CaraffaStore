# TASK-008 — Revisão independente de propagação visual

## Veredito

# REPROVADO

A rodada melhora substancialmente Auth, Onboarding, Carrinho e Checkout e aproxima essas superfícies da landing. Porém, o produto não pode ser aprovado porque a principal página do comerciante quebra no ambiente local válido ao abrir uma loja ativa (`PaymentSettingsError: insufficient_privilege`). Além disso, o novo serviço do dashboard calcula métricas sobre no máximo 300 pedidos, podendo exibir receita e contagens incorretas sem aviso. O storefront continua visualmente muito abaixo da landing: correto e limpo, mas esparso, genérico e sem densidade/confiança comercial suficiente.

---

## 1. Commit, branch e diff auditados

- Branch: `feat/TASK-008-full-frontend-redesign`
- Commit auditado: `90aeeaa8862f079b323281e7ad7bf3532221ef45`
- Mensagem: `feat(task-008): propagar a linguagem visual da landing para o produto inteiro`
- Diff: `79576af..90aeeaa`
- Base estável confirmada: `master = 48c92a7028bff23a691644e1960c8074cd985e46`
- Merge-base confirmado: `48c92a7028bff23a691644e1960c8074cd985e46`
- Nenhum merge foi feito.
- Números reais: **73 arquivos**, **+4.159**, **-950**. A alegação de 66 arquivos/+3.253 estava incorreta.

## 2. Metodologia

1. Inspeção independente do estado Git e do diff completo.
2. Inventário de arquivos e revisão direcionada das mudanças fora de CSS/markup.
3. Revisão de tenant scoping, dashboard, catálogo, carrinho, pedidos, Pix/MP, planos e state machines.
4. Execução independente de typecheck, lint, testes e build.
5. QA no navegador real em `localhost:3000`, com Supabase local ativo e fixtures persistidas.
6. Comparação visual contínua com a landing aprovada.
7. Testes desktop e mobile, incluindo 1440 px, 390 px e 360 px nas superfícies acessíveis.
8. Inspeção de console e log do Next.js.

Não foram feitas correções, migrations, seed, reset, pagamento real ou alterações na Natty Store.

## 3. Ambiente

- Windows 10/11 x64
- Node 24.18.0
- Next.js 16.2.12 / React 19.2.8
- Aplicação local: `http://localhost:3000`
- Supabase local: `http://127.0.0.1:54321`
- Navegador: Chrome controlado pelo OpenClaw
- Dados: fixtures persistidas do Supabase local; não são dados de produção.

## 4. Inventário de alterações

### Frontend/apresentação

- Auth: layout, shell, login/signup/recovery/reset e nova cena de marca.
- Onboarding: shell, progresso, plano, slug e revisão.
- Dashboard: shell, navegação, home, produtos, categorias, pedidos e pagamentos.
- Storefront: catálogo, produto, galeria, header/footer.
- Carrinho, checkout, pagamento Pix e sucesso.
- Estados: pending-payment, suspended, select-store e StatusPage.
- Design system: Alert, EmptyState, Field, FormControls e Table.

### Mudanças fora de frontend puro

- `lib/dashboard/service.ts` — novo agregador de leitura.
- `lib/catalog/service.ts` — busca `ILIKE` por nome.
- `lib/cart/storage.ts` — `imageUrl` opcional no item local.
- `lib/orders/messages.ts` — labels/tons compartilhados.

Não houve mudança em migrations, RLS, RPCs, schema, webhooks, secrets, `package.json`, dependências ou ações de mutação.

## 5. Áreas efetivamente testadas

### Testadas visual/funcionalmente

- Landing desktop.
- Login e forgot-password desktop.
- Select-store e autenticação com fixture local.
- Onboarding (etapa de revisão) em 1440 e 360 px.
- Storefront catálogo em 1440 e 390 px.
- Produto e adicionar ao carrinho.
- Carrinho preenchido em 390 px.
- Checkout em 390 px e validação nativa de campos vazios.
- Navegação até loja ativa e tentativa de abrir dashboard.
- Console/log de runtime.

### Não concluídas por bloqueio do dashboard

- Dashboard renderizado com dados.
- Produtos, categorias, pedidos e pagamentos dentro do painel.
- Mudança real de status de pedido.
- Pix completo/QR/countdown.
- Fluxo completo de onboarding desde a primeira etapa.
- Estados de suspended/pending-payment em todas as larguras.

Essas áreas **não são marcadas como aprovadas**. O bloqueio principal impediu o fluxo autenticado ponta a ponta.

## 6. Resoluções verificadas

- Desktop: 1440×900.
- Mobile: 390×844 e 360×800.
- Código/CSS revisado também para breakpoints declarados de 430/390/375/360 e 1440/1280/1024/768, mas 430/375/1280/1024/768 não receberam inspeção visual completa.

## 7. Evidências visuais

Arquivos gerados durante a auditoria:

- Landing 1440: `C:\Users\Nicolas\.openclaw\media\outbound\a15d8a58-d1a1-4773-933d-42c8e5dadd8c---45cc8790-9c13-442f-b2cc-b008eab134b3.jpg`
- Auth/forgot-password 1440: `C:\Users\Nicolas\.openclaw\media\outbound\0adffefc-b021-41c3-bbe2-ac12a9b76c22---ffb07978-28e8-4089-a996-c2ee039aeac4.png`
- Onboarding review 1440: `C:\Users\Nicolas\.openclaw\media\outbound\7faa7afa-6529-4c89-ad66-e264642730cd---0871bb29-1513-44a1-9fae-a5635e3085e0.png`
- Onboarding review 360: `C:\Users\Nicolas\.openclaw\media\outbound\e2332332-45cd-4df5-b910-1a0f8d091fa6---0dbf2d40-63e1-4dd4-ac13-6f9920fa47f8.png`
- Storefront 1440: `C:\Users\Nicolas\.openclaw\media\outbound\639a1eaa-10f9-46c7-8d5c-1f81cc8bb1bb---f0c801fc-7d65-4184-be5c-dbfd2f8a7554.png`
- Storefront 390: `C:\Users\Nicolas\.openclaw\media\outbound\d9a5976e-cfb9-40b2-b7a9-47b88df5878e---596d8ae6-491b-4e83-a6a1-996798e74d6b.png`
- Carrinho 390: `C:\Users\Nicolas\.openclaw\media\outbound\3be52cd9-97b6-4398-88b9-7a4b6237433b---4bd5f5d3-ae30-4513-a816-4dec167795f5.png`
- Checkout 390: `C:\Users\Nicolas\.openclaw\media\outbound\44232655-e27e-4148-a5d0-ae93fbc62280---cbfe70b5-cd7d-4118-93dd-886a35679ae0.png`

## 8. Achados por severidade

### CRÍTICO

Nenhum vazamento de segredo, quebra demonstrada de tenant isolation, corrupção, pagamento real indevido ou alteração destrutiva foi encontrado no diff.

### ALTA

#### TASK008-PROP-001 — Dashboard quebra ao abrir loja ativa

- Severidade: **ALTA**
- Rota: `/dashboard?store=store-a`
- Descrição: a home do painel passou a chamar `getPaymentSettings()` incondicionalmente. No ambiente local existente, o RPC retorna `insufficient_privilege` e a página cai no overlay de erro do Next.
- Passos:
  1. Iniciar Supabase e aplicação locais.
  2. Entrar com usuário fixture de múltiplas lojas.
  3. Em `/select-store`, abrir “Mercado Aurora” (ativa).
  4. Observar a falha ao carregar `/dashboard?store=store-a`.
- Atual: erro não tratado; dashboard indisponível.
- Esperado: painel renderiza; configuração de pagamento ausente/sem privilégio deve virar estado tratável ou a permissão local/documentação deve garantir o RPC.
- Evidência: log do Next: `PaymentSettingsError: insufficient_privilege`, em `lib/payments/settings-service.ts:63`, chamado por `app/dashboard/page.tsx:43`.
- Provável área: `app/dashboard/page.tsx` e contrato/permissões de `payment_settings_get`.
- Regressão da rodada: antes deste diff a home do dashboard não chamava `getPaymentSettings()`.

#### TASK008-PROP-002 — Storefront permanece muito abaixo da landing

- Severidade: **ALTA** (task de design, superfície comercial principal)
- Rota: `/loja/store-a`
- Descrição: em desktop, um único card estreito fica isolado no canto de um canvas quase vazio; não há hero/identidade da loja, seção de confiança, conteúdo editorial, densidade de catálogo ou composição premium comparável à landing. No mobile, a tela é funcional, mas ainda parece catálogo MVP/template.
- Passos: abrir a landing em 1440, depois `/loja/store-a` em 1440 e 390.
- Atual: continuidade de tokens básicos (branco/azul), mas grande queda de composição, personalidade e percepção comercial.
- Esperado: storefront com hierarquia e densidade de ecommerce real, mantendo leveza sem parecer vazio ou genérico.
- Evidência: screenshots de storefront 1440 e 390.
- Provável área: `app/loja/[storeSlug]/page.tsx`, `storefront.module.css`, `storefront-layout.module.css`, componentes de card/header/footer.

### MÉDIA

#### TASK008-PROP-003 — Métricas do dashboard truncadas em 300 pedidos

- Severidade: **MÉDIA**
- Rota: `/dashboard`
- Descrição: `RECENT_ORDERS_LIMIT = 300`; receita de 30 dias, pedidos de 24h, aguardando Pix e contagens por status são calculados somente sobre os 300 pedidos mais recentes.
- Passos: ter mais de 300 pedidos dentro da janela relevante e comparar com agregação completa.
- Atual: números ficam subestimados sem aviso.
- Esperado: agregação completa no banco ou paginação/cálculo que cubra toda a janela.
- Evidência: `lib/dashboard/service.ts:24, 49-54, 79-91`.
- Provável área: `lib/dashboard/service.ts`.

#### TASK008-PROP-004 — Cobertura de reduced-motion não é sistêmica

- Severidade: **MÉDIA**
- Rotas: superfícies internas em geral.
- Descrição: a busca no projeto encontrou regras explícitas principalmente na landing e em poucos componentes (`Button`, `Field`, `Skeleton`). A grande quantidade de novas transições/hover em CSS não tem uma política global evidente de redução de movimento.
- Atual: comportamento depende de componentes isolados; não há garantia de que toda motion nova respeite a preferência.
- Esperado: política global ou cobertura explícita para toda animação/transição relevante.
- Evidência: ocorrências localizadas em `components/marketing/*`, `components/ui/Button.module.css`, `Field.module.css`, `Skeleton.module.css`.
- Provável área: CSS global/design system e módulos novos.

#### TASK008-PROP-005 — QA anunciado como ponta a ponta não é sustentado pelo estado local

- Severidade: **MÉDIA**
- Rotas: painel autenticado.
- Descrição: embora gates estáticos passem, o primeiro acesso ao dashboard falha. Logo, a alegação de fluxo ponta a ponta validado não é confirmada independentemente.
- Atual: build/test passam, runtime principal quebra.
- Esperado: smoke autenticado automatizado ou manual cobrindo login → dashboard em banco local atualizado.
- Evidência: TASK008-PROP-001.
- Provável área: processo de QA/fixtures/migrations locais.

### BAIXA

#### TASK008-PROP-006 — Escape de busca `ILIKE` não cobre barra invertida

- Severidade: **BAIXA**
- Rota: `/dashboard/products?search=...`
- Descrição: `%` e `_` são escapados, mas `\` não é escapada antes de compor o padrão.
- Atual: termos com barra invertida podem ter semântica inesperada.
- Esperado: escape completo ou API de busca sem montagem manual de padrão.
- Evidência: `lib/catalog/service.ts:131`.
- Provável área: `lib/catalog/service.ts`.

#### TASK008-PROP-007 — `statusCounts` calculado e não utilizado

- Severidade: **BAIXA**
- Rota: dashboard.
- Descrição: custo/código morto no novo agregador.
- Evidência: `lib/dashboard/service.ts`; nenhum consumo em `app/dashboard/page.tsx`.

## 9. Auditoria visual por superfície

### Landing

Mantém a referência aprovada: boa narrativa, contraste, composição, seções ricas, uso controlado do azul e identidade forte.

### Auth

**Bom.** Split-screen convincente, logo correto, Bricolage/Inter coerentes, formulário limpo e mockup lateral com linguagem do produto. Não parece mais formulário genérico. A continuidade com a landing é clara.

### Onboarding

**Bom na etapa observada.** Progresso transmite avanço, revisão tem hierarquia clara e preços/códigos estão corretos. Em 360 px não houve corte/overflow. O conteúdo ainda é relativamente “wizard”, mas a marca e o tratamento visual o elevam acima de CRUD genérico.

### Dashboard

**Reprovado funcionalmente; visual não pôde ser validado em runtime.** A análise do código mostra esforço real de utilidade (receita, pedidos, Pix, estoque e ações), mas a página não renderizou.

### Produtos, categorias, pedidos e pagamentos

Código/markup revisado, mas sem aprovação visual de runtime devido ao dashboard quebrado. State machine e server actions não foram alterados pelo diff.

### Storefront

**Reprovado visualmente.** Limpo e responsivo, porém genérico, vazio e sem impacto. A distância para a landing é grande. A página de cliente final não transmite ainda o mesmo produto premium.

### Carrinho

**Bom.** Em 390 px há hierarquia, controles grandes, subtotal evidente e CTA forte. Não houve conteúdo escondido. O tratamento é superior ao storefront.

### Checkout

**Bom com ressalvas.** Agrupamento claro, boa explicação sobre CPF/CNPJ/Pix e CTA visível. Validação vazia acionou estado inválido nativo. A tela transmite mais confiança que o storefront, mas falta evidência visual explícita de erro por campo além do comportamento nativo observado.

### Pix

Código e CSS revisados; não executado para evitar pedido/pagamento real. Não aprovado visualmente nesta rodada.

### Estados auxiliares

Select-store foi acessado e está coerente. Pending-payment/suspended/verify/reset não receberam cobertura visual completa.

## 10. Mobile

- 390 px storefront: sem overflow horizontal; busca e filtros têm targets adequados; card/CTA são legíveis.
- 390 px carrinho: controles +/− e CTA adequados; composição clara.
- 390 px checkout: formulário confortável, CTA visível, sem corte.
- 360 px onboarding: responsivo e utilizável; labels do progresso ficam compactas, mas compreensíveis.
- Não foi possível confirmar bottom tabs do dashboard, pois o dashboard não renderizou.
- Não há evidência suficiente para confirmar 90% do fluxo mobile nas páginas autenticadas.

## 11. Desktop

- Auth utiliza bem a largura e evita a página centralizada/morta.
- Onboarding é intencionalmente centralizado e funciona bem.
- Storefront 1440 reincide exatamente na crítica antiga: grande área vazia, conteúdo estreito e pouca densidade.
- Dashboard desktop não pôde ser inspecionado em runtime.

## 12. Dashboard e métricas

### Confirmado no código

- Queries novas são filtradas por `store_id` e executadas sob cliente autenticado/RLS.
- Receita usa `confirmed`, `preparing`, `ready`, `completed`.
- Pedidos Pix pendentes usam `status=pending` e `payment_mode=pix`.
- Estoque baixo usa produtos publicados com estoque ≤5.
- Não há gráfico fake ou KPI hardcoded.

### Problemas

- Limite de 300 invalida as métricas em lojas de volume maior.
- A dependência incondicional de `getPaymentSettings()` derruba toda a home em caso de privilégio/configuração inconsistente.
- Não foi possível comparar os números na UI com dados persistidos porque a página falhou.

## 13. Segurança, regras e planos

- Nenhuma migration/RLS/RPC/webhook/secret/env foi alterado no diff.
- Nenhuma nova mutação de Pix, checkout ou pedido foi introduzida.
- State machine real permanece `pending → confirmed → preparing → ready → completed`, com `cancelled` separado.
- Stepper usa estado real, não timeline inventada.
- Tenant scoping novo usa `.eq("store_id", storeId)` e recebe `store.id` de guard existente.
- Preços visuais confirmados: R$30/R$50/R$70; código interno 80 preservado.
- Não foi encontrada exposição de access token/credencial no diff.
- Mockup decorativo de Auth (“Casa do Café”, pedido fictício) é `aria-hidden` e claramente cenário de marketing, não métrica do comerciante.

## 14. Acessibilidade

### Pontos bons

- Inputs acessíveis por nome nas telas testadas.
- Carrinho oferece rótulo explícito de remoção.
- Touch targets observados são adequados.
- Stepper separa cancelado e usa lista ordenada.
- Checkout tem labels e tipos semânticos.

### Riscos/pendências

- Reduced-motion não está demonstrado de forma sistêmica.
- Não foi executada auditoria automatizada WCAG/axe.
- Focus por teclado não foi percorrido em todas as rotas.
- Mensagens de validação do checkout dependem ao menos parcialmente do navegador; falta evidência de resumo/erro textual persistente.

## 15. Regressões técnicas e runtime

- Erro reproduzido: `PaymentSettingsError: insufficient_privilege`.
- Nenhum erro de console observado na landing/storefront/carrinho/checkout durante os passos registrados.
- Nenhum hydration warning observado nas superfícies acessadas.
- Não foi possível avaliar requests 4xx/5xx de todo o painel por causa do bloqueio inicial.

## 16. Gates independentes

- `npm run typecheck`: **PASSOU**, exit 0.
- `npm run lint`: **PASSOU**, exit 0, sem warnings/erros impressos.
- `npm test`: **PASSOU**, **41 arquivos / 443 testes**.
- `npm run build`: **PASSOU**; compilação e TypeScript OK.
- Build listou **36 rotas de aplicação** (além de Proxy/Middleware).

Os gates confirmam a alegação técnica, mas não detectam o erro de permissão em runtime nem o problema de métricas truncadas.

## 17. Comparação objetiva com a landing

Pergunta: “Ao sair da landing, ainda parece a mesma CaraffaStore?”

- Landing → Auth: **sim**.
- Auth → Onboarding: **sim, com boa continuidade**.
- Onboarding → Dashboard: **não avaliável; fluxo quebra**.
- Landing → Storefront: **não**. Compartilha cores e tipografia, mas perde narrativa, riqueza, personalidade e acabamento comercial.
- Carrinho/Checkout: **mais próximos da linguagem aprovada do que o catálogo público**.

A experiência ainda não é um único produto profissional de ponta a ponta. A landing é premium; parte do produto acompanhou, mas o storefront ainda parece MVP/template e o painel principal está indisponível no ambiente auditado.

## 18. Pontos bons do redesign

- AuthScene é a propagação mais convincente da linguagem da landing.
- Onboarding ganhou progresso, hierarquia e sensação de avanço.
- Carrinho e checkout têm boa clareza mobile e CTAs fortes.
- Uso correto da marca CaraffaStore; não foi encontrado “Commerce Platform” como marca de usuário nas telas testadas.
- Componentes compartilhados trazem consistência real.
- Nenhuma expansão perigosa de backend, dependência ou migration.
- Planos comerciais exibidos corretamente, preservando `plan_code=80`.

## 19. Pontos abaixo do padrão comercial

1. Storefront desktop excessivamente vazio e genérico.
2. Storefront mobile funcional, mas sem personalidade suficiente de ecommerce real.
3. Dashboard não abre no ambiente local válido.
4. Métricas do dashboard não escalam corretamente além de 300 pedidos.
5. Cobertura visual da rodada não pode ser considerada ponta a ponta.
6. Reduced-motion e acessibilidade ainda não têm evidência sistêmica.

## 20. Decisão final

**REPROVADO.**

A próxima rodada precisa, no mínimo:

1. restaurar o carregamento robusto do dashboard e validar permissões/estado de pagamento em runtime;
2. corrigir a agregação truncada do dashboard;
3. elevar o storefront ao nível comercial da landing, principalmente em desktop;
4. repetir QA autenticado completo em 360/375/390/430 e desktop, incluindo produtos, categorias, pedidos, pagamentos e Pix fake;
5. acrescentar smoke test que prove login → seleção de loja → dashboard com Supabase local atualizado.

Não fazer merge antes desse novo ciclo.
