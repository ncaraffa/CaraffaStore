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

## Decisões aprovadas para a TASK-002 — 2026-08-03

Aprovador: Caraffa. As decisões abaixo estão confirmadas e autorizam o refinamento da TASK-002 para `READY`. Não autorizam merge, deploy, cobrança, Pix real ou produção.

| ID | Decisão aprovada | Estado |
|---|---|---|
| T2-DEC-001 | Cadastro por **e-mail e senha** no MVP; magic link fora do escopo. | Confirmada |
| T2-DEC-002 | Verificação de e-mail **obrigatória antes da criação da loja**. Usuário não verificado acessa apenas confirmação/reenvio e logout. | Confirmada |
| T2-DEC-003 | A arquitetura suporta múltiplas lojas, mas o MVP permite ao usuário criar somente **uma loja própria**. Não impor limitação estrutural incompatível com múltiplos memberships. | Confirmada |
| T2-DEC-004 | Memberships em lojas de terceiros permanecem suportados e devem ser tratados com segurança; convites e gestão de funcionários ficam fora da TASK-002. | Confirmada |
| T2-DEC-005 | O plano é escolhido depois de nome/slug e antes da confirmação final. Loja, `owner`, plano e auditoria são persistidos atomicamente na conclusão. | Confirmada |
| T2-DEC-006 | A loja permanece `onboarding` enquanto incompleta e termina em `pending_payment` ao concluir. O fluxo público da TASK-002 nunca alcança `active`. | Confirmada |
| T2-DEC-007 | Antes do pagamento, o comerciante acessa somente área limitada de configuração/estado/conta; painel operacional fica bloqueado. A tela `pending_payment` é apenas informativa, sem Pix ou cobrança simulada. | Confirmada |
| T2-DEC-008 | Dados mínimos: nome do comerciante, nome da loja, WhatsApp, slug e plano inicial; o e-mail vem da conta verificada. | Confirmada |
| T2-DEC-009 | Slug editável durante `onboarding` e bloqueado após a conclusão/transição para `pending_payment`. | Confirmada |
| T2-DEC-010 | Sem convites ou gestão de funcionários na TASK-002; ela cria somente o vínculo `owner`. | Confirmada |
| T2-DEC-011 | Senha com mínimo de **15 caracteres** e suporte a pelo menos **64 caracteres**; espaços e frases-senha permitidos; sem composição obrigatória; preparar/ativar bloqueio de senhas vazadas; sem troca periódica sem evidência de comprometimento; recuperação não enumerável, token expirável/seguro, rate limiting em cadastro/login/recuperação e suporte preparado para CAPTCHA em cadastro/recuperação. | Confirmada |

### Decisões adicionais de implementação aprovadas

- Seeds e testes podem criar lojas `active` exclusivamente para validar proteção e redirecionamentos; o fluxo público não pode fazê-lo.
- Redirecionamentos de confirmação e recuperação aceitam somente destinos internos previamente autorizados.
- Criação da loja, vínculo `owner`, plano inicial e auditoria deve ser atômica e idempotente.
- Usuários com memberships em mais de uma loja exigem tratamento e seleção explícitos, ainda que a criação de uma segunda loja própria esteja bloqueada no MVP.
- Nenhum campo do cliente pode definir `owner_id`, `store_id`, `role`, `status` ou permissões.
- Mensagens de cadastro, login e recuperação nunca confirmam se o e-mail já possui conta.
- Preservar `PROP-001`: slug roteia; autorização deriva de `auth.uid()` × `store_members` e RLS.
- Preservar papéis `owner|admin|staff`, mas a TASK-002 cria somente `owner`.
- Registrar o plano inicial como código fechado equivalente a `30|50|80`, sem benefícios, cobrança, assinatura ou entitlement.
- Progresso do onboarding é server-side, vinculado a `auth.uid()` e não pode ser avançado por campos arbitrários do cliente.
