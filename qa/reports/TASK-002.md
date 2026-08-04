# QA independente — TASK-002

**Data:** 2026-08-03  
**Resultado final:** **REPROVADO**  
**Responsável:** Júnior  
**Branch:** `feat/TASK-002-auth-onboarding`  
**Commit testado:** `42e36dfb11be3aa77bc351608c4b77dde6a1252f`

## Resumo executivo

Os gates automatizados passaram exatamente como esperado: 158/158 testes, lint, typecheck, build e ambos os audits. O Supabase local foi recriado do zero, a regressão RLS da TASK-001 passou 7/7 duas vezes, a RLS da TASK-002 passou 16/16 duas vezes e a corrida real de slug passou duas vezes. Atomicidade e rollback também foram comprovados com falha injetada no PostgreSQL local.

Entretanto, foram confirmados dois bugs de severidade **ALTA** em proteção de rotas/autenticação:

1. páginas de estado (`dashboard`, `pending-payment`, `suspended`) aceitam acesso direto por usuários/lojas em estados incompatíveis e até por usuário sem loja;
2. uma sessão autenticada comum pode abrir o formulário e executar a Action de redefinição de senha sem provar que é uma sessão de recuperação.

Há ainda problemas médios em callback/auditoria/rate limiting e proteções apenas preparadas. A TASK-002 não deve ser mesclada neste estado.

## 1. Ambiente e conferência inicial

- Diretório: `C:\Users\Nicolas\.openclaw\workspace\commerce-platform`.
- Branch: `feat/TASK-002-auth-onboarding`.
- HEAD: `42e36dfb11be3aa77bc351608c4b77dde6a1252f`.
- Git status inicial: limpo.
- Docker Engine: 29.6.2, operacional.
- Supabase CLI: 2.111.0.
- Variáveis `SUPABASE` exportadas manualmente: nenhuma.
- `.env.local` inicial: arquivo ignorado pelo Git, contendo apenas endpoints `127.0.0.1`, chaves JWT padrão do Supabase local e flags locais desativadas; foi removido e recriado antes dos testes.
- Nenhuma credencial, e-mail ou serviço de produção foi usado.
- TASK-001: `tasks/done/task-001.md`, status `DONE`.
- TASK-002: `tasks/review/task-002.md`, status `REVIEW`.
- Documentos, migração e scripts obrigatórios foram lidos integralmente.
- Nenhum merge ou deploy foi realizado.

## 2. Gates da aplicação

| Comando | Resultado |
|---|---|
| `npm install` | APROVADO; 0 vulnerabilidades |
| `npm run lint` | APROVADO |
| `npm run typecheck` | APROVADO |
| `npm test` | APROVADO; **158/158**, 17 arquivos |
| `npm run build` | APROVADO; compilação concluída |
| `npm audit` | APROVADO; 0 vulnerabilidades |
| `npm audit --omit=dev` | APROVADO; 0 vulnerabilidades |

Nenhuma diferença em relação à contagem esperada.

## 3. Ambiente local limpo

Executado:

```text
npx supabase stop --no-backup
npx supabase start
npx supabase db reset
```

Resultado:

- migrações `0001_init.sql` e `0002_auth_onboarding.sql` aplicadas;
- `.env.local` recriado somente com credenciais locais;
- arquivo ignorado pelo Git e ausente do `git status`;
- Mailpit disponível na porta local 54324;
- origem única: `http://127.0.0.1:3000`;
- callback único permitido: `http://127.0.0.1:3000/auth/confirm`;
- não houve mistura entre `localhost` e `127.0.0.1`.

## 4. Cadastro e verificação

### Resultados confirmados

- Senha de 14 caracteres: rejeitada pelo GoTrue local.
- Senha de 15 caracteres: aceita.
- Passphrase de 64 caracteres, contendo espaços: aceita.
- Política da aplicação documenta máximo de 128 e erro controlado acima desse limite; os testes automatizados da política passaram.
- Conta criada permaneceu sem confirmação (`email_confirmed_at` ausente).
- Mailpit capturou mensagem local de confirmação.
- `enable_confirmations=true` no Supabase local.
- Usuário autenticado não verificado é restringido pelo middleware a confirmação/reenvio/logout.
- Redirects usam allowlist interna e origem única.

### Limitação de execução visual

O navegador gerenciado recusou navegação para o endereço privado `127.0.0.1` por política da ferramenta. Não foi usado hostname alternativo para não misturar origens/cookies e invalidar o teste solicitado. Foram usados HTTP local autenticado, Supabase real, Mailpit, leitura da resposta HTML e inspeção direta do código para complementar a validação.

Assim, o clique visual completo de confirmação, reutilização de link e responsividade não pôde ser certificado pelo navegador nesta rodada. Isso fica marcado como cobertura não concluída, mas não altera o resultado final, já reprovado por bugs reproduzidos em execução.

## 5. Login, logout e recuperação

### Comportamentos corretos encontrados

- Mensagem de login inválido é fixa e não diferencia usuário inexistente de senha incorreta.
- Recuperação responde com mensagem fixa e registra apenas hash do e-mail.
- Middleware reconhece sessão com `amr=recovery` e restringe outras rotas.
- Logout é POST-only.
- Anônimo em `/reset-password` recebe a página de link inválido, sem formulário funcional.

### BUG-T2-002 — sessão comum consegue redefinir senha

**Severidade: ALTA**

**Evidência em execução:** uma sessão normal do fixture `merchant-pending@example.test`, autenticada por senha, acessou diretamente:

```text
GET /reset-password → HTTP 200 — “Definir nova senha”
```

**Causa:**

- `app/(auth)/reset-password/page.tsx` verifica apenas se existe `user`;
- `app/(auth)/reset-password/actions.ts` também verifica apenas `getUser()`;
- não há validação do claim `amr=recovery` na página nem na Action.

O middleware impede que uma sessão de recuperação acesse outras rotas, mas não impede o inverso: uma sessão normal abre `/reset-password` porque essa rota está permitida a qualquer usuário autenticado.

**Impacto:** usuário logado pode trocar a senha sem senha atual e sem token/sessão de recuperação, e a auditoria registra falsamente `password_recovery_completed`.

**Reprodução:**

1. Fazer login normalmente com qualquer usuário verificado.
2. Abrir diretamente `/reset-password`.
3. Observar HTTP 200 e formulário de nova senha.
4. A Action aceita qualquer `user` autenticado e chama `updateUser({ password })`.

**Correção necessária:** exigir, tanto no guard da página quanto na Server Action, uma sessão comprovadamente originada de recuperação. A Action não pode depender apenas do middleware.

### Sessão de recuperação restrita

A política do middleware para uma sessão realmente marcada como recovery está implementada e coberta por testes automatizados. Entretanto, o fluxo E2E visual completo via Mailpit (link válido/expirado/reutilizado, rotas bloqueadas e troca final) não foi certificado pelo navegador nesta rodada devido à restrição de navegação local descrita acima.

## 6. Onboarding

### Fluxo real no Supabase/PostgreSQL

Um usuário de QA verificado foi criado no Supabase local e conduzido pelas RPCs reais:

- tentativa de salvar nome da loja antes do perfil: bloqueada (`profile_required`);
- perfil e WhatsApp: salvos;
- nome da loja: salvo;
- slug `"  Minha Loja QA!!  "`: normalizado para `minha-loja-qa`;
- plano `999`: bloqueado (`invalid_plan`);
- plano 30: aceito;
- duas conclusões simultâneas do mesmo usuário: ambas retornaram a mesma loja;
- resultado persistido: 1 loja, 1 owner, 1 plano, 4 eventos de auditoria, 1 perfil;
- estado final: `pending_payment`;
- tentativa de alterar slug após conclusão: bloqueada (`onboarding_already_completed`).

A retomada é persistida em `onboarding_progress`, vinculada a `auth.uid()`. As funções do banco exigem pré-requisitos da etapa anterior, impedindo salto controlado pelo cliente.

## 7. Campos forjados, atomicidade e idempotência

### Campos forjados

A API pública das funções não aceita `owner_id`, `store_id`, `role`, `status` ou permissões. Escritas diretas por `authenticated` foram bloqueadas por GRANT/RLS. Plano fora de 30/50/80 foi rejeitado. Slug de loja alheia e tenant forjado foram bloqueados.

### Falha proposital e rollback

Foi criado temporariamente no banco local um trigger de QA que lança `qa_injected_failure` antes de inserir em `audit_log`. Em seguida, `onboarding_complete()` foi chamado duas vezes em paralelo.

Durante a falha:

- 0 lojas;
- 0 memberships owner;
- 0 planos;
- 0 auditorias;
- 0 perfis.

O trigger/função temporários foram removidos. No retry seguinte, a conclusão passou e gerou exatamente:

- 1 loja;
- 1 owner;
- 1 plano;
- 4 eventos coerentes de auditoria;
- 1 perfil;
- status `pending_payment`.

Retry e duplo clique não duplicaram a loja.

## 8. Multi-tenancy e memberships

### Fluxo central correto

Testes HTTP locais com cookies SSR reais confirmaram:

- `pending_payment` em `/` → `/pending-payment?store=loja-pendente-fixture`;
- `active` em `/` → `/dashboard?store=store-a`;
- usuário sem loja em `/` → `/onboarding`;
- múltiplos memberships em `/` → `/select-store`;
- seletor de múltiplas lojas: HTTP 200;
- `suspended` em `/` → `/suspended?store=loja-suspensa-fixture`;
- slug forjado de loja sem membership → `/select-store`.

### BUG-T2-001 — páginas de estado não validam estado real

**Severidade: ALTA**

As páginas validam sessão, verificação de e-mail e, quando há `?store=`, membership. Elas não exigem o estado apropriado. Quando `store` é omitido, `resolveOptionalStoreName()` retorna `null` sem exigir loja.

**Evidências reais:**

```text
pending_payment → /dashboard?store=loja-pendente-fixture → 200 “Painel”
pending_payment → /suspended?store=loja-pendente-fixture → 200 “Loja suspensa”
active → /pending-payment?store=store-a → 200 “Cadastro concluído — pagamento pendente”
usuário sem loja → /dashboard → 200 “Painel”
```

O fluxo central `/` redireciona corretamente, mas URL direta contorna a matriz.

**Arquivos envolvidos:**

- `app/dashboard/page.tsx`;
- `app/pending-payment/page.tsx`;
- `app/suspended/page.tsx`;
- `lib/tenant/resolve-optional-store.ts`.

**Impacto:** o painel placeholder é acessível antes do pagamento; usuários sem loja recebem uma página que afirma “Loja ativa”; estados `active`, `pending_payment` e `suspended` podem ser representados incorretamente por URL direta. Quando o painel ganhar funções reais, este padrão vira bypass de autorização operacional.

**Correção necessária:** cada rota deve resolver uma loja autorizada explicitamente e validar o status exigido server-side. Ausência de `store` deve passar pelo resolvedor central, não liberar conteúdo genérico.

## 9. RLS real, concorrência e PostgreSQL

### TASK-001 — regressão

- execução 1: **7/7 PASS**, exit 0, nenhum ERROR;
- execução 2 sem reset: **7/7 PASS**, exit 0, nenhum ERROR.

### TASK-002

- execução 1: **16/16 PASS**, exit 0, nenhum ERROR;
- execução 2 sem reset: **16/16 PASS**, exit 0, nenhum ERROR.

### Concorrência real de slug

`supabase/tests/slug-concurrency-check.ts` executado duas vezes:

- exatamente 1 sucesso;
- exatamente 1 falha `slug_taken`;
- exatamente 1 loja no banco;
- os vencedores variaram entre as execuções;
- exit 0 nas duas.

### Inspeção direta

- tabelas esperadas com RLS desativada: 0;
- grants `TRUNCATE` para papéis da aplicação: 0;
- grants excessivos `TRIGGER/REFERENCES/TRUNCATE`: 0;
- funções SECURITY DEFINER sem configuração segura de `search_path`: 0;
- `PUBLIC` com EXECUTE em `onboarding_*`: 0;
- lojas forjadas/residuais: 0;
- slugs duplicados: 0;
- pares owner duplicados: 0.

## 10. Rate limiting, CAPTCHA e senhas vazadas

### Rate limiting

**Ativo, mas com ressalvas.**

Teste direto do limiter:

- cadastro: 6ª tentativa bloqueada;
- login: 11ª tentativa bloqueada;
- recuperação: 6ª tentativa bloqueada;
- `retryAfterMs` retornado.

Também existem limites nativos do GoTrue local. Porém:

- armazenamento é um `Map` em memória por processo;
- reinício zera os limites;
- múltiplas instâncias não compartilham estado;
- buckets expirados não são removidos automaticamente;
- `x-forwarded-for`/`x-real-ip` são aceitos sem cadeia de proxy confiável, permitindo bypass ou fragmentação se o cliente controlar esses headers.

Classificação: **ressalva operacional e bug MÉDIO de robustez/produção**.

### CAPTCHA

**Somente preparado, não ativo.**

- `CAPTCHA_ENABLED=false`;
- `[auth.captcha].enabled=false`;
- verifier server-side existe;
- formulário contém campo oculto, mas não há widget real;
- checklist de produção existe.

Além disso, ao ativar CAPTCHA nativo do GoTrue, o token precisa ser encaminhado às chamadas Supabase (`captchaToken`); isso não está demonstrado no fluxo atual.

Classificação: ressalva conforme decisão aprovada; não é bloqueador isolado, mas não deve ser descrito como proteção ativa.

### Senhas vazadas

**Somente preparado, não ativo.**

- HIBP k-anônimo implementado;
- `HIBP_PASSWORD_CHECK_ENABLED=false` no local;
- dependência externa não foi ativada/testada nesta rodada;
- falha de rede/HTTP é fail-open.

Classificação: ressalva conforme decisão; não considerar validado em produção.

## 11. Logs e segredos

Foram capturados stdout/stderr do servidor, seed, duas corridas e scripts RLS.

Busca automática por:

```text
password|secret|service_role|bearer|authorization|cookie|access_token|refresh_token|token_hash|postgresql://|JWT
```

Resultado:

- seed: 0 ocorrências sensíveis;
- corrida 1/2: 0;
- RLS: 0;
- servidor: uma ocorrência textual em `/reset-password`, apenas o nome da rota; nenhum token, senha, cookie ou valor secreto.

Nenhum token apareceu nos resultados finais registrados neste relatório.

## 12. Interface e redirecionamentos

### Rotas anônimas via HTTP local

- `/signup`: 200;
- `/login`: 200;
- `/forgot-password`: 200;
- `/reset-password`: 200 com estado de link inválido;
- `/verify`: redireciona para login;
- onboarding, select-store, pending-payment, suspended e dashboard: redirecionam anônimo para login com `next` interno.

### Rotas autenticadas

O resolvedor central funcionou para todos os estados e múltiplos memberships. Contudo, acessos diretos reproduziram o BUG-T2-001 e a página de reset reproduziu o BUG-T2-002.

### Cobertura visual

Desktop/celular, estados de carregamento, botão voltar e inspeção visual não foram certificados por screenshot porque o navegador gerenciado bloqueou a origem privada local. Não foi alterada a origem para evitar um teste inválido de cookies/callbacks. Essa cobertura precisa ser repetida após as correções, em ambiente de navegador que aceite a origem local.

## 13. Outros achados

### BUG-T2-003 — tipo do callback depende de `next`

**Severidade: MÉDIA**

`app/auth/confirm/route.ts` classifica recuperação quando `next === '/reset-password'`, e `next` vem da query, embora sanitizada por allowlist. O destino é seguro contra open redirect, mas o tipo do evento/auditoria não deveria ser derivado de um parâmetro modificável. Deve ser derivado do token/sessão validada (`amr`/tipo OTP).

### BUG-T2-004 — auditoria usa service role em fluxos de usuário e falha silenciosamente

**Severidade: MÉDIA**

`lib/audit/log.ts` cria cliente service role dentro de Server Actions/Route Handler e ignora qualquer falha. Isso contradiz comentários protetivos de `lib/supabase/admin.ts` e permite que cadastro/recuperação sejam concluídos sem auditoria. `access_denied` está definido, mas não foi encontrado registro efetivo. `audit_log` é descrito como append-only, porém `service_role` recebe UPDATE e DELETE.

### BUG-T2-005 — rate limiter contornável/não escalável

**Severidade: MÉDIA**

Detalhado na seção 10: IP potencialmente forjável, memória por processo e crescimento do Map. Aceitável apenas como camada local/MVP de instância única, não como proteção pronta para produção.

### RESSALVA-T2-001 — cobertura SQL menor que a descrição

**Severidade: BAIXA**

O Caso 13 aceita `slug_required` ou `invalid_plan`, portanto não prova inequivocamente a ordem descrita no comentário. O Caso 16 afirma bloquear qualquer função `onboarding_*`, mas chama apenas `onboarding_ensure_progress()`. Não há teste automatizado integrado específico para guards de estado por URL direta nem para sessão comum tentando reset; ambos teriam detectado os bloqueadores.

## Bugs consolidados

| ID | Severidade | Situação |
|---|---|---|
| BUG-T2-001 | ALTA | Guards de estado contornáveis por URL direta/ausência de `store` |
| BUG-T2-002 | ALTA | Sessão autenticada comum consegue abrir/executar redefinição de senha |
| BUG-T2-003 | MÉDIA | Callback classifica recuperação por query `next` |
| BUG-T2-004 | MÉDIA | Auditoria com service role em request path, falha silenciosa e append-only incompleto |
| BUG-T2-005 | MÉDIA | Rate limiter por processo e IP potencialmente forjável |
| RESSALVA-T2-001 | BAIXA | Testes SQL/automatizados afirmam cobertura maior do que exercitam |

## Limpeza

- Servidor Next.js encerrado.
- Supabase local parado.
- `.env.local` removido.
- Scripts e logs temporários removidos.
- Git status confirmado limpo antes da criação deste relatório.

## Resultado final

**REPROVADO.**

Os gates, banco, RLS, atomicidade, idempotência e concorrência estão fortes. Porém, os dois bugs ALTOS violam diretamente as decisões aprovadas sobre painel antes do pagamento, estados da loja e recuperação segura. A TASK-002 não pode ser mesclada na `master` antes das correções e de um reteste independente.

## Próximo passo recomendado

Devolver ao Claude Code, no mínimo:

1. corrigir guards das três páginas de estado para exigir loja autorizada e status exato;
2. exigir sessão `amr=recovery` na página e na Server Action de reset;
3. derivar o tipo do callback da sessão/token validado;
4. revisar auditoria/service role e garantir os eventos mínimos;
5. endurecer/limitar o rate limiter e documentar claramente o que continua apenas local;
6. adicionar testes de regressão para acessos diretos por cada estado, usuário sem loja, sessão comum no reset, callbacks e fault injection;
7. repetir o QA visual desktop/celular e o fluxo Mailpit completo em navegador local habilitado.
