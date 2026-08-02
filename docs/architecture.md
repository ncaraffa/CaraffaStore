# Arquitetura preliminar

> Documento de direção, não autorização para implementação estrutural. Decisões críticas devem ser propostas pelo Claude Code e aprovadas por Caraffa.

## Direção confirmada

- Aplicação única, multi-tenant.
- Stack pretendida: Next.js, TypeScript e Supabase.
- Toda entidade de negócio pertencente a uma loja deve possuir vínculo de tenant verificável.
- Autorização e RLS devem aplicar negação por padrão e impedir acesso cruzado.
- Ambientes de desenvolvimento, testes e produção devem permanecer separados.

## Contexto do tenant

O método definitivo de resolução do tenant ainda será definido. Nenhum identificador fornecido apenas pelo cliente pode ser tratado como autorização. O tenant autorizado deve ser derivado de contexto autenticado e validado no servidor/banco.

## Áreas iniciais

- Autenticação e perfis.
- `stores` e membros da loja.
- Resolução segura do tenant.
- Políticas RLS e testes automatizados de isolamento.
- Observabilidade sem exposição de dados sensíveis.

## Pendências arquiteturais

- Estratégia de URL: subdomínio, slug ou domínio próprio.
- Modelo de papéis e permissões.
- Estratégia de Pix e provedor.
- Reserva/baixa de estoque e idempotência.
- Política de ambientes, backups e retenção.
