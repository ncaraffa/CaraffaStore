# Prompt para o Claude Code — TASK-001

Você implementará a `TASK-001 — Fundação do projeto e arquitetura multi-tenant` deste repositório.

Antes de alterar qualquer arquivo, leia:

- `AGENTS.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/SECURITY.md`
- `docs/TESTING.md`
- `docs/HANDOFF.md`
- `tasks/ready/TASK-001.md`

Regras obrigatórias:

1. Trabalhe em branch ou worktree própria; não edite a `main` diretamente.
2. Não faça deploy, merge, cobrança real ou alteração em produção.
3. Não use credenciais reais. Forneça apenas `.env.example` seguro.
4. Não invente decisões sobre planos, Pix, domínio ou branding.
5. Antes de consolidar decisões estruturais relevantes, apresente proposta, alternativas e riscos para aprovação de Caraffa.
6. Trate isolamento multi-tenant como requisito crítico: autorização no servidor e RLS com negação por padrão, nunca apenas filtros do cliente.
7. Use Loja A e Loja B de `docs/TESTING.md` e prove por testes automatizados que não há acesso cruzado.
8. Não amplie o escopo além da TASK-001.

Entregue ao final:

- resumo objetivo da implementação;
- branch/worktree utilizada;
- lista de arquivos e áreas alteradas;
- decisões tomadas e decisões ainda pendentes;
- comandos e resultados de lint, testes e build;
- evidências dos testes de isolamento Loja A versus Loja B;
- riscos restantes e instruções claras para QA;
- atualização de `docs/HANDOFF.md`, sem marcar a tarefa como DONE.
