# Visão do produto

## Objetivo

Plataforma SaaS multi-tenant para pequenos comerciantes criarem e administrarem lojas virtuais sem compartilhar dados entre si.

O nome comercial ainda não foi definido. “Loja SaaS” é apenas uma referência provisória e não deve orientar branding ou nomes técnicos irreversíveis.

## Público-alvo

Pequenos comerciantes que precisam publicar catálogo, receber pedidos e pagamentos via Pix e operar a loja em um painel simples.

## Capacidades previstas

- Configuração da loja: nome, logo, cores, WhatsApp, endereço e horário.
- Catálogo: produtos, categorias, busca e estoque.
- Venda: carrinho, checkout, pedidos e pagamento somente via Pix.
- Operação: painel administrativo, cupons, avaliações, banners, contato e relatórios.
- Plataforma: personalização, assinaturas mensais e administração central.

## Princípios

- Isolamento absoluto entre tenants.
- Pix como única forma de pagamento, salvo aprovação futura de Caraffa.
- Decisões comerciais críticas exigem aprovação de Caraffa.
- Entregas pequenas, testáveis e documentadas.

## MVP a confirmar

O recorte final do MVP será aprovado na Fase 0. A primeira fundação deve priorizar identidade de tenant, autenticação, isolamento, testes e ambientes seguros antes dos fluxos comerciais.

## Fora da decisão atual

- Nome e identidade comercial definitivos.
- Benefícios e limites definitivos dos planos.
- Provedor de pagamento e modelo de recebimento do Pix.
- Cobrança real, deploy em produção e migrações destrutivas.
