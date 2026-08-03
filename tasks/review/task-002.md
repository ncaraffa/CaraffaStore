# TASK-002 — Autenticação e onboarding inicial do comerciante

**Status:** REVIEW

**Responsável pela implementação:** Claude Code
**Branch:** feat/TASK-002-auth-onboarding
**HEAD-base:** ca2435146b9d3cc63ea589410284e9e14d31c034 (master, limpo)

**Aprovação de escopo:** Caraffa, 2026-08-03 (`T2-DEC-001` a `T2-DEC-011` em `docs/DECISIONS.md`)

**Dependência concluída:** TASK-001
**Deploy:** proibido nesta tarefa

**Entrega para QA:** ver seção "Entrega da TASK-002" em `docs/handoff.md` (2026-08-03) — evidências completas, gates, testes reais Supabase/Postgres, revisão de segurança e roteiro reproduzível de QA. Não mover para `tasks/done/` nem fazer merge até aprovação do Júnior.

## Objetivo

Implementar autenticação segura e o onboarding inicial do comerciante, desde a criação da conta até a criação da primeira loja e do vínculo `owner`, preservando isolamento multi-tenant e permitindo registrar a escolha inicial de um dos planos de R$ 30, R$ 50 ou R$ 80, sem cobrança ou Pix real.

## Resultado esperado

Ao final, um comerciante deve conseguir criar e verificar a conta, autenticar-se, recuperar acesso, preencher e retomar um onboarding incompleto, escolher nome/slug/plano, criar sua primeira loja com vínculo `owner` e chegar ao estado correto da aplicação. Usuários sem loja ou com múltiplos vínculos devem receber fluxos explícitos e seguros.

## Decisões aprovadas

A implementação deve seguir `T2-DEC-001` a `T2-DEC-011` em `docs/DECISIONS.md`, sem reinterpretar ou ampliar o escopo. Em resumo:

1. cadastro por e-mail e senha;
2. verificação obrigatória antes da criação da loja;
3. arquitetura multi-loja, mas somente uma loja própria criada por usuário no MVP;
4. múltiplos memberships suportados; sem convites nesta tarefa;
5. plano após nome/slug e antes da confirmação;
6. loja em `onboarding`, terminando em `pending_payment`;
7. antes do pagamento, somente área limitada; painel operacional bloqueado;
8. nome do comerciante, nome da loja, WhatsApp, slug e plano obrigatórios;
9. slug editável no onboarding e bloqueado depois;
10. sem gestão de funcionários;
11. senha de 15 a pelo menos 64 caracteres, passphrases/espaços permitidos, sem composição arbitrária, proteção contra senhas vazadas, rate limiting e preparação para CAPTCHA.

## Escopo funcional incluído

### 1. Cadastro e verificação

- Cadastro por e-mail e senha, com mensagem neutra que nunca confirme se o e-mail já possui conta.
- Senha com mínimo de 15 caracteres; aceitar pelo menos 64 caracteres, espaços e frases-senha; não exigir composição obrigatória de maiúsculas/minúsculas/números/símbolos nem troca periódica sem comprometimento.
- Ativar bloqueio de senhas conhecidas como vazadas quando suportado no ambiente; se não puder ser ativado localmente, preparar e documentar a configuração sem reduzir o restante da política.
- Aplicar rate limiting ao cadastro e preparar suporte a CAPTCHA, sem exigir ativação no desenvolvimento local.
- Consentimentos e textos jurídicos somente como placeholders identificados, sem inventar termos definitivos.
- Conta não verificada fica restrita à tela de confirmação/reenvio e logout; não pode iniciar criação de loja nem acessar painel.
- Reenvio de verificação com cooldown e feedback genérico.

### 2. Login, sessão e logout

- Login com mensagens neutras para credencial inválida, usuário inexistente ou não verificado.
- Sessão tratada server-side com as práticas recomendadas do Supabase SSR; nenhum token em URL, log ou armazenamento inseguro.
- Logout invalida a sessão local e redireciona para login.
- URLs de retorno só aceitam destinos internos permitidos, impedindo open redirect.

### 3. Recuperação segura de acesso

- Solicitação de recuperação com resposta idêntica para e-mail existente ou inexistente, rate limiting e suporte preparado para CAPTCHA.
- Callback/token validado pelo Supabase e troca de senha em fluxo autenticado de recuperação.
- Token de uso único/expirável conforme Supabase; não registrar token nem URL completa.
- Após troca de senha, redirecionamento seguro e tratamento de link inválido/expirado.

### 4. Onboarding inicial

Etapas aprovadas:

1. conta criada;
2. e-mail verificado, se obrigatório;
3. dados mínimos do comerciante;
4. nome da loja;
5. slug/subdomínio e validação de disponibilidade;
6. escolha inicial do plano (`30`, `50` ou `80`) apenas como registro;
7. revisão;
8. criação atômica da loja + vínculo `owner` + registro do plano + evento de auditoria;
9. conclusão do onboarding e redirecionamento conforme estado da loja.

### 5. Progresso e retomada

- Progresso persistido no servidor, vinculado a `auth.uid()`, nunca confiando em etapa enviada pelo cliente como autorização.
- Salvar somente campos permitidos para a etapa atual.
- Retomar no primeiro passo incompleto após novo login, refresh ou troca de dispositivo.
- Operação final idempotente: repetição não cria segunda loja, membership ou seleção de plano.
- Transição de etapas validada; não permitir pular requisitos pelo cliente.

### 6. Loja e membership

- Criação da loja e membership `owner` na mesma transação/função segura, após validação dos requisitos.
- `store_id`, `user_id`, papel e estado são determinados no servidor/banco.
- Slug normalizado, validado e único sem revelar detalhes indevidos.
- Concorrência de slug tratada no banco, não apenas na UI.
- Falha parcial não pode deixar loja órfã ou membership inconsistente.

### 7. Planos sem cobrança

- Aceitar exclusivamente os códigos aprovados correspondentes a R$ 30, R$ 50 e R$ 80.
- Registrar apenas a intenção/seleção inicial e data; não criar cobrança, assinatura renovável, QR Code Pix, pagamento ou entitlement comercial.
- Benefícios e limites continuam indefinidos e não devem ser inventados.

### 8. Estados da loja

Modelo requerido:

- `onboarding`: configuração incompleta;
- `pending_payment`: onboarding concluído, aguardando futura cobrança Pix;
- `active`: reservado para ativação futura por fluxo de pagamento autorizado;
- `suspended`: reservado para suspensão futura.

O fluxo público termina obrigatoriamente em `pending_payment` e nunca alcança `active`. A tela `pending_payment` é apenas informativa, sem cobrança falsa, QR Code ou Pix simulado. Seeds e testes podem criar lojas `active` somente para validar proteção e redirecionamentos.

### 9. Redirecionamentos e proteção de rotas

Matriz esperada, ajustada às decisões finais:

- anônimo em rota protegida → login com retorno interno validado;
- autenticado não verificado → verificar e-mail;
- autenticado sem loja e com onboarding incompleto → etapa pendente;
- autenticado sem loja e sem progresso → início do onboarding;
- usuário com uma loja em `onboarding` → retomada;
- usuário com uma loja em `pending_payment` → tela informativa de pendência e configuração limitada; painel operacional bloqueado;
- usuário com uma loja `active` → painel da loja;
- usuário com uma loja `suspended` → tela de suspensão, sem operações comerciais;
- usuário com múltiplas lojas → seletor explícito; nunca escolher silenciosamente a primeira;
- parâmetro de retorno externo ou tenant sem membership → rejeitado/redirecionado com mensagem neutra.

A proteção deve ocorrer no servidor e no banco/RLS; esconder UI não é autorização.

### 10. Usuário sem loja e com múltiplas lojas

- Usuário sem membership recebe onboarding ou estado vazio apropriado, nunca erro genérico nem acesso implícito.
- O modelo deve tolerar múltiplos memberships mesmo que o MVP limite novas criações a uma loja própria.
- Se houver mais de uma loja acessível, exigir seleção explícita e validar cada acesso por `auth.uid()` × `store_members`.
- Membership removido/revogado deve invalidar o acesso na próxima resolução server-side.

### 11. Auditoria mínima

Registrar, sem segredos ou payload integral:

- cadastro concluído;
- verificação de e-mail concluída;
- solicitação e conclusão de recuperação;
- criação da loja;
- criação do vínculo `owner`;
- escolha/alteração inicial do plano durante onboarding;
- conclusão do onboarding;
- tentativas negadas relevantes, com identificadores mínimos e sem permitir enumeração.

Definir ator, ação, alvo, timestamp e metadados mínimos seguros. Senhas, tokens, cookies, chaves e URLs de recuperação completas são proibidos.

## Requisitos de segurança

- Negação por padrão e menor privilégio.
- Alterações de schema, funções e RLS somente em ambiente local/dev, documentadas e submetidas a QA independente.
- Usuário autenticado não recebe autorização sem membership válido.
- Nenhum `store_id`, slug, papel, estado, plano ou etapa enviado pelo navegador é aceito sem validação server-side.
- Criação atômica de loja/owner deve impedir que usuário atribua outro `user_id`, papel elevado ou estado `active`.
- Service role não pode aparecer no frontend, Server Actions acionáveis sem validação ou rotas de usuário.
- Mensagens não diferenciam e-mail/slug/loja existente quando isso permitir enumeração indevida.
- Rate limiting obrigatório em cadastro, login e recuperação; suporte a CAPTCHA preparado para cadastro e recuperação, sem obrigação de ativá-lo no desenvolvimento local.
- Proteção contra CSRF/replay conforme o mecanismo de sessão e callbacks adotado.
- Nenhum segredo em logs, fixtures, snapshots ou relatórios.

## Modelo de dados esperado — proposta, não autorização

Claude Code deve propor a menor alteração compatível com a TASK-001 para revisão antes de consolidar:

- perfil mínimo do comerciante, se realmente necessário;
- progresso de onboarding vinculado ao usuário;
- estado da loja com enum/constraint;
- seleção inicial de plano com valores fechados `30|50|80` ou códigos equivalentes estáveis;
- auditoria mínima append-only;
- função/transação segura para finalizar onboarding e criar loja + owner.

Não criar tabelas de cobrança, transações Pix, renovação, entitlement ou inadimplência.

## Testes automatizados obrigatórios

### Autenticação

- cadastro válido e entradas inválidas;
- login válido, senha incorreta e mensagem não enumerável;
- logout;
- verificação obrigatória e reenvio com cooldown;
- recuperação para e-mail existente e inexistente com resposta equivalente;
- link de recuperação válido, inválido, expirado e reutilizado;
- retorno externo/open redirect bloqueado.

### Onboarding

- início, salvamento por etapa e retomada após nova sessão;
- tentativa de pular etapa/requisito bloqueada;
- slug inválido, reservado, duplicado e corrida de concorrência;
- plano fora de `30|50|80` rejeitado;
- conclusão cria exatamente uma loja e um `owner`;
- repetição idempotente não duplica loja, owner ou seleção;
- falha intermediária faz rollback completo;
- loja termina em `pending_payment`; fluxo público nunca alcança `active`; seeds/testes podem usar `active` apenas para validar guards e redirecionamentos.

### Autorização e isolamento

- Loja A não lê/altera onboarding, perfil, membership ou auditoria da Loja B;
- Loja B não lê/altera dados da Loja A;
- usuário autenticado sem loja não acessa painel/tenant;
- anônimo não acessa rotas protegidas;
- slug e `store_id` forjados são bloqueados;
- `user_id`, papel `owner`, plano ou estado forjados no payload são ignorados/rejeitados;
- usuário removido da loja perde acesso;
- usuário com múltiplas lojas precisa selecionar e só acessa memberships válidos;
- funções `SECURITY DEFINER`, se usadas, não contornam RLS e têm `search_path` seguro;
- testes contra Postgres/Supabase local real, além de unitários/mocks.

### Qualidade e segurança

- lint, typecheck, testes e build;
- `npm audit` e `npm audit --omit=dev` sem vulnerabilidades conhecidas;
- busca automática em logs por senha, token, cookie, authorization, bearer, secret e chaves;
- acessibilidade básica de formulários, erros, foco e estados de carregamento;
- responsividade mínima de cadastro, login, recuperação, onboarding, seleção de loja e estados bloqueados.

## Critérios de aceitação

1. Todas as decisões `T2-DEC-001` a `T2-DEC-011` são implementadas exatamente como aprovadas.
2. Cadastro, login, logout, verificação e recuperação seguem a política aprovada.
3. Respostas de autenticação não permitem enumeração de conta.
4. Onboarding persiste e retoma com segurança em processo/sessão novos.
5. Primeira loja, owner e plano inicial são criados atomicamente e de forma idempotente.
6. Slug é normalizado, validado e protegido contra concorrência.
7. Estados `onboarding`, `pending_payment`, `active` e `suspended` existem com transições restritas; TASK-002 não ativa loja por pagamento fictício.
8. Redirecionamentos obedecem à matriz aprovada e não permitem open redirect.
9. Rotas do painel são protegidas server-side e por RLS.
10. Usuários sem loja e com múltiplas lojas têm fluxos explícitos e seguros.
11. Isolamento Loja A × Loja B passa em testes reais e automatizados.
12. Auditoria mínima existe sem registrar segredos.
13. Testes negativos cobrem forja de tenant, user, papel, plano, estado e etapa.
14. Lint, typecheck, testes, build e audits passam.
15. Nenhum segredo real, cobrança, Pix, Mercado Pago, deploy ou alteração de produção é realizado.
16. Documentação e handoff descrevem schema, fluxos, decisões, evidências e riscos restantes.
17. QA independente do Júnior aprova a tarefa antes de DONE/merge.

## Fora do escopo

- cobrança, assinatura ou renovação real;
- Pix real, QR Code, webhook ou Mercado Pago;
- inadimplência, tolerância, suspensão/reativação automáticas;
- checkout de clientes, pedidos, catálogo completo ou estoque comercial;
- benefícios/limites definitivos dos planos;
- domínio personalizado;
- convite de funcionários, salvo aprovação explícita alterando este escopo;
- superadmin completo;
- deploy, produção ou migração de produção.

## Riscos

- account/e-mail enumeration;
- open redirect e sequestro de callback;
- criação parcial de loja sem owner;
- duplicação por retry/concor­rência;
- elevação de privilégio por campos controlados pelo cliente;
- acesso cruzado por resolução incorreta de tenant;
- bypass de onboarding/estado/plano;
- vazamento de token em logs ou URL;
- fluxo ambíguo para múltiplas lojas;
- acoplamento prematuro ao futuro provedor Pix.

## Evidência exigida do Claude Code

- branch/worktree e commit exato;
- lista de arquivos e migrações locais alterados;
- decisões aplicadas e decisões ainda abertas;
- diagrama/matriz dos estados e redirecionamentos;
- resultados de lint, typecheck, testes, build e audits;
- teste real Supabase/Postgres da criação atômica e RLS;
- evidência Loja A × Loja B e dos testes negativos;
- logs sanitizados de cadastro/onboarding/recuperação;
- riscos restantes e roteiro de QA reproduzível.

## Condição de execução

A tarefa está em READY. Claude Code pode iniciar somente em branch/worktree própria, após ler `docs/DECISIONS.md` e `docs/CLAUDE_PROMPT_TASK-002.md`, sem merge, deploy, credenciais reais, Pix ou cobrança.
