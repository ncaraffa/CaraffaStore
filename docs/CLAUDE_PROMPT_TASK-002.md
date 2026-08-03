# Prompt para Claude Code — TASK-002

**STATUS: AUTORIZADO PARA IMPLEMENTAÇÃO EM BRANCH/WORKTREE PRÓPRIA.**

**Tarefa:** `tasks/ready/task-002.md`

**Aprovação de escopo:** Caraffa, 2026-08-03
**Decisões:** `T2-DEC-001` a `T2-DEC-011` em `docs/DECISIONS.md`

Claude Code, implemente a TASK-002 — Autenticação e onboarding inicial do comerciante.

## Fonte de verdade

Repositório:

```text
C:\Users\Nicolas\.openclaw\workspace\commerce-platform
```

Antes de alterar qualquer arquivo, leia integralmente:

- `AGENTS.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/SECURITY.md`
- `docs/TESTING.md`
- `docs/HANDOFF.md`
- `docs/ROADMAP.md`
- `tasks/ready/task-002.md`
- `tasks/done/task-001.md`

As decisões aprovadas são vinculantes. Se houver contradição técnica que impeça cumpri-las, pare e reporte antes de implementar; não improvise regra comercial, autenticação, pagamento ou permissão.

## Processo obrigatório

1. Confirme `master` limpa e registre o HEAD-base.
2. Crie branch/worktree própria para TASK-002; não altere `master` diretamente.
3. Antes de implementar, apresente plano, arquivos/schema afetados, migrações locais propostas, matriz de estados/redirecionamentos e riscos.
4. Alterações de schema, função ou RLS devem ser mínimas, locais/dev, reversíveis, documentadas e testadas contra Supabase/Postgres real.
5. Não faça merge nem deploy.

## Decisões aprovadas — implementar exatamente

1. Cadastro por e-mail e senha; magic link fora do escopo.
2. Verificação de e-mail obrigatória antes da criação da loja. Usuário não verificado acessa somente confirmação/reenvio e logout.
3. Arquitetura suporta múltiplas lojas; MVP permite criar somente uma loja própria por usuário.
4. Múltiplos memberships e participação em lojas de terceiros continuam suportados; sem convites ou gestão de funcionários nesta tarefa.
5. Plano escolhido depois de nome/slug e antes da confirmação final.
6. Loja permanece `onboarding` enquanto incompleta e termina em `pending_payment` quando o onboarding é concluído.
7. Antes do pagamento, somente área limitada de configuração/estado/conta; painel operacional bloqueado.
8. Dados mínimos: nome do comerciante, nome da loja, WhatsApp, slug e plano.
9. Slug editável durante `onboarding` e bloqueado após conclusão.
10. TASK-002 cria somente o vínculo `owner`.
11. Política de senha e recuperação:
    - mínimo de 15 caracteres;
    - aceitar pelo menos 64 caracteres;
    - permitir espaços e frases-senha;
    - não exigir composição obrigatória de maiúsculas, minúsculas, números e símbolos;
    - preparar/ativar bloqueio de senhas conhecidas como vazadas;
    - não exigir alteração periódica sem evidência de comprometimento;
    - recuperação com resposta não enumerável e token expirável/seguro;
    - rate limiting em cadastro, login e recuperação;
    - preparar suporte a CAPTCHA em cadastro e recuperação, sem obrigação de ativá-lo no desenvolvimento local;
    - cadastro, login e recuperação nunca confirmam se determinado e-mail já possui conta.

## Regras adicionais vinculantes

- O fluxo público nunca alcança `active` nesta tarefa.
- Ao concluir onboarding, a loja termina em `pending_payment`.
- A tela `pending_payment` é apenas informativa, sem cobrança falsa, QR Code ou Pix simulado.
- Seeds/testes podem criar lojas `active` exclusivamente para validar guards e redirecionamentos.
- Redirects de confirmação, recuperação e retorno aceitam somente destinos internos previamente autorizados; bloquear open redirect.
- Criação da loja, vínculo `owner`, plano inicial e auditoria deve ser atômica e idempotente.
- Usuário com memberships em múltiplas lojas exige seleção explícita; nunca escolher silenciosamente a primeira.
- Nenhum campo do cliente define `owner_id`, `store_id`, `role`, `status` ou permissões.
- Slug apenas roteia; autorização deriva de `auth.uid()` × `store_members`, reforçada por RLS.

## Escopo obrigatório

- cadastro, verificação, login, logout e recuperação;
- sessão Supabase SSR segura;
- onboarding persistente e retomável em processo/sessão novos;
- validação de etapas e bloqueio de saltos;
- nome do comerciante, nome/slug/WhatsApp da loja e plano inicial;
- criação atômica/idempotente da primeira loja + owner + plano + auditoria;
- códigos fechados para planos R$ 30/R$ 50/R$ 80, somente como registro;
- estados `onboarding`, `pending_payment`, `active`, `suspended` e guards aprovados;
- redirecionamentos corretos e proteção server-side/RLS;
- tratamento de usuário sem loja, uma loja e múltiplas lojas;
- auditoria mínima sanitizada;
- isolamento Loja A × Loja B;
- acessibilidade e responsividade básicas dos fluxos.

## Proibições

Não implementar:

- cobrança, assinatura, renovação ou inadimplência real;
- Pix, QR Code, webhook ou Mercado Pago real;
- ativação pública/fictícia da loja;
- benefícios ou limites dos planos;
- checkout, pedidos ou catálogo completo;
- domínio personalizado;
- convites ou gestão de funcionários;
- superadmin completo;
- credenciais reais, produção, merge ou deploy.

## Segurança inegociável

- Negação por padrão e menor privilégio.
- Usuário autenticado sem membership não acessa tenant.
- O cliente não escolhe tenant autorizado, usuário proprietário, papel, estado, plano aceito ou transição.
- Operação final do onboarding deve ter transação/rollback e proteção contra retry/concor­rência.
- Slug deve ser normalizado, validado, único e protegido por constraint real.
- Mensagens de autenticação e recuperação devem ser não enumeráveis.
- Tokens, cookies, senhas, chaves, headers e URLs completas de recuperação nunca entram em logs.
- Service role nunca chega ao frontend ou a fluxo de usuário.
- Funções `SECURITY DEFINER`, se inevitáveis, usam nomes qualificados, `search_path` seguro e grants mínimos.
- Rate limiting é obrigatório. CAPTCHA deve ficar preparado/configurável para cadastro e recuperação.

## Testes obrigatórios

### Autenticação e senha

- cadastro válido e inválido;
- limites 14, 15, 64 e, conforme limite implementado, acima de 64 caracteres;
- espaços e frases-senha aceitos;
- ausência de exigência artificial de composição;
- senha vazada bloqueada ou configuração preparada e testada;
- login válido, inválido e resposta não enumerável;
- rate limiting de cadastro, login e recuperação;
- CAPTCHA configurável/preparado sem quebrar desenvolvimento local;
- logout;
- verificação/reenvio/cooldown;
- usuário não verificado restrito às rotas aprovadas;
- recuperação para e-mail existente/inexistente com resposta equivalente;
- token válido, inválido, expirado e reutilizado;
- open redirect bloqueado em confirmação, recuperação e retorno.

### Onboarding e estados

- salvar e retomar cada etapa após nova sessão;
- impedir salto de etapa;
- validar dados mínimos;
- slug inválido, reservado, duplicado e corrida concorrente;
- plano fora de `30|50|80` rejeitado;
- conclusão cria exatamente uma loja, um owner, um plano e uma auditoria;
- retry idempotente não duplica registros;
- falha intermediária faz rollback completo;
- fluxo público termina em `pending_payment` e nunca `active`;
- `pending_payment` informa sem simular cobrança/Pix;
- seeds/testes com `active` validam redirecionamentos sem abrir caminho público de ativação;
- slug bloqueado após conclusão.

### Autorização e isolamento

- Loja A não lê/altera onboarding, perfil, membership ou auditoria da Loja B e vice-versa;
- anônimo bloqueado;
- autenticado sem loja recebe onboarding, não painel;
- múltiplos memberships exigem seleção explícita e só autorizam lojas vinculadas;
- criação de segunda loja própria bloqueada no MVP sem prejudicar múltiplos memberships;
- membership removido perde acesso;
- forja de slug, `store_id`, `owner_id`, `user_id`, `role`, `status`, plano, permissão ou etapa bloqueada;
- RLS e funções testadas contra Supabase/Postgres local real, sem contar execução como superusuário como prova.

### Gates

Execute e registre:

```text
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm audit
npm audit --omit=dev
```

Execute também o roteiro real de Supabase, incluindo repetição para idempotência/estado residual, matriz Loja A × Loja B e busca automática por vazamento de credenciais nos logs.

## Entrega ao Júnior para QA

Não mova para DONE e não faça merge. Informe:

1. branch/worktree, HEAD-base e commits;
2. arquivos e migrações alterados;
3. decisões implementadas;
4. matriz de estados e redirecionamentos;
5. resultados dos gates e contagem de testes;
6. evidência Supabase real, atomicidade, idempotência e RLS;
7. evidência dos testes negativos e Loja A × Loja B;
8. evidência de rate limiting, política de senha, recuperação e não enumeração;
9. evidência de não vazamento de segredos;
10. riscos/limitações e roteiro reproduzível de QA;
11. confirmação explícita de que não houve merge, deploy, Pix ou cobrança real.
