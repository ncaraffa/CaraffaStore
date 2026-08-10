# TASK-008 — Segunda auditoria independente de propagação

## Veredito

# REPROVADO

A rodada corretiva resolveu o bloqueio original da home do dashboard para staff, corrigiu as métricas truncadas, o escape `ILIKE` e o código morto. Entretanto, a TASK-008 ainda não pode ser aprovada:

1. **staff abre a lista de pedidos, mas o detalhe de qualquer pedido Pix quebra com erro `42501`** porque a página chama leituras de pagamento reservadas a owner/admin sem role gating;
2. **o storefront continua abaixo do padrão comercial**, com composição excessivamente estreita no desktop e cards/CTA quebrados em 375–430 px;
3. **o QR Code do Pix fake é uma imagem inválida**, exibindo ícone quebrado/alt text na tela de pagamento;
4. **`testPaymentConnectionAction` não verifica role antes de descriptografar a credencial da loja e chamar o Mercado Pago**, permitindo que staff force uso não autorizado da credencial;
5. a lista de pedidos continua sendo uma tabela cortada no mobile.

Não houve correção, merge, reset, migration ou acesso destrutivo à produção.

---

## 1. Branch e commit auditado

- Branch: `feat/TASK-008-full-frontend-redesign`
- HEAD/commit corretivo confirmado: `882883c441ac877599d6d25d011cb9e8621adca9`
- Commit anterior: `90aeeaa8862f079b323281e7ad7bf3532221ef45`
- Diff principal: `90aeeaa..882883c`
- Master confirmada: `48c92a7028bff23a691644e1960c8074cd985e46`
- Merge-base com master: `48c92a7028bff23a691644e1960c8074cd985e46`
- Nenhum merge realizado.

## 2. Diff e arquivos alterados

Números reais:

- **7 arquivos**
- **+579 / -153**

Arquivos:

1. `app/dashboard/page.tsx`
2. `app/dashboard/settings/payments/page.tsx`
3. `app/loja/[storeSlug]/page.tsx`
4. `app/loja/[storeSlug]/storefront.module.css`
5. `lib/catalog/service.ts`
6. `lib/dashboard/service.ts`
7. `supabase/tests/dashboard-access-check.ts` (novo)

Não houve alteração em migration, RLS, RPC, webhook, env, dependência, `package.json`, `package-lock.json` ou configuração de produção.

## 3. Status dos achados anteriores

| ID | Status | Conclusão independente |
|---|---|---|
| TASK008-PROP-001 | **RESOLVIDO** | Staff abriu `/dashboard?store=store-a` sem overlay/erro. O card Pix mostra “Acesso restrito” e não expõe configuração. Admin continua acessando pagamentos. |
| TASK008-PROP-002 | **NÃO RESOLVIDO** | Storefront melhorou levemente a organização, mas continua excessivamente estreito/genérico no desktop e quebrou visualmente em mobile com um produto. |
| TASK008-PROP-003 | **RESOLVIDO** | Teste local com 519 pedidos temporários confirmou inclusão do 301º/500º, exclusão de pedidos antigos/status pendente na receita e exclusão de outro tenant. |
| TASK008-PROP-004 | **NÃO REPRODUZÍVEL** | O achado anterior foi falso negativo: já existia regra global de reduced motion abrangendo `*`, `*::before`, `*::after`; `RevealRoot` também respeita `matchMedia`. |
| TASK008-PROP-005 | **RESOLVIDO** quanto ao smoke login→dashboard | O fluxo staff até a home agora funciona e existe smoke real contra Supabase local. Porém, a cobertura não alcança o detalhe do pedido, onde surgiu bloqueio equivalente. |
| TASK008-PROP-006 | **RESOLVIDO** | Busca literal por `\`, `%`, `_` e combinações foi validada localmente. |
| TASK008-PROP-007 | **RESOLVIDO** | `statusCounts`, cálculo residual e interface correspondente foram removidos. |

---

## 4. Ambiente e metodologia

- Aplicação local: `http://localhost:3000`
- Supabase local: `http://127.0.0.1:54321`
- Next.js 16.2.12 / React 19.2.8
- Chrome controlado via OpenClaw
- Dados de fixture locais; nenhuma produção usada.

Etapas:

1. releitura integral do relatório anterior;
2. auditoria do diff e do estado completo nas superfícies relacionadas;
3. gates independentes;
4. smoke real de permissões;
5. teste temporário com mais de 300 pedidos e cleanup;
6. teste temporário de busca especial e cleanup;
7. QA visual desktop/mobile;
8. storefront com 0/1/4/9 produtos locais;
9. checkout e Pix fake local;
10. inspeção de state machine, autorização e segurança.

## 5. Reprodução staff — login → dashboard

Fluxo executado:

1. login como `merchant-multi@example.test` (fixture local staff em `store-a`);
2. `/select-store`;
3. Mercado Aurora;
4. `/dashboard?store=store-a`.

Resultado:

- HTTP/renderização bem-sucedida;
- dashboard exibido;
- nenhum overlay Next;
- card de pagamentos: **“Acesso restrito”**;
- nenhuma configuração, token, preview ou status interno sensível exibido;
- métricas reais renderizadas;
- `payment_settings_get` não é chamado pelo código para staff (`canManagePayments=false`).

**TASK008-PROP-001 resolvido.**

## 6. Reprodução owner/admin

Executado login local como `admin-a@example.test`:

- dashboard renderizou normalmente;
- card Pix mostrou “Pronto para receber”;
- `/dashboard/settings/payments?store=store-a` abriu normalmente;
- preview de token permaneceu mascarado;
- conexão verificada, URL de webhook e formulários renderizaram;
- nenhum segredo completo foi exibido.

A página de settings redireciona staff antes de ler configurações; owner/admin permanece autorizado pela RPC.

## 7. `fetchPaymentSettingsSafely`

Implementação auditada em `app/dashboard/page.tsx`:

- captura somente `PaymentSettingsError`;
- relança tipos inesperados;
- registra no servidor `{storeId, code}`;
- não registra token/secret;
- devolve `null` e a UI mostra “Não foi possível carregar”.

Avaliação:

- não é um `catch` universal;
- uma falha genuína de autorização de owner/admin vira estado degradado, mas **não fica silenciosa**: há log de servidor e estado explícito na UI;
- erros não classificados como `PaymentSettingsError` ainda derrubam a página, o que evita mascaramento amplo;
- é aceitável para dependência secundária, embora observabilidade centralizada seja desejável futuramente.

## 8. Novo achado de segurança — ação “Testar conexão” sem role gating

### TASK008-RETEST-SEC-001 — HIGH

- Severidade: **ALTA**
- Superfície: Server Action `testPaymentConnectionAction`
- Arquivo: `app/dashboard/settings/payments/actions.ts:88-109`
- Descrição: a ação usa `requireStoreStatus(..., "active")`, mas descarta `role`. Em seguida chama `getStorePaymentCredentials(store.id)`, que usa `service_role`, descriptografa a credencial e chama `gateway.validateCredentials()`.
- O bloqueio de staff na página não protege uma Server Action invocada diretamente.
- `markPaymentSettingsVerified` só reautoriza depois da chamada externa e seu erro é ignorado.

Impacto:

- staff não recebe o token em resposta, mas pode forçar uso não autorizado da credencial da loja contra a API do Mercado Pago;
- é missing authorization em uma operação sensível e externa.

Não foi disparada uma chamada externa real para provar exploração, por segurança. A sequência é demonstrável diretamente no código.

Resultado esperado: exigir `owner/admin` **antes** de `getStorePaymentCredentials()` e antes de qualquer chamada ao provedor.

## 9. Validação com mais de 300 pedidos

Teste local temporário e reversível:

- 505 pedidos `confirmed/manual`, R$1,00 cada, dentro de 24h/30d em `store-a`;
- 7 pedidos `pending/pix` dentro de 24h em `store-a`;
- 3 pedidos confirmados com 31 dias em `store-a`;
- 4 pedidos confirmados recentes em `store-b`;
- total inserido: 519;
- registros removidos ao fim por marcador único (`cleanup=ok`).

Deltas medidos:

```json
{
  "ordersLast24h": 512,
  "pendingPixCount": 7,
  "revenueLast30dCents": 50500,
  "includes301stAnd500th": true
}
```

Confirmações:

- 301º e 500º entram na receita;
- pedidos antigos não entram na receita/24h;
- pending Pix entra na contagem Pix, não na receita;
- outro tenant não entra;
- tenant scoping por `store_id` funcionou.

**TASK008-PROP-003 resolvido funcionalmente.**

## 10. Paginação da receita

`sumRevenueLast30d`:

- filtra `store_id`, status elegíveis e janela no banco;
- usa páginas de 1000;
- `.range(from, from + 999)` está correto;
- incrementa `from` em 1000;
- encerra quando página tem menos de 1000;
- total múltiplo exato de 1000 causa apenas uma query vazia extra;
- não há loop infinito em resposta normal;
- memória é limitada a uma página por vez.

### TASK008-RETEST-DATA-001 — MÉDIA

A paginação não aplica `ORDER BY` estável antes do `LIMIT/OFFSET`. PostgreSQL não garante ordem entre queries separadas sem ordenação; sob escrita concorrente podem ocorrer duplicação/omissão entre páginas.

- Arquivo: `lib/dashboard/service.ts:73-96`
- Impacto: baixa probabilidade em volume comum, mas afeta corretude da métrica durante inserções concorrentes.
- Não invalida o teste estático de 519 linhas, mas deixa risco material para lojas de alto volume.

A solução paginada é aceitável como fallback enquanto agregação REST está desabilitada; a falta de ordenação é o problema específico.

## 11. Escape `ILIKE`

Teste local com produtos temporários e controles semelhantes:

- `100%` retornou somente o literal `100%`, não `100X`;
- `a_b` retornou somente `a_b`, não `acb`;
- `foo\bar` retornou somente o literal com barra, não `foobar`;
- `%\_` retornou somente a combinação literal;
- busca comum pelo marcador retornou todos os sete registros esperados;
- cleanup concluído.

O passe único `term.replace(/[\\%_]/g, ...)` está correto.

**TASK008-PROP-006 resolvido.**

## 12. Reduced motion

Confirmado em `app/globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

Também confirmado:

- `[data-reveal]` fica visível sem transformação;
- `RevealRoot.tsx` consulta `window.matchMedia("(prefers-reduced-motion: reduce)")` e revela todos os elementos imediatamente;
- não foi encontrada animação JS relevante que ignore essa preferência.

Conclusão: o achado anterior não era reproduzível; a cobertura já era global.

## 13. Storefront — screenshots obrigatórios

### Um produto

- 1440: `C:\Users\Nicolas\.openclaw\media\outbound\91f4f554-68dd-4334-86ad-427924a6ce9b---6c8561f5-0356-4fa6-8135-40217ee65f09.png`
- 1280: `C:\Users\Nicolas\.openclaw\media\outbound\58bc4c74-8de7-47cf-b97a-1dea56622f71---963e9b99-7c99-4941-aba3-f717a384518f.png`
- 430: `C:\Users\Nicolas\.openclaw\media\outbound\754283cb-eb3d-4d3f-ac9a-73f3d5e26fa7---ef90cfa4-f115-4d80-964c-1ad18a4f7066.png`
- 390: `C:\Users\Nicolas\.openclaw\media\outbound\4f267514-d339-420e-9db2-d8e5ba6a2c04---674b4ebd-aa57-4e84-9014-0e34225f5c49.png`
- 375: `C:\Users\Nicolas\.openclaw\media\outbound\0423737b-9c73-47ba-b3b4-ca6156a84961---6b28d032-6fa6-42a4-9cbc-827b5c273ddb.png`

### Densidades

- 4 produtos/1440: `C:\Users\Nicolas\.openclaw\media\outbound\1ffc9e2d-3dc0-4ac4-9fd0-7e8091a47d15---a08ea2e1-fcb8-4670-ba69-5293bff6edf4.png`
- 9 produtos/1440: `C:\Users\Nicolas\.openclaw\media\outbound\6f3a3546-998f-435c-b548-de08dc9a39dd---6d59767f-912c-4002-841d-f64d2701b64c.jpg`
- vazio por busca/1440: `C:\Users\Nicolas\.openclaw\media\outbound\d2c0b3d9-8313-44f2-926e-cfa62775e64a---54df3ebe-c443-48dc-8cb7-63d6cc4eaf36.png`

Fixtures temporárias de densidade foram removidas após as capturas.

## 14. Storefront 0/1/poucos/muitos

### 0 resultados

Empty state é claro, porém a composição geral continua excessivamente vazia.

### 1 produto

Continua parecendo card isolado. O card foi centralizado, mas não integrado a uma composição convincente.

### 4 produtos

Grid fica mais equilibrado, porém limita-se a duas colunas estreitas no centro de uma tela de 1440 px, com muito espaço morto.

### 9 produtos

O problema fica mais evidente: uma coluna central estreita de duas colunas se estende verticalmente, desperdiçando a largura disponível.

### Mobile 430/390/375

- card ocupa aproximadamente metade da largura em vez de uma coluna confortável;
- CTA ultrapassa a largura visual do card;
- em 375 px o texto “Adicionar ao carrinho” é cortado;
- grande área branca à direita do card;
- experiência visual pior que a versão anterior em mobile.

### TASK008-PROP-002

**NÃO RESOLVIDO — ALTA.**

O storefront recebeu banda/título/contagens reais e categorias laterais, mas ainda parece “grid padrão em fundo branco”; não alcançou personalidade/confiança/acabamento comparáveis ao restante da CaraffaStore.

## 15. Comparação com a landing

A queda de percepção ainda é grande:

- landing: narrativa, profundidade, motion, identidade e composição premium;
- storefront: título simples, filtros, sidebar e cards genéricos em área branca;
- nenhuma feature fake foi adicionada, o que é positivo;
- porém evitar feature inventada não justifica composição pobre.

O storefront não precisa ser institucional, mas ainda não parece um ecommerce comercial maduro.

## 16. Dashboard visual

Evidências:

- Staff 1440: `C:\Users\Nicolas\.openclaw\media\outbound\72745867-feab-4322-849f-6cf8c650fdb9---c8dc06f9-3d45-4ad4-a077-bd1422a8bd45.png`
- Staff 390: `C:\Users\Nicolas\.openclaw\media\outbound\447dfc93-3c1c-458e-9c35-f17cbeafaf7f---2cfb153f-4c79-4a77-b5d0-cef8d8a938ac.png`
- Admin 360: `C:\Users\Nicolas\.openclaw\media\outbound\076da3b2-0d9c-472c-aab1-72ce51e93e0a---038c2146-a679-46f5-8863-00cc74f0c08c.png`

Testado em 1440, 1280, 1024, 768, 430, 390, 375 e 360.

Avaliação:

- hierarquia boa;
- receita recebe prioridade correta;
- atenção operacional é clara;
- pedidos recentes/produtos/Pix/ações rápidas respondem perguntas reais;
- sidebar desktop e bottom tabs mobile funcionam;
- sem overflow global nas larguras verificadas;
- não parece somente “quatro KPIs”; há atividade e ações operacionais;
- mobile é longo, mas legível e comercial.

**Dashboard visual aprovado.**

## 17. Produtos

- lista mobile testada: clara, status/preço/estoque legíveis;
- busca presente e acessível;
- owner/admin vê Novo produto; staff não recebe ação de gestão;
- formulário de criação mobile: labels, campos e CTA adequados;
- edição usa a mesma linguagem visual;
- ausência de imagem usa placeholder coerente.

Evidências:

- Lista staff mobile: `C:\Users\Nicolas\.openclaw\media\outbound\b378f9dd-9a9f-4eaa-be46-58d1248ad67e---e2a85f98-8922-4e11-b8c1-6bbae1da6755.png`
- Criar produto mobile: `C:\Users\Nicolas\.openclaw\media\outbound\8b6bb611-fe00-4379-bed0-0f920e8abdda---427ef1f6-d457-4afd-ac6e-8112c0ccd912.png`

## 18. Categorias

- card mobile integrado ao painel;
- status/slug legíveis;
- composição simples, mas adequada;
- staff não recebe controles administrativos indevidos.

Evidência: `C:\Users\Nicolas\.openclaw\media\outbound\966a1ec2-6085-4ace-8fd9-ae16453dd672---3d93e31b-ad70-4f91-92fa-c3749214cfe0.png`

## 19. Pedidos

### TASK008-RETEST-ORD-001 — ALTA

Staff consegue listar pedidos, mas abrir o detalhe de pedido Pix retorna erro `42501`/overlay Next.

Causa:

- `app/dashboard/orders/[orderId]/page.tsx` usa `requireStoreStatus` sem preservar `role`;
- chama incondicionalmente `getOrderPayment()` e `listPaymentEvents()` para pedido Pix;
- essas leituras são reservadas a owner/admin por `can_manage_store_payments`.

É a mesma classe de falha de autorização/UX do dashboard original, deslocada para o detalhe.

Evidência visual: `C:\Users\Nicolas\.openclaw\media\outbound\cecf3a39-c2dc-4fff-993d-607fc1b11995---a2a2f433-b57f-43ba-a39a-f925c5ae0a9c.png`

### TASK008-RETEST-ORD-002 — ALTA

A lista de pedidos em 390 px mantém tabela desktop; colunas ficam cortadas e dados de data/status/ação saem da viewport. Não há adaptação para cards mobile.

Evidência: `C:\Users\Nicolas\.openclaw\media\outbound\bed84621-ccf8-4464-a53f-d6ee421eaea3---ab52b054-d156-4547-b33a-d1dee9c455c1.png`

Admin abriu o detalhe corretamente; visual, stepper e dados são bons.

## 20. Pagamentos

Owner/admin:

- estado configurado/ativo claro;
- token mascarado;
- URL webhook copiável;
- formulário de substituição não expõe segredo salvo;
- mobile utilizável.

Evidência: `C:\Users\Nicolas\.openclaw\media\outbound\db156027-8aca-4986-8dc7-850bff7ef9f1---8a1618fc-82ba-4089-8f1b-363d8fa06bd5.png`

Ressalva crítica: Server Action de teste de conexão sem role gating (TASK008-RETEST-SEC-001).

## 21. Pix fake independente

Fluxo executado:

1. storefront local;
2. produto atual adicionado ao carrinho;
3. checkout preenchido;
4. pedido Pix fake criado;
5. tela de pagamento aberta;
6. dashboard/admin detalhe refletiram pedido pending.

Pedido local criado nesta auditoria: `#7B3703B2`.

Confirmado:

- valor R$32,90;
- código copia-e-cola fake;
- botão copiar;
- link app do banco;
- countdown funcional;
- atualizar status;
- dashboard passou de 1 para 2 pedidos/pending Pix;
- pedido permanece `pending`.

### TASK008-RETEST-PIX-001 — ALTA

O QR Code fake não renderiza. O `<img>` recebe:

`data:image/png;base64,ZmFrZS1xci1mYWtlLTEtcGl4LTY0MDUzMjEw`

Esse conteúdo decodifica texto fake, não bytes PNG. No navegador:

- `complete=true`;
- `naturalWidth=0`;
- `naturalHeight=0`;
- alt text “QR Code do Pix” aparece com ícone de imagem quebrada.

Evidência: `C:\Users\Nicolas\.openclaw\media\outbound\8e53c4c7-37dd-40db-8aba-68510c7428a4---89e318ba-a179-4f78-b42a-2cd3808ec874.png`

A tela Pix precisa transmitir confiança; imagem quebrada é bloqueador visual/funcional no ambiente de QA declarado.

## 22. State machine

Confirmado:

- sequência permanece `pending → confirmed → preparing → ready → completed`;
- `cancelled` separado;
- pedido Pix pending não mostrou confirmação manual;
- detalhe admin exibiu somente cancelamento/reconciliação pertinentes;
- nenhuma migration/state machine foi alterada no diff;
- `order_advance_status` continua bloqueando `pending→confirmed` administrativo para Pix.

Evidência do detalhe admin: `C:\Users\Nicolas\.openclaw\media\outbound\c22c65c4-5e76-4457-aca2-29c29b58e0de---3205e193-7474-428b-bb8e-81519a59ed00.png`

## 23. Smoke test novo

Arquivo: `supabase/tests/dashboard-access-check.ts`

O que realmente testa:

- usa Supabase local real;
- autentica fixtures reais (`merchant-multi`, `admin-a`);
- staff chama `getDashboardSummary` com sucesso;
- staff recebe `insufficient_privilege` em `getPaymentSettings`;
- admin lê `getPaymentSettings`;
- receita do serviço é comparada a soma direta do banco.

Execução independente: **PASSOU**.

Limitações:

- não faz HTTP/login SSR no Next;
- não renderiza `/dashboard`;
- não prova que a UI não chamou a RPC;
- não cria >300 pedidos;
- não testa acesso direto à página de settings;
- não testa detalhe de pedido Pix;
- não detectaria TASK008-RETEST-ORD-001 nem TASK008-RETEST-SEC-001.

É seguro/determinístico para ambiente local com seed e apropriado como smoke complementar, mas não é E2E completo.

## 24. Mobile e desktop

### Dashboard

- 1440/1280/1024: bom uso de largura; sidebar funcional;
- 768: migra para bottom tabs sem overflow;
- 430/390/375/360: bottom tabs funcionais e cards legíveis.

### Storefront

- 1440/1280: grid estreito, muito espaço morto;
- 430/390/375: card subdimensionado, CTA extrapolado/cortado.

### Pedidos

- lista mobile inadequada; tabela cortada.

### Produtos/categorias/pagamentos/detalhe admin

- responsividade adequada nas telas observadas.

## 25. Acessibilidade

Pontos positivos:

- labels acessíveis em auth/forms/checkout;
- bottom nav com links nomeados;
- touch targets em dashboard/formulários adequados;
- reduced motion global correto;
- QR tem alt text, embora a imagem seja inválida;
- foco nativo/teclado funcionam nos controles testados.

Problemas:

- CTA do storefront em 375 px é visualmente cortado;
- lista de pedidos exige acesso a conteúdo fora da viewport;
- Pix apresenta imagem quebrada;
- checkout usa alert textual para produto inválido e validação nativa para required; considerado proporcionalmente aceitável, sem novo bug específico.

## 26. Investigação 36 → 34 rotas

Build independente atual listou novamente **36 rotas** contando a rota gerada `/_not-found`.

Contagem fonte:

- 28 arquivos `page.tsx`;
- 7 arquivos `route.ts`;
- 35 rotas fonte;
- + `/_not-found` gerada pelo Next = 36 no output do build.

Nenhuma página/route foi removida em `90aeeaa..882883c`.

Conclusão: **36→34 não é regressão real; foi erro/diferença de metodologia de contagem do implementador.** O build atual não confirma 34.

## 27. Segurança e produção

Confirmado no diff:

- nenhuma migration/RLS/RPC/webhook/env/package/dependency alterada;
- nenhum secret adicionado;
- nenhuma URL de produção introduzida;
- ambiente ativo é loopback/local;
- testes temporários usaram exclusivamente Supabase local;
- fixtures de volume/busca/densidade foram removidas;
- nenhum indício de Natty Store ou Supabase dela;
- nenhum pagamento real executado.

Novo risco de autorização: TASK008-RETEST-SEC-001.

## 28. Gates independentes

- `npm run typecheck`: **PASSOU**
- `npm run lint`: **PASSOU**, zero warnings/erros impressos
- `npm test`: **PASSOU**, 41 arquivos / **443 testes**
- `npm run build`: **PASSOU**
- Build: **36 rotas** no output, não 34
- `npx tsx supabase/tests/dashboard-access-check.ts`: **PASSOU**

Os gates não cobrem os bugs de role no detalhe/action, responsividade do storefront/pedidos ou QR inválido.

## 29. Novos bugs consolidados

### ALTA

1. `TASK008-RETEST-SEC-001` — staff pode forçar teste de conexão usando credencial da loja sem autorização prévia.
2. `TASK008-RETEST-ORD-001` — detalhe de pedido Pix quebra para staff com `42501`.
3. `TASK008-RETEST-ORD-002` — lista de pedidos cortada no mobile.
4. `TASK008-RETEST-PIX-001` — QR fake é imagem inválida/quebrada.
5. `TASK008-PROP-002` — storefront ainda abaixo do padrão e regressão mobile.

### MÉDIA

6. `TASK008-RETEST-DATA-001` — paginação de receita sem ordenação estável.

Nenhum novo achado crítico de exfiltração/corrupção/tenant crossing foi demonstrado.

## 30. Veredito final

# REPROVADO

As correções de dashboard, métricas, busca e reduced motion são reais e bem direcionadas. O dashboard agora está visualmente bom e útil. Isso é progresso importante.

Ainda assim, a TASK-008 precisa voltar ao Claude porque permanecem/reaparecem bloqueadores nas superfícies prioritárias:

- storefront não atingiu nível comercial e quebra em mobile;
- staff não consegue abrir detalhe Pix;
- ação sensível de teste de credencial carece de autorização;
- Pix fake mostra QR quebrado;
- pedidos mobile continuam inadequados;
- receita paginada precisa de ordem estável.

Não fazer merge antes de nova correção e reteste direcionado.
