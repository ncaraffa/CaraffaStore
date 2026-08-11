<div align="center">

# 🧪 CaraffaStore

### Sua loja virtual, do catálogo ao Pix — sem comissão por venda.

SaaS multi-tenant para pequenos comerciantes criarem, administrarem e divulgarem suas próprias lojas virtuais.

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)

[🌐 Ver aplicação](https://caraffastore.vercel.app) · [🐛 Reportar problema](https://github.com/ncaraffa/CaraffaStore/issues)

</div>

---

## Sobre o projeto

A **CaraffaStore** permite que cada comerciante monte sua própria loja, cadastre produtos com fotos, preço e estoque e venda diretamente por um link público personalizado.

O cliente final compra sem precisar criar conta e paga via **Pix diretamente na conta Mercado Pago do lojista**. A plataforma não cobra comissão sobre vendas: o comerciante paga apenas uma assinatura mensal fixa.

### Planos

- **Essencial — R$ 30/mês**
- **Crescimento — R$ 50/mês**
- **Profissional — R$ 70/mês**

A assinatura também é paga via Pix, com ativação automática da loja após a confirmação do pagamento.

## Principais funcionalidades

- Cadastro, login, recuperação de senha e onboarding do lojista
- Arquitetura multi-tenant com isolamento entre lojas
- Catálogo público por loja em `/loja/[slug]`
- Produtos, categorias, fotos, preços e controle de estoque
- Carrinho persistente e checkout sem conta para o cliente final
- Pedidos com acompanhamento de status
- Pagamento Pix integrado ao Mercado Pago
- Painel responsivo para produtos, categorias, pedidos e pagamentos
- Papéis de acesso `owner`, `admin` e `staff`
- Assinatura SaaS com ativação automática via webhook

## Dois contextos de pagamento, sempre separados

A CaraffaStore mantém fronteiras explícitas entre dois fluxos financeiros:

1. **Assinatura da plataforma** — o lojista paga a mensalidade da CaraffaStore.
2. **Venda da loja** — o cliente paga o pedido diretamente na conta Mercado Pago daquele lojista.

Credenciais, webhooks e operações administrativas desses contextos não são compartilhados. A plataforma não recebe nem intermedeia o dinheiro das vendas dos comerciantes.

## Stack

- **Frontend e servidor:** Next.js 16, App Router, React 19 e TypeScript
- **Banco e autenticação:** Supabase Auth + PostgreSQL
- **Autorização:** Row Level Security com estratégia deny-by-default
- **Arquivos:** Supabase Storage
- **Pagamentos:** Mercado Pago Pix
- **Estilos:** CSS Modules + design tokens próprios
- **Testes:** Vitest
- **Deploy:** Vercel + Supabase gerenciado

> O projeto não utiliza Tailwind nem biblioteca pronta de componentes. A interface e o design system foram construídos especificamente para a CaraffaStore.

## Segurança e multi-tenancy

O slug presente na URL serve apenas para roteamento. A autorização é derivada da sessão autenticada e da associação do usuário com a loja em `store_members`.

O isolamento é aplicado em duas camadas:

- validações server-side nas rotas, serviços e Server Actions;
- políticas RLS no PostgreSQL, negadas por padrão.

Operações sensíveis de pagamento exigem papel `owner` ou `admin` antes de qualquer leitura de credencial ou chamada ao provedor.

## Executando localmente

### Requisitos

- Node.js 20+
- Docker Desktop
- Supabase CLI

### Instalação

```bash
git clone https://github.com/ncaraffa/CaraffaStore.git
cd CaraffaStore
npm install
cp .env.example .env.local
```

Inicie o Supabase local e aplique migrations/fixtures:

```bash
npx supabase start
npx supabase db reset
npm run seed:local
```

Depois inicie a aplicação:

```bash
npm run dev
```

Acesse `http://localhost:3000`.

> Use somente credenciais locais ou de teste no ambiente de desenvolvimento. Nunca versione `.env.local` ou segredos reais.

## Qualidade

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

A suíte cobre regras de autenticação, autorização, isolamento de tenant, catálogo, pedidos, pagamentos, webhooks e políticas críticas das migrations.

## Estrutura principal

```text
app/          rotas, páginas, APIs e Server Actions
components/   componentes e design system
lib/          regras de negócio e integrações
supabase/     migrations, fixtures e testes de banco
docs/         arquitetura, decisões e documentação
tasks/        especificações e histórico de implementação
qa/           evidências e relatórios de qualidade
```

## Status

A CaraffaStore está em desenvolvimento ativo. O ambiente público é destinado à demonstração e evolução do produto.

---

<div align="center">

Feito para ajudar pequenos comerciantes a vender online com simplicidade. 💙

</div>
