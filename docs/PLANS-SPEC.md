# PLANS-SPEC.md — Especificação oficial dos planos da CaraffaStore

**Status:** especificação comercial e técnica aprovada por Caraffa em 2026-08-09.
**Escopo:** define o que cada plano DEVE incluir quando os gates forem implementados.
**Não é a TASK-007** (cobrança recorrente automática) — essa continua não implementada e
fora de escopo deste documento.

Esta é a fonte de verdade para a futura implementação técnica dos limites e recursos por
plano. Nenhum gate, migration ou limite foi criado a partir desta especificação — apenas o
texto público (landing e onboarding) foi ajustado para não contradizê-la nem anunciar como
disponível algo que ainda não existe.

## 1. Visão geral

| Plano | Preço | `plan_code` (DB) | Posicionamento |
|---|---|---|---|
| Essencial | R$ 30/mês | `30` | "Tudo que você precisa para começar a vender online." |
| Crescimento | R$ 50/mês — **Recomendado** | `50` | "Para quem quer crescer com a própria marca." |
| Profissional | R$ 70/mês | `80` | "Para operações que precisam ir além." |

**Sem comissão sobre vendas.** O valor de cada pedido vai direto para a conta Mercado Pago
configurada pelo lojista. A CaraffaStore nunca retém ou processa esse dinheiro — cobra
apenas a mensalidade do plano. Isso **não** significa "Pix sem taxa": o Mercado Pago pode
cobrar tarifas próprias sobre cada transação, segundo as regras da conta do lojista. Nunca
comunicar isenção de tarifa do Mercado Pago sem confirmação.

### ⚠️ Sobre o preço do Profissional e o `plan_code`

O código interno do terceiro plano é `80` (mesmo valor gravado no banco desde a TASK-002),
mas o preço comercial oficial passou a ser **R$ 70**. `plan_code` está travado por uma
`CHECK` constraint em `onboarding_progress` e `store_plans`
(`supabase/migrations/0002_auth_onboarding.sql:48,59`, reforçada em
`onboarding_save_plan` e no teste de privilégios da migration) e por um `refine` de Zod em
`lib/auth/schemas.ts` restrito a `30 | 50 | 80`. Renomear esse código para `70` exigiria uma
migration (alterar a constraint, a função SQL e todos os dados já gravados) — o que esta
sessão está explicitamente instruída a não fazer agora.

**Resolução adotada:** o preço exibido foi desacoplado do código interno em todo lugar que
mostra preço ao usuário (`app/onboarding/plan-step.tsx`, `app/onboarding/review-step.tsx`,
`components/marketing/LandingPage.tsx`). `plan_code = 80` continua existindo no banco como
identificador técnico opaco; o texto sempre mostra "R$ 70/mês". Uma futura task de
implementação de gates pode, se desejado, renomear a constraint para `70` — mas isso é uma
decisão separada, com sua própria migration e plano de dados existentes.

## 2. O que é igual em todos os planos (nunca gateado)

Segurança e a operação básica da loja não são diferencial comercial — são requisito da
plataforma inteira. Nunca escrever "segurança avançada só no Profissional" ou equivalente.

- Catálogo público com link próprio, categorias e busca
- Carrinho e checkout sem cadastro do cliente final
- Recebimento via Pix (Mercado Pago do próprio lojista)
- Pedidos e controle de estoque (baixa automática)
- Painel administrativo
- Isolamento multi-tenant via RLS, autenticação seguura, HTTPS, credenciais criptografadas
- Recuperação de senha
- Responsividade / experiência mobile completa

## 3. Matriz oficial

### Essencial — R$ 30/mês

**Limites:** 1 loja · 50 produtos · 3 imagens/produto · 1 usuário administrador.

Inclui a base comum (seção 2) + identidade visual padrão da CaraffaStore + assinatura
"Criado com CaraffaStore" no rodapé do storefront + suporte por e-mail.

### Crescimento — R$ 50/mês — Recomendado

Não usar "Mais escolhido" enquanto não houver dado real para afirmar isso — usar apenas
"Recomendado".

**Limites:** 1 loja · 250 produtos · 8 imagens/produto · até 3 usuários da equipe.

Tudo do Essencial, mais:

- **Personalização:** logo próprio, cores principais, banner da loja, identidade
  personalizada no storefront, remoção da assinatura "Criado com CaraffaStore"
- **Gestão:** dashboard completo (indicadores de vendas, pedidos, estoque), alerta de
  estoque baixo
- **Marketing:** cupons de desconto
- **Equipe:** até 3 usuários com acesso administrativo
- **Suporte:** prioritário

### Profissional — R$ 70/mês

**Limites:** até 3 lojas · produtos "ilimitados" comercialmente (mantendo política de uso
justo contra abuso técnico — não criar um limite artificial baixo) · 12 imagens/produto ·
até 5 usuários da equipe.

Tudo do Crescimento, mais:

- **Multiloja:** administrar até 3 lojas na mesma conta, com seletor e gestão isolada por
  loja
- **Gestão avançada:** relatórios mais completos, visão consolidada quando tecnicamente
  aplicável, exportação de pedidos e de dados/relatórios
- **Domínio:** possibilidade de domínio próprio na loja
- **Equipe:** até 5 usuários administrativos
- **Suporte:** prioritário

## 4. Comportamento ao atingir um limite (quando implementado)

Nunca quebrar a loja existente. Se o Essencial tem 50 produtos e o lojista tenta cadastrar
o 51º:

- os 50 produtos existentes continuam funcionando normalmente;
- a loja continua vendendo, recebendo pedidos e baixando estoque;
- o sistema apenas impede a criação do produto além do limite;
- mensagem amigável: **"Você chegou ao limite de 50 produtos do plano Essencial."**
- CTA: **"Conhecer o plano Crescimento"**

Mesma filosofia para limite de imagens, usuários e lojas.

## 5. Downgrade

Dados nunca são destruídos automaticamente por troca de plano. Exemplo: uma conta
Profissional com 400 produtos tentando ir para o Essencial (limite 50) — o downgrade deve
ser **bloqueado** ou entrar em **estado de adequação** até o lojista ficar dentro do novo
limite (ex.: despublicar/arquivar produtos manualmente). Nunca apagar produtos, imagens ou
lojas automaticamente.

## 6. Upgrade

Upgrade preserva tudo e libera os novos limites/recursos imediatamente após a confirmação
do pagamento — quando a cobrança automática (TASK-007) existir. Hoje, sem cobrança
recorrente implementada, upgrade/downgrade de plano é um processo manual combinado com o
suporte, como já documentado em `app/termos/page.tsx` (seção 4).

## 7. Auditoria — o que já existe vs. o que falta

Levantamento no código em 2026-08-09, antes de qualquer alteração de texto público.
Classificação: **A** implementado · **B** parcial · **C** não implementado.

| Item | Status | Onde / observação |
|---|---|---|
| Catálogo, categorias, busca, produto, carrinho, checkout | A | `lib/catalog/*`, `app/loja/**` — comum a todos os planos, não é diferenciador |
| Pix via Mercado Pago (credenciais do lojista) | A | `lib/payments/**` |
| Pedidos (lista, detalhe, cancelamento) | A | `lib/orders/service.ts`, `app/dashboard/orders/**` |
| Controle de estoque (baixa automática + ajuste manual) | A | `lib/catalog/service.ts` (`adjustStock`) |
| Painel administrativo, autenticação, RLS, recuperação de senha | A | `lib/tenant/**`, `lib/auth/**` |
| Assinatura "Criado com CaraffaStore" no storefront | A — **mas sem gate** | `app/loja/[storeSlug]/layout.tsx:11-13`. Hoje aparece para TODAS as lojas incondicionalmente; a remoção para Crescimento/Profissional (item C abaixo) ainda não existe |
| Múltiplas lojas por conta (modelo de dados) | B | `store_members` já permite N vínculos usuário↔loja e `app/select-store` já lista/alterna entre lojas existentes — mas isso hoje só é alcançado via fixtures/seed, nunca pela própria conta |
| Criar uma 2ª loja pela própria conta (self-service) | **C** | `lib/onboarding/service.ts` lança `already_has_store` e barra explicitamente — não existe fluxo de "nova loja" para quem já tem uma |
| Convite de membro de equipe para uma loja | **C** | Tabela `store_members` com `role: owner\|admin\|staff` existe (`lib/supabase/types.ts:96-127`), mas nenhuma UI/Server Action de convite foi encontrada em `app/dashboard/**` |
| Limite de produtos por plano | **C** | `lib/products/service.ts` / `lib/catalog/service.ts` não têm nenhuma contagem ou limite — cadastro é ilimitado hoje em todos os planos |
| Limite de imagens por produto | **C** | `lib/catalog/image-validation.ts` só valida tamanho (`MAX_IMAGE_SIZE_BYTES`) e mime type — nenhum limite de quantidade |
| Logo / cores / banner personalizados no storefront | **C** | Tabela `stores` (`lib/supabase/types.ts:69-90`) não tem colunas de logo, cor ou banner |
| Remoção da assinatura "Criado com CaraffaStore" | **C** | Ver acima — hoje é incondicional, não existe flag por plano |
| Cupons de desconto | **C** | Nenhuma tabela, schema ou rota relacionada a cupom no código |
| Alerta de estoque baixo | **C** | Nenhum threshold ou notificação de estoque encontrado |
| Dashboard completo (indicadores de vendas/pedidos/estoque) | **C** | `app/dashboard/page.tsx` hoje é estático: 4 atalhos + lista fixa de dicas, sem nenhuma métrica real |
| Relatórios avançados / exportação de pedidos e dados | **C** | Nenhuma rota ou Server Action de exportação encontrada |
| Domínio próprio | **C** | Nenhum campo de domínio customizado nem lógica de roteamento por domínio |
| Suporte prioritário | N/A | Processo operacional (SLA de atendimento), não depende de código — não auditável no repositório |
| Cobrança recorrente / gates de plano em geral | **C** | Fora de escopo desta task por decisão explícita — é a TASK-007 |

## 8. O que isso significa para a landing (esta sessão)

Por causa da coluna "C" acima ser praticamente toda a diferenciação prometida na seção 3,
a landing **não pode** apresentar bullets de "logo personalizado", "cupons", "dashboard
completo", "relatórios", "domínio próprio" ou "multiloja" como recursos disponíveis hoje —
isso violaria a regra "não anunciar como disponível o que ainda não foi implementado".

O que a landing pode mostrar com honestidade, e o que foi feito:

- os três nomes, preços e o destaque "Recomendado" no Crescimento (texto comercial, não
  depende de código);
- a frase de posicionamento de cada plano (marketing, não é alegação de feature);
- o bloco "Todos os planos incluem", com os recursos reais da seção 2 (já existia desde o
  PASS 1 e continua correto);
- os cards de plano continuam com a arquitetura visual definitiva (nível 1/2/3, card
  central em destaque) — pronta para receber os bullets reais assim que os itens "C" desta
  tabela forem implementados em uma task própria.

Os limites numéricos (50/250/produtos ilimitados, 3/8/12 imagens, 1/3/5 usuários, 1/1/3
lojas) descritos na seção 3 são a especificação comercial oficial para quando os gates
existirem — **não são exibidos na landing agora** porque publicá-los hoje implicaria um
enforcement que não existe: um lojista Essencial pode, tecnicamente, cadastrar mais de 50
produtos agora mesmo, e isso não pode ser escondido do usuário através de uma promessa de
limite não aplicado.
