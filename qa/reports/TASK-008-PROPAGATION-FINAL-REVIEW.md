# TASK-008 — Terceira auditoria independente de propagação

## Veredito

# REPROVADO

As cinco correções mais sensíveis foram confirmadas: authorization-before-secret está correta; staff abre o detalhe Pix sem `42501` e sem dados financeiros; o QR fake é um PNG 200×200 válido; a paginação de receita é determinística e passou com 2.000 pedidos; e o storefront agora é responsivo/comercialmente aceitável nas densidades e larguras exigidas.

Porém, permaneceu um bloqueador real na lista de pedidos: entre **721 e 768 px**, inclusive no breakpoint obrigatório de **768 px**, a implementação volta para a tabela desktop de `min-width: 46rem`, dentro do painel sem sidebar. A tabela fica horizontalmente cortada e esconde total/status/pagamento/ações. Em 360–430 px os cards são bons, mas o breakpoint intermediário ainda falha. Como a auditoria exige desktop/tablet sólido em 768 px e conteúdo/ação visíveis, a TASK-008 não pode ser aprovada nesta rodada.

**MERGE TASK-008: NÃO**

---

## 1. Branch, SHA e estado inicial

- Branch: `feat/TASK-008-full-frontend-redesign`
- HEAD auditado: `797d1d35ec9794a9722f0b3d173b4f5eb6d64580`
- Commit anterior: `882883c441ac877599d6d25d011cb9e8621adca9`
- Diff: `882883c..797d1d3`
- Master informada/preservada: `48c92a7028bff23a691644e1960c8074cd985e46`
- Working tree inicial: apenas os relatórios preservados `TASK-008-PROPAGATION-REVIEW.md` e `TASK-008-PROPAGATION-RETEST.md`, ambos untracked.
- Nenhum merge foi feito.

## 2. Diff real

- **16 arquivos**
- **+1.320 / -211**

Arquivos alterados:

1. `app/dashboard/orders/[orderId]/page.tsx` (+21/-5)
2. `app/dashboard/orders/actions.test.ts` (+111)
3. `app/dashboard/orders/actions.ts` (+22/-3)
4. `app/dashboard/orders/orders-list.module.css` (+160)
5. `app/dashboard/orders/page.tsx` (+70/-39)
6. `app/dashboard/settings/payments/actions.test.ts` (+155)
7. `app/dashboard/settings/payments/actions.ts` (+15/-1)
8. `app/loja/[storeSlug]/page.tsx` (+145/-82)
9. `app/loja/[storeSlug]/storefront.module.css` (+144/-79)
10. `lib/dashboard/service.ts` (+7)
11. `lib/payments/gateway/fake-qr.test.ts` (+50)
12. `lib/payments/gateway/fake-qr.ts` (+96)
13. `lib/payments/gateway/fake.test.ts` (+8/-1)
14. `lib/payments/gateway/fake.ts` (+2/-1)
15. `supabase/tests/dashboard-revenue-pagination-check.ts` (+125)
16. `supabase/tests/order-detail-payment-access-check.ts` (+189)

`git diff --check` passou. Não houve mudança em migration, RLS, RPC, schema, webhook, env, `package.json`, lockfile, dependência, segredo ou produção.

## 3. Status dos seis bugs anteriores

| ID | Status final | Conclusão |
|---|---|---|
| TASK008-RETEST-SEC-001 | **RESOLVIDO** | owner/admin é validado antes de credencial, descriptografia e provider. |
| TASK008-RETEST-ORD-001 | **RESOLVIDO** | staff abre o mesmo detalhe Pix sem `42501`; leituras financeiras nem são tentadas. |
| TASK008-RETEST-ORD-002 | **PARCIALMENTE RESOLVIDO** | cards funcionam em 360/375/390/430, mas a tabela volta e corta conteúdo em 721–768 px. |
| TASK008-RETEST-PIX-001 | **RESOLVIDO** | PNG real, válido e renderizado em 200×200. |
| TASK008-PROP-002 | **RESOLVIDO** | storefront agora usa largura, grids e spotlight de forma intencional; mobile sólido. |
| TASK008-RETEST-DATA-001 | **RESOLVIDO** | ordem `created_at`, depois `id`, antes de `.range()`, validada com 2.000 linhas. |

## 4. Authorization — payment settings

Em `testPaymentConnectionAction`:

1. `requireStoreStatus` retorna `store` e `role`;
2. `role !== owner && role !== admin` redireciona;
3. somente depois vem `getStorePaymentCredentials(store.id)`;
4. somente depois vêm `getPixPaymentGateway()` e `validateCredentials()`.

A guarda fica fora de `try/catch`, portanto o redirect não é engolido. Staff não lê credencial, não descriptografa, não instancia gateway, não chama provider e não recebe informação sensível.

Testes direcionados: **4/4 passaram**. Eles importam a action real, mockam as bordas e fazem o redirect lançar, provando early exit real. Owner e admin continuam autorizados.

## 5. Authorization — order actions

- `cancelOrderAction`, pedido Pix: somente owner/admin chama `cancelPixOrder`.
- `cancelOrderAction`, pedido manual: staff continua chamando `cancelOrder` normalmente.
- `reconcileOrderPaymentAction`: staff redireciona antes de `reconcileOrderPayment`.
- A UI do detalhe é coerente com a action: staff não recebe cancelar Pix nem reconciliar.

Testes direcionados: **5/5 passaram**.

## 6. Matriz staff/admin

| Papel | Manual — cancelar | Pix — cancelar | Pix — reconciliar | Dados Pix no detalhe |
|---|---|---|---|---|
| staff | permitido | bloqueado | bloqueado | ocultos; mensagem de acesso restrito |
| owner/admin | permitido | permitido quando pertinente | permitido quando pertinente | visíveis |

A busca dirigida não encontrou outra Server Action de dashboard alterada capaz de fazer staff alcançar credencial/provider.

## 7. Detalhe Pix — staff e admin

Pedido local usado no E2E: `#FA231DF0` (removido no cleanup).

Staff:

- página renderizou normalmente;
- sem `42501`, overlay ou alerta;
- cliente, itens, total, fulfillment e state machine disponíveis;
- cartão “Pagamento Pix” mostra: “Detalhes de pagamento são visíveis só para proprietários e administradores”;
- provider id, estado, valor, expiração e eventos financeiros não são buscados/renderizados;
- nenhum botão administrativo Pix.

Admin no mesmo pedido:

- viu estado “Aguardando pagamento”, provider id mascarado, valor, timestamps e detalhe;
- viu “Cancelar pedido” e “Reconciliar com o provedor”;
- não houve confirmação manual indevida de Pix pending.

O script real `order-detail-payment-access-check.ts` também passou: RLS retorna `null` para pagamento de staff; RPC de eventos retorna `insufficient_privilege`; admin lê ambos.

## 8. Pedidos mobile/tablet

### 360/375/390/430 px

Cards reais substituem a tabela. Cada card mostra código, cliente, valor, status, pagamento, data e modalidade. Nomes longos não causaram overflow. O card inteiro é link para o detalhe.

Ressalva de UX: a ação é implícita no card inteiro; não existe texto/ícone “Abrir”. É polish desejável para affordance, mas não foi o bloqueador principal.

### 768 px — bloqueador novo/remanescente

`orders-list.module.css` esconde a tabela apenas em `max-width: 720px`. Em 768 px:

- a tabela de `min-width: 46rem` é exibida;
- o shell já está no layout compacto/bottom-nav;
- total, status, pagamento e ações ficam fora da viewport;
- o usuário vê uma tabela cortada e precisa de rolagem horizontal não evidente.

Classificação:

### TASK008-FINAL-ORD-003 — ALTA — REGRESSÃO NOVA / continuação de ORD-002

A correção cobre telefones, mas deixa quebrado o breakpoint obrigatório de 768 px. Isso impede aprovação.

Desktop 1024/1280/1440 não apresentou regressão estrutural na tabela.

## 9. QR fake e validação PNG

`generateFakeQrPngBase64` usa apenas `node:crypto` e `node:zlib`, sem dependência nova.

Teste unitário confirmou:

- assinatura PNG;
- IHDR;
- IDAT;
- IEND;
- descompressão com tamanho exato das scanlines;
- determinismo por seed;
- diferença entre seeds.

No navegador, no checkout local real:

- `complete = true`;
- `naturalWidth = 200`;
- `naturalHeight = 200`;
- prefixo `data:image/png;base64,iVBORw0KGg`;
- sem broken icon;
- padrão visual claramente fake/local;
- copia-e-cola presente;
- botão copiar presente e acionável;
- countdown funcional;
- “Atualizar status” executado;
- pedido permaneceu `pending`, como esperado;
- nenhum pagamento real.

## 10. Paginação estável >1000

A query aplica antes de `.range()`:

1. `.order("created_at", { ascending: true })`
2. `.order("id", { ascending: true })`

A cadeia Supabase/PostgREST gera ordenação lexicográfica determinística por `created_at,id`.

Teste independente local:

- 2.000 pedidos elegíveis;
- 400 com `created_at` idêntico;
- páginas de 1.000 atravessadas;
- delta exato: **200.000 centavos / R$ 2.000,00**;
- sem omissão/duplicação;
- contagem direta: 2.000;
- outro tenant/status não elegível/janela antiga seguem filtrados pela query e pela cobertura anterior;
- cleanup: `ok`.

O fallback paginado é aceitável enquanto agregação REST está desabilitada.

## 11. Storefront — densidades 0/1/4/9

Dados exclusivamente locais, com status original dos produtos restaurado ao final.

- **0 produtos:** empty state grande, claro e intencional; não parece erro.
- **1 produto:** spotlight horizontal centralizado, imagem/placeholder e conteúdo equilibrados; deixou de parecer card abandonado.
- **4 produtos:** quatro tracks em 1440, composição usa a largura e fecha em uma linha coerente.
- **9 produtos:** 4 colunas em 1440, 3 em 1280/1024, 2 em 768 e 1 em mobile; o último item não força tracks vazios artificiais.

## 12. Storefront — breakpoints obrigatórios

Inspeção visual real realizada em:

- 1440
- 1280
- 1024
- 768
- 430
- 390
- 375
- 360

Mobile:

- cards ocupam a largura útil;
- CTA inteiro em todas as quatro larguras;
- nenhuma metade de tela vazia;
- nenhum texto/CTA cortado;
- imagens mantêm proporção;
- sem overflow horizontal.

Desktop:

- 1440: 4 colunas;
- 1280 e 1024: 3 colunas;
- 768: 2 colunas;
- busca/chips/catálogo usam largura coerente.

## 13. Storefront × landing

O storefront não tenta virar landing institucional, mas agora preserva tipografia, azul, bordas, sombras, ritmo e hierarquia da CaraffaStore. A landing segue mais rica em narrativa e profundidade, o que é apropriado. A diferença já não parece “agência × MVP”: o catálogo é simples, porém comercial e intencional.

Polish futuro: dados de QA sem imagens enfraquecem a percepção visual; com imagens reais, identidade da loja e descrições, o grid tende a ganhar confiança. Isso não é defeito estrutural do redesign auditado.

## 14. Fake Pix ponta a ponta

Executado localmente:

`storefront → carrinho → checkout → Pix fake → painel → detalhe admin → mesmo detalhe staff`

Confirmado:

- pedido criado e listado;
- QR renderizado;
- dashboard refletiu o pedido pending;
- admin viu dados Pix e ações permitidas;
- staff abriu o detalhe sem dados financeiros;
- refresh manteve pending;
- pedido de QA removido no cleanup.

## 15. State machine

Sem mudança na rodada. Confirmado no código/UI e smoke:

`pending → confirmed → preparing → ready → completed`

`cancelled` permanece separado. Pix pending não recebe confirmação administrativa manual. Cancelamento/reconciliação respeitam role e modalidade.

## 16. Dashboard e regressões

Smoke staff/admin em desktop/mobile:

- dashboard e navegação carregam;
- bottom nav mobile funciona;
- staff continua sem acesso a pagamentos;
- admin continua com pagamentos;
- nenhum novo overlay/erro funcional foi observado.

Produtos, categorias e pagamentos mantiveram o comportamento aprovado no retest. A atenção principal server-side passou.

## 17. Segurança direcionada

Pergunta: “Algum staff ainda consegue provocar uso de credencial/payment provider através de uma action direta?”

**Não foi encontrado caminho nas superfícies alteradas.**

As três entradas sensíveis do dashboard agora têm guarda owner/admin anterior à operação privilegiada:

- teste de conexão;
- cancelamento Pix;
- reconciliação Pix.

O checkout público, webhook e reconciliador batch são superfícies distintas e esperadas, não actions de staff.

## 18. Acessibilidade

Pontos bons:

- controles nomeados;
- checkout com labels e validação;
- QR com alt text;
- chips/filtros navegáveis;
- cards de pedido são links inteiros;
- touch targets adequados;
- reduced motion global preservado.

Ressalvas:

- cards mobile de pedido deveriam comunicar “Abrir” de forma explícita;
- a tabela cortada em 768 prejudica acesso a conteúdo e ação por viewport, elevando o achado a bloqueador.

## 19. Gates

- `npm run typecheck`: **PASSOU**
- `npm run lint`: **PASSOU**
- `npm test`: **PASSOU — 44 arquivos / 454 testes**
- testes direcionados novos: **16/16**
- `npm run build`: **PASSOU**
- build: **36 rotas** (inclui `/_not-found` gerada pelo Next)
- `dashboard-revenue-pagination-check.ts`: **PASSOU**, cleanup ok
- `order-detail-payment-access-check.ts`: **PASSOU**; dados criados pelo script foram removidos manualmente porque o script não implementa cleanup próprio.

## 20. Evidências visuais

Storefront 9 produtos:

- 1440: `C:\Users\Nicolas\.openclaw\media\outbound\dc57f660-07af-40dc-9e23-588e34a92feb---28f6daa0-a026-4780-90a1-45e1e90b9908.png`
- 1280: `C:\Users\Nicolas\.openclaw\media\outbound\062a394d-4603-4f86-927e-5c889b1a6d2d---bf4b0848-2eaf-4a48-8de3-461cd693bf70.jpg`
- 1024: `C:\Users\Nicolas\.openclaw\media\outbound\8d0708f4-5280-4a06-bf10-729b84560964---ad25b997-d567-4fe6-b550-1156ff518a96.png`
- 768: `C:\Users\Nicolas\.openclaw\media\outbound\63613158-2cd5-4297-9c7c-06182c973bea---214529a6-96c3-40ab-83d4-b856ba3bef13.jpg`
- 430: `C:\Users\Nicolas\.openclaw\media\outbound\05c08216-785b-4cdb-b5a9-07555d063de8---4afae397-b35a-4d78-8230-4feeb84726e3.jpg`
- 390: `C:\Users\Nicolas\.openclaw\media\outbound\87bd6274-ead7-40d9-aad8-7940d1656f12---e5d33950-687c-47c7-9f43-38df4cc1d90a.jpg`
- 375: `C:\Users\Nicolas\.openclaw\media\outbound\2932cdad-9bfc-480c-949d-baad29b4edaa---bbdf9d57-988b-47b6-8f0c-b42a88ab6e2b.jpg`
- 360: `C:\Users\Nicolas\.openclaw\media\outbound\3188044f-6e14-4f1c-a680-d80752e6fba2---893a83e6-bee3-4567-ae16-f12b20eb28e7.jpg`

Densidades:

- 4 produtos/1440: `C:\Users\Nicolas\.openclaw\media\outbound\9de0199f-772d-4ad4-a585-b452a6e3456e---02535b49-6187-44dc-a264-f88e8498f929.png`
- 1 produto/1440: `C:\Users\Nicolas\.openclaw\media\outbound\f13faf29-89af-4721-850f-71078c4011df---996619cc-475d-4e7f-bff1-352a52e23cb4.png`
- 0 produtos/1440: `C:\Users\Nicolas\.openclaw\media\outbound\27e67a4b-0d57-4f7a-a4e1-4319b391338f---93d48c08-a948-4188-a32a-adc2fc3a31ae.png`

Pedidos/Pix:

- pedidos 390/cards: `C:\Users\Nicolas\.openclaw\media\outbound\af77c4a4-5cc2-4eb2-a392-381f1a15ecfb---1343e0f4-7d7a-4790-becd-96d2e274170c.png`
- pedidos 768/tabela cortada: `C:\Users\Nicolas\.openclaw\media\outbound\67984cc0-a1b2-4e08-9cea-5f5fce8afcfb---0e4e42da-7f2f-4dae-b2cd-f1cab2584729.png`
- QR fake 390: `C:\Users\Nicolas\.openclaw\media\outbound\d7004e5c-641b-4621-ad16-15572c8915ca---003c494c-847a-4e55-a363-7f407eb49b0c.png`
- detalhe Pix staff 390: `C:\Users\Nicolas\.openclaw\media\outbound\ec51d264-9e49-4103-a7d5-eb727e0f7604---08d974eb-eae5-4d33-85c2-ed6062b9e5f6.png`

## 21. Produção e cleanup

- Somente localhost e Supabase local.
- Nenhum Mercado Pago real.
- Nenhum endpoint de produção.
- Nenhuma Natty Store.
- Nenhuma migration/reset/alteração destrutiva.
- Produtos tiveram status original restaurado.
- 2.000 pedidos temporários removidos pelo script.
- pedidos/produtos temporários do script de detalhe removidos manualmente.
- pedido Pix E2E final removido.

## 22. Novos bugs e polish futuro

### Bloqueador

- `TASK008-FINAL-ORD-003` — tabela de pedidos cortada em 721–768 px; em 768 esconde campos essenciais e ação.

### Polish futuro

- adicionar affordance explícita “Abrir”/chevron aos cards mobile de pedido;
- enriquecer identidade visual do storefront quando existirem imagens/dados reais;
- adicionar cleanup automático ao script `order-detail-payment-access-check.ts`;
- adicionar teste automatizado do Server Component do detalhe, além do script Supabase manual.

## 23. Recomendação final

# REPROVADO

A rodada corrigiu corretamente segurança, Pix, detalhe staff, paginação e storefront. Falta uma correção pequena em escopo, mas bloqueante no resultado: alinhar o breakpoint dos cards de pedidos ao layout compacto/tablet para que 768 px não volte à tabela cortada, e repetir o reteste 721/720/768.

**MERGE TASK-008: NÃO**
