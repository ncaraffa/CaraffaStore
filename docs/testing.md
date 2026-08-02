# Estratégia de testes

## Gates mínimos

- Testes automatizados relevantes aprovados.
- Build concluído sem erro.
- QA funcional e responsivo.
- Teste explícito de isolamento Loja A versus Loja B.
- Ausência de bloqueadores críticos.

## Lojas fictícias

### Loja A — Mercado Aurora

- Tenant de teste: `store-a`
- Administrador: `admin-a@example.test`
- Cliente: `cliente-a@example.test`
- Produto exemplo: Café Aurora, estoque 20.

### Loja B — Empório Horizonte

- Tenant de teste: `store-b`
- Administrador: `admin-b@example.test`
- Cliente: `cliente-b@example.test`
- Produto exemplo: Chá Horizonte, estoque 15.

Dados e credenciais são fictícios e não devem ser usados em produção.

## Matriz de isolamento

| Ação | Identidade | Recurso | Resultado esperado |
|---|---|---|---|
| Ler produto da Loja A | Admin A | Produto A | Permitido |
| Alterar produto da Loja A | Admin A | Produto A | Permitido |
| Ler produto da Loja B | Admin A | Produto B | Negado/sem dados |
| Alterar produto da Loja B | Admin A | Produto B | Negado |
| Ler pedidos da Loja A | Admin B | Pedidos A | Negado/sem dados |
| Alterar estoque da Loja A | Admin B | Estoque A | Negado |
| Acessar painel sem sessão | Anônimo | Painel A ou B | Negado |
| Ver catálogo público A | Anônimo | Catálogo A | Permitido conforme publicação |
| Consultar catálogo B pela URL A | Anônimo | Produto B | Não encontrado |
| Forjar `store_id` no cliente | Admin A | Recurso B | Negado no servidor/RLS |
| Executar função/API de A com ID de B | Admin A | Recurso B | Negado e registrado com segurança |
| Superadmin autorizado | Superadmin | A ou B | Conforme política explícita e auditável |

Essa matriz deve crescer junto com novos módulos: categorias, pedidos, cupons, avaliações, banners, relatórios, Pix e assinaturas.
