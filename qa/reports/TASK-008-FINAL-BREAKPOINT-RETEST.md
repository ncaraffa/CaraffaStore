# TASK-008 — Retest final e cirúrgico de breakpoint

## Veredito

# REPROVADO

# MERGE TASK-008: NÃO

O bloqueio em 768 px foi corrigido, mas a correção apenas deslocou a quebra para a nova fronteira: **959 px funciona com cards; em 960 px o DashboardShell abre a sidebar e a lista troca imediatamente para a tabela de 46rem, porém a área útil restante tem apenas 638 px.** Data, modalidade, total, status, pagamento e ações ficam fora da área visível, dentro de scroll horizontal. A instrução deste retest dizia explicitamente que tabela sem espaço real em 960 px ainda seria bug. Portanto, `TASK008-FINAL-ORD-003` está apenas parcialmente resolvido.

## 1. Repositório e diff

- Branch: `feat/TASK-008-full-frontend-redesign`
- HEAD: `85d02e4b2c8511d795469f6ad3a3e9692f599507`
- HEAD anterior: `797d1d35ec9794a9722f0b3d173b4f5eb6d64580`
- Master/merge-base: `48c92a7028bff23a691644e1960c8074cd985e46`
- Nenhum merge realizado.
- Os três relatórios anteriores permanecem preservados.
- Working tree inicial: somente os três relatórios anteriores untracked.

Diff real `797d1d3..85d02e4`:

- **2 arquivos**
- **+29 / -6**
- `app/dashboard/orders/orders-list.module.css`: +24/-5
- `app/dashboard/orders/page.tsx`: +5/-1

Nenhuma alteração fora da lista de pedidos. Nenhuma mudança de segurança, backend, migration, RLS, RPC, pagamentos, env, pacote ou produção.

## 2. Causa anterior e correção auditada

Anterior:

- cards: `max-width: 720px`;
- tabela voltava em 721 px;
- DashboardShell seguia compacto até 959 px;
- em 768 px a tabela cortava campos essenciais.

Novo commit:

- cards: `max-width: 959px`;
- DashboardShell: desktop/sidebar em `@media (min-width: 960px)`;
- cards receberam “Abrir” + `IconArrowRight`.

O diff corresponde exatamente à alegação do implementador.

## 3. Resultados visuais por largura

### Compacto — aprovado

| Largura | Apresentação | Overflow da página | Resultado |
|---:|---|---|---|
| 360 | cards | não | OK |
| 375 | cards | não | OK |
| 390 | cards | não | OK |
| 430 | cards | não | OK |
| 720 | cards | não | OK |
| 721 | cards | não | OK |
| 740 | cards | não | OK |
| 767 | cards | não | OK |
| 768 | cards | não | OK |
| 769 | cards | não | OK |
| 800 | cards | não | OK |
| 900 | cards | não | OK |
| 959 | cards | não | OK |

Em todas essas larguras os cards exibiram:

- código;
- cliente;
- valor;
- status;
- pagamento quando existente;
- data;
- modalidade;
- affordance “Abrir” com seta.

O card inteiro continua sendo link. “Abrir” melhora a descoberta sem duplicar controles interativos nem poluir a composição. Em 360 px permaneceu legível e com touch target adequado.

### 768 px — bloqueio anterior resolvido

Confirmado:

- cards visíveis;
- tabela escondida;
- total visível;
- status visível;
- pagamento visível nos pedidos Pix;
- data visível;
- ação “Abrir” visível;
- nome longo legível;
- sem overflow horizontal da página;
- bottom navigation correta.

Métricas DOM em 768:

- viewport: 768;
- `scrollWidth = clientWidth = 753`;
- tabela: escondida;
- 8 cards renderizados.

Screenshot:

`C:\Users\Nicolas\.openclaw\media\outbound\0d2a786c-293b-4a84-8ce6-da089454d6ac---6430cdcd-0858-4a31-bb29-dca5084583f0.png`

### Transição 959 → 960 → 961

#### 959 px — aprovado

- cards visíveis;
- sidebar escondida;
- sem overflow da página;
- `scrollWidth = clientWidth = 944`.

Screenshot:

`C:\Users\Nicolas\.openclaw\media\outbound\238fef13-d3ca-4c94-8bb1-cdd840294821---d7c0117c-ee6d-48a5-8971-7f829b576a81.png`

#### 960 px — reprovado

- sidebar aparece;
- tabela aparece;
- página global não transborda, mas a tabela não cabe na área real;
- wrapper: **638 px úteis**;
- tabela com fixture difícil: **1.376 px**;
- mesmo sem a fixture difícil, `min-width: 46rem` = **736 px**, maior que os 638 px disponíveis;
- visíveis inicialmente: código, cliente e telefone;
- fora da área visível: data, modalidade, total, status, pagamento e ações.

Posições medidas dos headers em viewport de 960 px:

- Código: visível;
- Cliente: visível;
- Telefone: visível;
- Data: começa em x=928 e termina após a viewport;
- Modalidade, Total, Status, Pagamento e Ações: totalmente fora da viewport.

Screenshot:

`C:\Users\Nicolas\.openclaw\media\outbound\977b521c-628b-4b1c-91bc-0968e881dfea---74d5215a-ebec-4270-833b-99dd42edb091.png`

#### 961 px — reprovado pelo mesmo motivo

- sidebar e tabela visíveis;
- wrapper: 639 px;
- tabela: 1.376 px com conteúdo difícil;
- scroll horizontal contido, mas campos essenciais não ficam imediatamente acessíveis na transição.

Não houve flash observado; o problema é espacial/estrutural.

## 4. Desktop

| Largura | Página global | Tabela/wrapper | Avaliação |
|---:|---|---|---|
| 1024 | sem overflow | scroll contido | utilizável, mas ainda estreita |
| 1280 | sem overflow | scroll contido com nome excepcionalmente longo | aceitável proporcionalmente |
| 1440 | sem overflow | scroll contido com nome excepcionalmente longo | aceitável proporcionalmente |

Em 1280/1440 o scroll decorreu principalmente da fixture de nome excepcionalmente longo com células `nowrap`; isso é proporcional e permitido pelo critério. O bloqueador é especificamente a troca em 960/961, onde até a largura mínima declarada da tabela excede a área real após a sidebar.

## 5. Conteúdo difícil

Fixture local temporária:

- cliente: `Maria Fernanda de Oliveira Nascimento Barbosa`;
- total: `R$ 1.287,50`;
- modalidade: entrega;
- status: confirmado;
- endereço longo no registro;
- pedido manual;
- pedidos Pix/pending existentes usados para conferir badge de pagamento.

Nos cards, o conteúdo permaneceu organizado em todas as larguras abaixo de 960. Em 768 o nome ficou legível, o valor não colidiu e “Abrir” permaneceu visível.

Cleanup: **1 pedido temporário removido** pelo marcador `TASK008-FINAL-BP-*`.

## 6. Page-level overflow

Em todas as 18 larguras testadas:

`document.documentElement.scrollWidth <= document.documentElement.clientWidth`

Não houve overflow horizontal da página. A partir de 960, o overflow é contido no wrapper da tabela; porém isso não neutraliza o bug de transição porque o próprio critério exigia que a tabela em 960 coubesse na largura real após a sidebar.

## 7. Gates

- `npm run typecheck`: **PASSOU**
- `npm run lint`: **PASSOU**
- `npm test`: **PASSOU — 44 arquivos / 454 testes**
- `npm run build`: **PASSOU**
- Rotas: **36**, incluindo `/_not-found`

Nenhuma regressão de gate.

## 8. Novo bug

Nenhuma mudança não relacionada foi encontrada.

O problema remanescente é continuação direta do mesmo achado:

### TASK008-FINAL-ORD-003 — PARCIALMENTE RESOLVIDO

- 721–959: corrigido;
- 768: corrigido;
- 959: corrigido;
- 960/961: ainda inadequado porque a tabela aparece junto com a sidebar antes de existir largura real para seus campos essenciais.

## 9. Recomendação

# REPROVADO

# MERGE TASK-008: NÃO

A correção necessária continua cirúrgica: a apresentação da lista não pode depender apenas de copiar numericamente o breakpoint do shell. Ela precisa considerar a largura útil depois da sidebar. Não implementei qualquer correção ou merge.
