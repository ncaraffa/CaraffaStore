# TASK-001 — Fundação do projeto e arquitetura multi-tenant

**Status:** READY  
**Responsável:** Claude Code

## Objetivo

Criar a fundação executável do projeto com Next.js, TypeScript e Supabase, incluindo modelo inicial de lojas e membros, contexto seguro de tenant e testes que provem o isolamento entre Loja A e Loja B.

## Contexto

Uma aplicação atenderá várias lojas. Isolamento entre tenants é requisito crítico. A implementação deve ocorrer em branch ou worktree própria, sem deploy ou uso de credenciais de produção.

## Regras de negócio

- Cada recurso de negócio deve pertencer inequivocamente a uma loja.
- Usuário só acessa loja da qual é membro autorizado.
- Identificador fornecido pelo cliente não constitui autorização.
- Acesso cruzado deve falhar por padrão.
- Pagamento e limites de planos estão fora desta tarefa.

## Critérios de aceitação

1. Projeto Next.js + TypeScript executa localmente e possui comandos documentados.
2. Integração Supabase é configurável por variáveis de ambiente de exemplo, sem segredos reais.
3. Modelo inicial contempla lojas, membros e papéis mínimos propostos.
4. Estratégia de resolução do tenant é documentada e validada no servidor.
5. Políticas RLS propostas/implementadas apenas em ambiente local de desenvolvimento, com justificativa e revisão explícita solicitada.
6. Fixtures criam Loja A e Loja B com usuários e dados separados.
7. Testes automatizados provam acesso permitido dentro da loja e negado entre lojas, incluindo tentativa com `store_id` forjado.
8. Lint, testes e build passam.
9. README ou handoff registra setup, comandos, decisões abertas e riscos.
10. Nenhum deploy, merge na `main`, cobrança real ou credencial real é realizado.

## Arquivos ou áreas provavelmente afetados

- Configuração do projeto e ambiente.
- Autenticação/cliente Supabase.
- Schema e migrações exclusivamente locais/de desenvolvimento.
- Camada de tenant e autorização.
- Fixtures e testes de integração.
- Documentação técnica mínima.

## Dependências

- Decidir/propor papéis mínimos de membro.
- Supabase local ou projeto de desenvolvimento isolado.
- Revisão humana de qualquer política RLS antes de ambientes compartilhados.

## Riscos

- Vazamento entre tenants por filtro apenas na aplicação.
- Elevação de privilégio por `store_id` controlado pelo cliente.
- Acoplamento prematuro a URL, domínio ou provedor Pix ainda indefinidos.

## Casos de teste

- Admin A lê/altera recurso A.
- Admin A não lê nem altera recurso B.
- Admin B não lê pedidos/estoque A.
- Anônimo não acessa painel.
- Parâmetro de tenant forjado é rejeitado.
- Consultas sem filtro explícito continuam seguras por RLS.
- Loja A e Loja B podem usar nomes de produtos iguais sem colisão.

## Fora do escopo

- Catálogo completo, carrinho, checkout e pedidos.
- Integração Pix, webhooks ou assinaturas.
- Limites dos planos e domínio próprio.
- Deploy, produção e migrações destrutivas.

## Evidência necessária

Resultados de lint, testes, build e testes Loja A versus Loja B, além de resumo das decisões arquiteturais propostas.
