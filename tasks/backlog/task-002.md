# TASK-002 — Autenticação e onboarding do comerciante

**Status:** BACKLOG  
**Responsável:** Claude Code (após refinamento)

## Objetivo

Permitir que um comerciante crie sua conta, crie ou aceite acesso a uma loja e conclua o onboarding inicial com contexto de tenant seguro.

## Contexto

Depende da fundação multi-tenant e do modelo de membros validados na TASK-001.

## Regras de negócio

- Sessão autenticada não implica acesso a qualquer loja.
- Criação e convite de membros respeitam papéis aprovados.
- Dados mínimos da loja: nome, contato e configurações iniciais a confirmar.

## Critérios de aceitação

- Cadastro, login, logout e recuperação funcionam no ambiente de desenvolvimento.
- Comerciante cria uma loja e torna-se membro autorizado conforme papel aprovado.
- Troca/acesso de tenant é validado no servidor.
- Erros e estados de carregamento são claros e acessíveis.
- Testes cobrem Loja A, Loja B e tentativas de acesso cruzado.
- Testes, lint, build e QA passam.

## Áreas provavelmente afetadas

Autenticação, onboarding, stores, store members, UI e testes.

## Dependências

TASK-001; definição dos papéis mínimos; política de convites.

## Riscos

Enumeração de lojas, convite indevido, sessão ligada ao tenant errado e vazamento em mensagens de erro.

## Casos de teste

Cadastro válido/inválido; recuperação; criação de loja; convite expirado; usuário sem membership; Admin A tentando abrir Loja B; responsividade.

## Fora do escopo

Assinatura paga, Pix, catálogo, domínio próprio e superadmin completo.
