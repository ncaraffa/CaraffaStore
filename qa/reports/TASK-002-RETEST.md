# Reteste independente pós-remediação — TASK-002

**Data:** 2026-08-03  
**Resultado final:** **REPROVADO**  
**Responsável:** Júnior  
**Branch:** `feat/TASK-002-auth-onboarding`  
**Commit testado:** `104eefb4ec03287b5c70938d829f447de836240d`  
**Relatório anterior:** `qa/reports/TASK-002.md` — REPROVADO

## Resumo executivo

A remediação corrigiu o BUG-T2-001: a matriz de guards de estado passou em requisições HTTP autenticadas diretas, inclusive ausência de `store`, slug alheio, múltiplas memberships e revogação de membership. O fluxo legítimo de recuperação também funcionou, e uma sessão comum sem grant não recebeu o formulário de reset.

Entretanto, o novo mecanismo `recovery_grants` é criticamente contornável. Qualquer sessão autenticada pode inserir diretamente a própria linha, com o `session_id` atual preenchido pelo banco, e imediatamente adquirir acesso a `/reset-password`. O teste SQL oficial considera esse INSERT um PASS. Também foi confirmada, em execução real, troca cruzada de códigos PKCE entre `/auth/confirm` e `/auth/recovery` nos dois sentidos.

Além disso, duas tentativas concorrentes de troca de senha foram aceitas, não há expiração do grant, e usuários comuns podem fabricar eventos de auditoria chamando os RPCs diretamente. A TASK-002 não pode ser mesclada.

## 1. Conferência inicial

- Repositório: `C:\Users\Nicolas\.openclaw\workspace\commerce-platform`.
- Branch: `feat/TASK-002-auth-onboarding`.
- HEAD: `104eefb4ec03287b5c70938d829f447de836240d`.
- Git status inicial: limpo.
- TASK-002: `tasks/review/task-002.md`, status `REVIEW`.
- Docker Engine: 29.6.2, operacional.
- Supabase CLI: 2.111.0.
- Nenhuma variável Supabase exportada manualmente.
- `.env.local` inicial era ignorado e local; foi removido e recriado do zero.
- Nenhuma credencial, e-mail ou serviço de produção foi usado.
- Todos os arquivos obrigatórios foram lidos integralmente.
- Nenhum código, migração ou documentação existente foi alterado.
- Nenhum merge ou deploy foi realizado.

## 2. Gates

| Gate | Resultado |
|---|---|
| `npm install` | APROVADO; 0 vulnerabilidades |
| `npm run lint` | APROVADO |
| `npm run typecheck` | APROVADO |
| `npm test` | APROVADO; **213/213**, 23 arquivos |
| `npm run build` | APROVADO |
| `npm audit` | APROVADO; 0 vulnerabilidades |
| `npm audit --omit=dev` | APROVADO; 0 vulnerabilidades |

A contagem corresponde ao esperado, mas os testes automatizados não detectam os bloqueadores abaixo; alguns testes SQL legitimam o comportamento vulnerável.

## 3. Ambiente real limpo

Executado:

```text
npx supabase stop --no-backup
npx supabase start
npx supabase db reset
```

- Migrações 0001, 0002, 0003 e 0004 aplicadas.
- `.env.local` recriado somente com URL e chaves padrão do Supabase local.
- `.env.local` confirmado no `.gitignore` e ausente do status Git.
- Mailpit operacional e limpo para os fluxos de recuperação.
- Origem configurada: `http://127.0.0.1:3000`.
- Redirects permitidos: `/auth/confirm` e `/auth/recovery` na mesma origem.
- Não foram usados serviços hospedados ou de produção.

## 4. BUG-T2-001 — guards de estado

**Resultado da remediação: CORRIGIDO.**

Testes HTTP autenticados com cookies SSR reais:

| Situação | URL direta | Resultado |
|---|---|---|
| Sem loja | `/dashboard` | 307 → `/onboarding` |
| Sem loja | `/pending-payment` | 307 → `/onboarding` |
| Sem loja | `/suspended` | 307 → `/onboarding` |
| `pending_payment` | `/pending-payment?store=loja-pendente-fixture` | 200 |
| `pending_payment` | `/dashboard?...` | 307 → `/pending-payment?...` |
| `pending_payment` | `/suspended?...` | 307 → `/pending-payment?...` |
| `pending_payment` | `/onboarding` | 307 → `/pending-payment?...` |
| `active` | `/dashboard?store=store-a` | 200 |
| `active` | `/pending-payment?...` | 307 → `/dashboard?...` |
| `active` | `/suspended?...` | 307 → `/dashboard?...` |
| `active` | `/onboarding` | 307 → `/dashboard?...` |
| `suspended` | `/suspended?store=loja-suspensa-fixture` | 200 |
| `suspended` | `/dashboard?...` | 307 → `/suspended?...` |
| `suspended` | `/pending-payment?...` | 307 → `/suspended?...` |
| `suspended` | `/onboarding` | 307 → `/suspended?...` |
| Múltiplas memberships, sem seleção | `/dashboard` | 307 → `/select-store` |
| Seleção válida | `/dashboard?store=store-a` | 200 |
| Store alheia/forjada | `/dashboard?store=loja-pendente-fixture` | 307 → `/select-store` |

Após remover no banco a membership selecionada, a mesma sessão/cookie recebeu 307 para `/select-store`. A membership foi restaurada após o teste.

A proteção está em `lib/tenant/access-control.ts` e é repetida nas páginas/server-side, não apenas no middleware.

## 5. BUG-T2-002 — sessão comum e reset

### Caso sem grant

A página e a Server Action agora consultam `isCurrentSessionRecovery()`. Uma sessão comum sem linha em `recovery_grants` recebe “Link inválido”. Essa parte isolada foi corrigida.

### BUG-RT2-001 — sessão comum fabrica o próprio grant

**Severidade: CRÍTICA — CONFIRMADO EM EXECUÇÃO REAL**

Com uma sessão comum criada por login por e-mail/senha:

```text
INSERT recovery_grants { user_id: auth.uid() } → SUCESSO
GET /reset-password → 200 “Definir nova senha”
```

Nenhum token de recuperação, código, senha atual ou rota `/auth/recovery` foi usado.

A política `recovery_grants_insert_self` permite INSERT a qualquer `authenticated`. O DEFAULT da coluna grava exatamente o `session_id` da sessão comum atual, satisfazendo o CHECK. A RLS prova apenas “é o próprio usuário”, não “esta sessão veio de recuperação”.

O Caso 17 do SQL oficial executa esse mesmo INSERT como `authenticated` e o classifica como PASS.

**Impacto:** qualquer usuário logado converte sua sessão comum em privilégio de redefinição sem senha atual e sem fluxo de recuperação.

**Reprodução resumida:** login normal → INSERT da própria linha sem `session_id` → acessar `/reset-password`.

## 6. Testes adversariais de `recovery_grants`

Resultados reais com uma sessão comum:

- INSERT próprio omitindo `session_id`: **SUCEDEU**.
- INSERT/UPSERT com `session_id` correto da sessão comum: **SUCEDEU**.
- `session_id` forjado diferente: bloqueado pelo CHECK.
- Alterar `created_at` para o ano 2000: **SUCEDEU**.
- DELETE do próprio grant: **SUCEDEU**.
- Não existe `expires_at`, `consumed_at` ou validação de duração.
- Novo login recebe outro `session_id`, mas pode simplesmente criar/atualizar outro grant para a nova sessão.

### BUG-RT2-002 — consumo concorrente não é atômico

**Severidade: ALTA — CONFIRMADO**

Duas sessões de cliente usando o mesmo par access/refresh token executaram `updateUser({password})` em paralelo após o grant. Resultado:

```text
PARALLEL_PASSWORD_UPDATES_SUCCEEDED=2
```

A checagem, atualização da senha e exclusão do grant são operações separadas. Não há RPC/UPDATE atômicos que marque consumo antes da mudança. A última senha vence. Falhas do DELETE/signOut também não são tratadas como falha da operação.

## 7. Troca cruzada entre callbacks

### BUG-RT2-003 — código de confirmação enviado a `/auth/recovery`

**Severidade: CRÍTICA — CONFIRMADO COM PKCE REAL E MAILPIT**

Fluxo:

1. cadastro gera e-mail de confirmação;
2. link é validado pelo GoTrue e produz `code` PKCE;
3. o mesmo `code` é enviado manualmente a `/auth/recovery` com o `code_verifier` correto;
4. `exchangeCodeForSession(code)` aceita;
5. a rota cria `recovery_grant`.

Resultado:

```text
SIGNUP_CODE_TO_RECOVERY_HTTP=307
SIGNUP_CODE_CREATED_GRANT=true
```

Uma confirmação de cadastro foi transformada em privilégio de recuperação apenas trocando a rota.

### BUG-RT2-004 — código de recuperação enviado a `/auth/confirm`

**Severidade: CRÍTICA — CONFIRMADO COM PKCE REAL E MAILPIT**

Resultado:

```text
RECOVERY_CODE_TO_CONFIRM_HTTP=307
RECOVERY_CROSS_ONBOARDING=200
RECOVERY_CROSS_GRANT_COUNT=0
```

A rota `/auth/confirm` troca o código de recuperação por sessão comum, sem grant e sem restrição a `/reset-password`. O usuário ganhou acesso normal ao onboarding.

Separar os paths não classifica criptograficamente o código: ambos chamam `exchangeCodeForSession(code)` e o GoTrue não vincula o `code` à rota Next.js que o consome.

### Outros cenários

- Código já consumido: redirecionado para `login?error=invalid_link`.
- Outro navegador sem o `code_verifier`: não consegue trocar o PKCE code.
- Alterar `next` não foi necessário para explorar; as próprias rotas são intercambiáveis.

## 8. Open redirect

Foram testados contra `/auth/confirm` e `/auth/recovery`:

- URL HTTPS externa;
- `//externo.com`;
- barras invertidas;
- `javascript:`;
- `data:`;
- codificação simples/dupla;
- caminho com `@`;
- fragmento;
- `next` encadeado;
- destino interno.

Nenhum destino externo foi aceito e `next` não altera diretamente o destino das duas rotas atuais. O open redirect está bloqueado.

Ressalva: respostas locais de erro/reuso foram observadas com `Location: http://localhost:3000/...` mesmo quando a requisição usou `127.0.0.1`. Não houve saída para origem externa, mas há inconsistência local de origem a revisar.

## 9. Auditoria e service role

### Service role em runtime

Busca estática confirmou:

- nenhum Server Action, Route Handler, página ou middleware importa `createAdminSupabaseClient`;
- service role permanece em seed/QA/fábrica administrativa;
- nenhuma chave foi encontrada no bundle/log do navegador.

Esse item do BUG-T2-004 foi corrigido.

### Privilégios da tabela

O SQL real confirmou:

- `authenticated`: sem SELECT/INSERT/UPDATE/DELETE direto em `audit_log`;
- `service_role`: SELECT/INSERT permitidos;
- `service_role`: UPDATE e DELETE bloqueados;
- 21 casos/29 asserts do script passaram.

### BUG-RT2-005 — usuário comum fabrica eventos de auditoria

**Severidade: ALTA — CONFIRMADO**

Uma sessão comum de login chamou diretamente:

```text
rpc(log_email_verification_completed) → SUCESSO
rpc(log_password_recovery_completed) → SUCESSO
```

Duas linhas falsas foram gravadas para o próprio ator. `auth.uid()` impede atribuir outro usuário, mas não prova que ocorreu confirmação ou recuperação. O Caso 20 do SQL oficial faz o mesmo com uma sessão comum e classifica como PASS.

### Migração 0004 sobre dados históricos

**Severidade: ALTA — CONFIRMADO EM TRANSAÇÃO DE QA**

A 0002 permitia `signup_completed` e `password_recovery_requested`. A 0004 troca o CHECK sem migrar/remover linhas históricas. Ao inserir uma linha histórica válida sob o CHECK antigo e aplicar o novo CHECK, PostgreSQL retornou `check_violation`. Em banco não vazio, a migração pode falhar.

### Append-only parcial

Apesar de UPDATE/DELETE explícitos estarem bloqueados, `audit_log.store_id` usa `ON DELETE SET NULL`. Excluir uma loja como service role alterou uma linha histórica de auditoria para `store_id=NULL`. Portanto “não editável por ninguém” é mais forte do que a garantia real.

## 10. Rate limiting

Com `TRUSTED_PROXY_ENABLED=false`:

- testes automatizados confirmam que `x-forwarded-for` e `x-real-ip` são ignorados;
- mesma identidade/e-mail permanece na mesma chave;
- e-mail é normalizado e hasheado;
- ações mantêm contadores separados.

`RateLimitBackend` existe e o backend atual continua explicitamente em memória.

Ressalvas não bloqueantes:

- reinício zera os limites;
- múltiplas instâncias não compartilham estado;
- Map pode crescer com chaves únicas;
- a chave combina e-mail+IP; com trusted proxy ligado, rotação de IP cria buckets diferentes para o mesmo e-mail;
- `TRUSTED_PROXY_ENABLED=true` só é seguro se o proxy remover/sobrescrever headers do cliente.

O armazenamento compartilhado permanece requisito de produção, corretamente documentado.

## 11. SQL real, RLS, concorrência e atomicidade

### TASK-001

- execução 1: **7/7 PASS**, 0 FAIL, 0 ERROR, exit 0;
- execução 2 sem reset: **7/7 PASS**, 0 FAIL, 0 ERROR, exit 0.

### TASK-002

- execução 1: **21 casos / 29 asserts PASS**, 0 FAIL, 0 ERROR, exit 0;
- execução 2 sem reset: **21 casos / 29 asserts PASS**, 0 FAIL, 0 ERROR, exit 0.

Os títulos e mensagens agora correspondem às 29 asserções. Contudo, Casos 17 e 20 aprovam comportamentos que constituem vulnerabilidades: INSERT direto de grant por `authenticated` e fabricação de eventos de auditoria.

### Concorrência de slug

Executado duas vezes:

- exit 0 nas duas;
- exatamente 1 sucesso;
- exatamente 1 `slug_taken`;
- exatamente 1 loja persistida por corrida;
- sem estado residual.

A atomicidade/retry do onboarding permanece coberta pelos testes da entrega anterior e pelos 213 testes. As migrações 0003/0004 não alteraram `onboarding_complete()`.

## 12. Recuperação legítima

Fluxo real local usando Mailpit e PKCE:

1. usuário confirmado criado localmente;
2. recuperação solicitada;
3. e-mail capturado no Mailpit;
4. link validado pelo GoTrue;
5. `/auth/recovery` trocou o code e criou grant;
6. `/reset-password` exibiu “Definir nova senha”;
7. `/dashboard` durante a sessão especial redirecionou para `/reset-password`;
8. senha atualizada;
9. senha antiga falhou;
10. senha nova funcionou;
11. grant removido e sessão encerrada;
12. reuso do code redirecionou para link inválido.

O fluxo legítimo funciona, mas não compensa os caminhos críticos de fabricação/troca cruzada.

## 13. PKCE e logs

### Servidor de produção local (`npm start`)

Durante o fluxo legítimo:

- `code=` nos logs: não encontrado;
- `code_verifier`: não encontrado;
- cookies: não encontrados;
- access/refresh tokens: não encontrados;
- JWT/chaves: não encontrados.

### Desenvolvimento

A captura associada ao processo iniciado nesta rodada não registrou valores sensíveis. A documentação da entrega informa que `next dev` pode incluir o parâmetro `code` na linha padrão de acesso; isso deve permanecer como ressalva local e nunca ser copiado para relatório/log persistente. Não foi reproduzido no servidor de produção local.

O code PKCE foi confirmado single-use e inútil em outro navegador sem `code_verifier`, mas isso não protege contra a troca entre rotas no mesmo navegador/verifier.

## 14. Varredura de segredos

Foram varridos gates, seed, RLS, concorrência, servidor dev e servidor de produção.

Nenhum valor de senha, service role, bearer, authorization, cookie, access token, refresh token, token hash, code verifier, link completo, connection string ou chave Supabase foi encontrado. Ocorrências de palavras em mensagens de teste (`service_role`, `plan_code`) eram apenas rótulos, sem valores secretos.

## 15. Interface

O navegador gerenciado continuou bloqueando navegação direta para a origem privada local. Conforme autorizado pelo roteiro, foram usados:

- sessões SSR reais;
- requisições HTTP autenticadas diretas;
- respostas/redirects server-side;
- HTML e headings retornados;
- Mailpit/PKCE real.

Não foi possível certificar visualmente desktop/celular, loading, botão voltar e layout. Guards, atualização/nova requisição e URLs diretas foram exercitados no nível server-side. Essa cobertura visual permanece ressalva, não a causa da reprovação.

## Bugs e severidades

| ID | Severidade | Resultado |
|---|---|---|
| BUG-T2-001 anterior | — | CORRIGIDO — guards de estado passaram |
| BUG-T2-002 anterior | Parcial | Guard sem grant corrigido, mas mecanismo de grant é contornável |
| BUG-RT2-001 | **CRÍTICA** | Qualquer sessão autenticada fabrica o próprio recovery_grant |
| BUG-RT2-002 | **ALTA** | Duas trocas de senha concorrentes são aceitas; grant sem expiração/consumo atômico |
| BUG-RT2-003 | **CRÍTICA** | Código de confirmação trocado em `/auth/recovery` cria grant |
| BUG-RT2-004 | **CRÍTICA** | Código de recuperação trocado em `/auth/confirm` cria sessão comum plena |
| BUG-RT2-005 | **ALTA** | RPCs de auditoria fabricáveis por qualquer authenticated |
| BUG-RT2-006 | **ALTA** | Migração 0004 falha se existirem ações históricas permitidas pela 0002 |
| RESSALVA-RT2-001 | MÉDIA | `ON DELETE SET NULL` altera auditoria histórica |
| RESSALVA-RT2-002 | MÉDIA | Rate limit em memória/trusted proxy não é proteção distribuída |
| RESSALVA-RT2-003 | BAIXA | Cobertura visual local bloqueada; origem de erro local apareceu como localhost |

## Limpeza

- Servidor local encerrado.
- Supabase parado.
- `.env.local` removido.
- Scripts, e-mails e logs temporários removidos.
- Git confirmado limpo antes deste relatório.

## Resultado final

**REPROVADO.**

Os 213 testes, guards, RLS, concorrência e fluxo legítimo passaram, mas o núcleo de autorização de recuperação é criticamente inseguro e a separação de callbacks não impede troca cruzada de PKCE codes. Os testes oficiais aprovam parte dos comportamentos vulneráveis. A TASK-002 não pode ser mesclada.

## Próximo passo recomendado

1. Remover INSERT/UPDATE/DELETE de `recovery_grants` para `authenticated`; cliente nunca deve emitir o próprio privilégio.
2. Emitir e consumir grants por mecanismo server-side não fabricável, com nonce/estado vinculado ao fluxo, sessão, purpose e expiração.
3. Tornar consumo atômico e single-use antes da troca de senha; apenas uma tentativa concorrente pode vencer.
4. Impedir troca cruzada de códigos — a classificação precisa ser vinculada a estado/nonce server-side iniciado no fluxo, não apenas ao path que recebeu um code intercambiável.
5. Restringir RPCs de auditoria para que eventos só possam ser produzidos pela operação correspondente, não por qualquer sessão comum.
6. Tornar a migração 0004 compatível com dados históricos.
7. Corrigir os testes 17 e 20 para rejeitarem fabricação, em vez de aprová-la.
8. Repetir reteste independente completo antes de merge.
