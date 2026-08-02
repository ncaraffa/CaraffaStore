# Registro de decisões

## Confirmadas

| ID | Decisão | Estado |
|---|---|---|
| DEC-001 | Plataforma voltada a pequenos comerciantes. | Confirmada |
| DEC-002 | Arquitetura multi-tenant com isolamento absoluto. | Confirmada |
| DEC-003 | Pagamentos exclusivamente via Pix. | Confirmada |
| DEC-004 | Plano mensal de R$ 30. | Confirmada |
| DEC-005 | Plano mensal de R$ 50. | Confirmada |
| DEC-006 | Plano mensal de R$ 80. | Confirmada |

## Pendentes de Caraffa

| ID | Decisão necessária |
|---|---|
| PEN-001 | Nome comercial definitivo. |
| PEN-002 | Limites e benefícios de cada plano. |
| PEN-003 | Como cada comerciante receberá o Pix das vendas. |
| PEN-004 | Provedor definitivo de pagamentos. |
| PEN-005 | Existência e duração do período de teste. |
| PEN-006 | Regra de inadimplência, tolerância, suspensão e reativação. |
| PEN-007 | Política de domínio próprio. |

Novas decisões devem registrar data, contexto, alternativas, responsável pela aprovação e consequência.

## Propostas técnicas de Claude Code (TASK-001) — aguardando revisão de Caraffa

Estas são decisões estruturais propostas durante a implementação da
TASK-001, ainda não aprovadas. Nenhuma foi aplicada fora de ambiente
local/dev.

| ID | Proposta | Alternativas consideradas | Risco se aprovada como está |
|---|---|---|---|
| PROP-001 | Resolução de tenant: o slug da loja na URL só roteia; autorização vem exclusivamente do cruzamento `auth.uid()` × `store_members`, validado no servidor (`lib/tenant/context.ts`) e reforçado por RLS no banco. | (a) confiar no `store_id` enviado pelo cliente — rejeitada, viola isolamento; (b) subdomínio por loja — adiada, depende de decisão de domínio (PEN-007). | Baixo — é a abordagem mais conservadora; principal custo é uma consulta extra de membership por requisição. |
| PROP-002 | Papéis mínimos em `store_members`: `owner`, `admin`, `staff`. Somente `owner`/`admin` podem escrever; `staff` só lê (proposto, ainda não usado em nenhuma regra de negócio real). | Papel único "member" sem granularidade — mais simples, mas não distingue quem pode editar produtos de quem só deveria visualizar. | Baixo — modelo pequeno e extensível; nomes/limites finais dependem de decisão de produto futura. |
| PROP-003 | Mensagem de erro idêntica ("Loja não encontrada ou sem acesso.") tanto para loja inexistente quanto para loja existente sem vínculo do usuário, para não permitir enumeração de lojas reais por tentativa e erro. | Mensagens diferenciadas ("não encontrada" vs "sem permissão") — mais amigável para debug, mas vaza quais slugs existem. | Nenhum risco de segurança adicional; leve perda de clareza em mensagens de erro para desenvolvedores. |
| PROP-004 | RLS das tabelas `stores`/`store_members` não tem policy de INSERT/UPDATE para usuários comuns (negado por padrão) — criação de loja e gestão de membros ficam fora do escopo da TASK-001, propositalmente sem fluxo ainda. | Permitir que qualquer usuário autenticado crie sua própria loja — rejeitada por enquanto: precisa de decisão sobre onboarding/planos antes de existir. | Nenhum — é mais restritivo que o necessário até existir decisão de onboarding; não bloqueia nada da TASK-001. |

Detalhes completos, alternativas e evidência de testes: `docs/HANDOFF.md`
e o resumo de entrega da TASK-001.
