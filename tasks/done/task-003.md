# TASK-003 — Catálogo, produtos e categorias

**Status:** DONE
**Responsável:** Claude Code
**Branch:** feat/TASK-003-catalog-products (mesclada na master via `git merge --no-ff`, histórico preservado)
**HEAD-base:** b7e10c315e94b98293395a8d814e0fdfb0c2b7ca (master, TASK-001/002 DONE)

**Decisões aprovadas por Caraffa (2026-08-04):** sem variantes nesta tarefa (preço/estoque únicos por
produto); até 5 imagens por produto via Supabase Storage com capa/ordenação; estoque nunca negativo,
ajuste atômico, produto publicado com estoque zero permanece visível como "Esgotado".

**Aprovação final:** verificação adversarial encontrou 3 bloqueadores (crítico/alto), corrigidos no
commit `685e3aab7d400c915832b58512216ed9b1a73604` e reverificados — ver
`qa/reports/TASK-003-CLAUDE-VERIFICATION.md` e `qa/reports/TASK-003-FINAL-APPROVAL.md`.

## Objetivo

Permitir que cada loja administre categorias, produtos e estoque e publique um catálogo isolado das demais lojas.

## Contexto

Primeiro módulo operacional sobre a fundação multi-tenant e autenticação.

## Regras de negócio

- Produtos e categorias pertencem a uma única loja.
- Estoque nunca pode ser alterado por membro de outra loja.
- Regras finais de variantes, imagens e estoque negativo ainda precisam de refinamento.

## Critérios de aceitação

- CRUD de categorias e produtos com validação e autorização.
- Catálogo público mostra somente itens publicados do tenant correto.
- Busca não retorna dados de outra loja.
- Estoque é consistente e auditável no nível definido durante refinamento.
- Testes Loja A versus Loja B, lint, build e QA passam.

## Áreas provavelmente afetadas

Banco, RLS, APIs/actions, painel, loja pública, busca, imagens e testes.

## Dependências

TASK-001 e TASK-002; decisões sobre imagens, variantes, estoque e publicação.

## Riscos

Vazamento por busca/cache, colisão de slug, exposição de itens não publicados e corrida de estoque.

## Casos de teste

CRUD válido/inválido; produto inativo; busca; slug repetido entre lojas; Admin A tentando editar produto B; catálogo responsivo; estoque concorrente a detalhar.

## Fora do escopo

Carrinho, checkout, pedidos, Pix, cupons, avaliações e limites de plano.
