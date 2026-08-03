# Verificação do implementador (Claude Code) — TASK-002

**Este documento é uma verificação produzida pelo próprio implementador, NÃO um QA independente.**
O Júnior (QA independente) está temporariamente indisponível (cota esgotada). Nesta etapa, a
revisão externa e a decisão de aprovação ficam a cargo do ChatGPT, com base nas evidências abaixo.
Claude Code não declara aprovação, não faz merge, não faz deploy e não move a tarefa para DONE.

**Data:** 2026-08-03
**Branch:** `feat/TASK-002-auth-onboarding`
**Commit testado:** `f038c7dbf77fc3a0d2ea1ec2160e787d30b0d502`
**Working tree inicial:** limpa
**Relatórios anteriores (não sobrescritos):** `qa/reports/TASK-002.md`, `qa/reports/TASK-002-RETEST.md`

## Resultado

**BLOQUEADOR ENCONTRADO — CRÍTICO.**

Confirmado, de ponta a ponta, contra Supabase/PostgreSQL/GoTrue/Mailpit reais rodando localmente
(sem mocks): uma sessão autenticada comum (login normal, sem jamais tocar em nenhum e-mail de
recuperação) consegue conceder a si mesma o privilégio de recuperação de senha e trocar a própria
senha inteiramente através de chamadas RPC diretas — exatamente o cenário descrito como "ponto mais
suspeito" na missão desta sessão, e exatamente o critério que a missão define como CRÍTICO
("Caso essa sequência funcione sem o código legítimo, classifique como CRÍTICO e pare qualquer
ideia de aprovação").

---

## 1. Estado inicial do Git

```
$ git status
On branch feat/TASK-002-auth-onboarding
nothing to commit, working tree clean

$ git branch --show-current
feat/TASK-002-auth-onboarding

$ git rev-parse HEAD
f038c7dbf77fc3a0d2ea1ec2160e787d30b0d502

$ git log --oneline -10
f038c7d fix(task-002): secure recovery grants token purpose and audit flow
027678e test(TASK-002): add post-remediation independent QA
104eefb fix(TASK-002): remediate QA-reported authz bugs (BUG-T2-001..005, RESSALVA-T2-001)
115aa8f test(TASK-002): add independent authentication and onboarding QA
42e36df feat(TASK-002): auth, email verification, recovery and merchant onboarding
ca24351 docs(TASK-002): approve authentication and onboarding scope
db0ed43 test: normalize CRLF before parsing 0001_init.sql in privileges test
04f8ea4 merge: complete TASK-001 multitenant foundation
9d4e6f5 docs(TASK-001): mark multitenant foundation as done
ed0eb74 test(TASK-001): add final credential leak retest
```

Estado idêntico ao esperado pela missão. Prosseguido.

## 2. Ambiente

- Node v24.18.0, npm 11.16.0.
- Supabase CLI 2.111.0, stack local já em execução (containers `supabase_*_commerce-platform-local`),
  `npx supabase status` confirmou API/DB/Auth/Mailpit saudáveis.
- `DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `API_URL=http://127.0.0.1:54321`,
  `MAILPIT_URL=http://127.0.0.1:54324`.
- Next.js dev server real (`npm run dev`) iniciado para os testes de rota/PKCE/browser, parado ao final.
- Nenhuma credencial/serviço de produção usado. `.env.local` já existente, não recriado, não commitado.

## 3. Metodologia

Diferente da sessão anterior, esta verificação **não confiou** no resumo da implementação, nos
217 testes automatizados, nem na suíte SQL declarada. Todo teste crítico foi refeito com:

- chamadas HTTP reais a `POST/GET/PUT /auth/v1/*` (GoTrue) e `/rest/v1/rpc/*` (PostgREST) via `fetch` em Node;
- Mailpit real (API `/api/v1/*`) para capturar e-mails e extrair códigos/links reais;
- navegador real (Claude Browser) dirigindo o app Next.js real (`npm run dev`) para reproduzir o
  fluxo PKCE genuíno (cookies `sb-127-auth-token-flow-<id>-code-verifier`), já que chamadas REST cruas
  usam fluxo implícito por padrão e não refletem o comportamento real do `@supabase/ssr`;
- `docker exec ... psql` contra o Postgres real para inspecionar o catálogo (`pg_proc`, `pg_policies`,
  `information_schema.role_table_grants`, `pg_constraint`) e para rodar os scripts SQL adversariais
  do próprio projeto com UUIDs de seed reais;
- dois subagentes **somente leitura**, em paralelo, com conclusões produzidas de forma independente
  antes de qualquer comparação: um focado em autenticação/PKCE/cookies/rotas, outro em
  privilégios/RLS/SECURITY DEFINER/auditoria/migrations no catálogo real. Ambos corroboraram,
  de forma independente, a causa-raiz abaixo.

## 4. BUG-CLAUDE-001 (CRÍTICO) — sessão comum se autoconcede recuperação de senha sem e-mail

### Causa-raiz

`consume_auth_flow_grant(purpose)` (`supabase/migrations/0003_recovery_session.sql:200-243`) só
verifica **"existe uma linha pendente do propósito X para este `auth.uid()`"**. Em nenhum momento
ela verifica que a sessão chamadora foi de fato produzida por uma troca de código (`exchangeCodeForSession`/
`verifyOtp`) vinculada a esse grant específico — `session_id` só é **escrito** no UPDATE
(`set session_id = v_session_id`), nunca usado como filtro de elegibilidade no `WHERE`. Confirmado
tanto no arquivo de migração quanto ao vivo via `pg_get_functiondef` no Postgres real (nenhum drift):

```sql
update public.auth_flow_grants
set consumed_at = now(), session_id = v_session_id
where user_id = v_uid
  and purpose = p_purpose
  and consumed_at is null
  and expires_at > now();
```

Como `request_password_recovery_grant(p_email)` (linhas 152-184) é `GRANT EXECUTE`-ável a
`anon, authenticated` e só exige um e-mail (não prova posse de caixa de entrada — só cria uma linha
PENDENTE), **qualquer sessão autenticada pode gerar o próprio pedido pendente e imediatamente
consumi-lo via a mesma RPC exposta**, sem jamais ter recebido ou clicado em nenhum e-mail.

### Reprodução (evidência bruta, ponta a ponta, ambiente real)

- Papel usado: `anon` (para signup/login) e depois o `access_token` da própria sessão comum recém-logada.
- Sessão: sessão de login normal via `POST /auth/v1/token?grant_type=password` — **nunca** uma sessão
  originada de `/auth/confirm` ou `/auth/recovery`.

```
=== STEP 0: signup new user === fase3-attacker-1785799565407@example.test
signup status 200
=== STEP 0c: verify OTP (simulate clicking confirm link) ===
verify status 200
=== STEP 1: normal password login (NOT via any recovery/confirm link) ===
login status 200
normal session_id claim: fd25bc33-2769-4b83-a255-3cbdab63ff9f amr: [{"method":"password","timestamp":1785799567}]
=== STEP 2: as this NORMAL session, call request_password_recovery_grant(own email) directly via RPC ===
request_password_recovery_grant status 204 ""
=== STEP 3: as this NORMAL session, call consume_auth_flow_grant('password_recovery') directly via RPC ===
consume_auth_flow_grant status 200 body: true
=== STEP 4: is_current_session_recovery_grant() ===
is_current_session_recovery_grant status 200 body: true
=== STEP 5: claim_recovery_grant_for_password_change() ===
claim status 200 body: true
=== STEP 6: updateUser(password) directly via GoTrue, using same normal session token ===
updateUser status 200
=== STEP 7: verify old password now fails, new password works ===
old password login status (expect fail if changed): 400
new password login status (expect 200 if changed): 200
```

Estado no banco antes do STEP 2: nenhuma linha em `auth_flow_grants` para este usuário com
`purpose='password_recovery'`. Estado depois do STEP 3: uma linha com `consumed_at` preenchido e
`session_id` = o `session_id` da própria sessão comum de login — nunca existiu troca de código de
recuperação. Depois do STEP 5, a linha some (DELETE atômico do claim). O `PUT /auth/v1/user` no
STEP 6 é o endpoint real de troca de senha do GoTrue, chamado com o token da sessão comum.

**Conclusão:** a sessão trocou a própria senha usando exatamente o caminho que deveria exigir prova
de posse do e-mail de recuperação, sem em nenhum momento apresentar um código real. Isso não é uma
falha teórica de design — é uma chamada de API executável por qualquer cliente autenticado (browser
console, extensão, script) contra o endpoint público `/rest/v1/rpc/*` com a `anon key` documentada
publicamente no bundle do frontend + o token de sessão do próprio usuário.

### Severidade e impacto

CRÍTICO. Embora o alvo direto seja a própria conta do atacante (não há escalação horizontal — ver
§5, teste de sessão cruzada, abaixo, que confirma isolamento entre sessões/usuários diferentes),
isto quebra a garantia de segurança que a TASK-002 explicitamente exige e que a documentação do
próprio código afirma implementar ("a finalidade precisa estar vinculada de maneira não fabricável
ao evento/código/sessão correspondente" — não está). Implicações práticas:

- Qualquer sessão comum sequestrada (XSS, token vazado, dispositivo compartilhado) pode trocar a
  senha da conta **sem nunca precisar de acesso à caixa de e-mail da vítima** — o modelo de ameaça
  "atacante tem uma sessão mas não o e-mail" deixa de ser mitigado pela exigência de recuperação por
  e-mail, porque a "recuperação" pode ser auto-emitida pela própria sessão comprometida.
  `updateUser({password})` sozinho (sem o desvio) já teria essa propriedade — mas a documentação e o
  design de `auth_flow_grants` afirmam explicitamente proteger contra isso, e não protegem.
  Não foi verificado neste ciclo se existe algum outro fluxo de troca de senha "logado" fora do
  mecanismo de recovery (não parece existir na TASK-002 atual — reset-password é o único caminho).
- O próprio script de teste do projeto, `supabase/tests/recovery-claim-concurrency-check.ts:64-79`,
  usa literalmente esta mesma cadeia (login normal → `request_password_recovery_grant` →
  `consume_auth_flow_grant`) como *setup* de teste, com um comentário racionalizando isso como
  "equivalente a ter acabado de trocar um código real" — confirmando que a própria equipe de
  implementação usou o desvio como atalho de teste sem reconhecê-lo como caminho alcançável por um
  atacante.

### Causa provável

Design que verifica "existe uma intenção pendente" em vez de "esta troca de código específica
produziu este grant". A separação de ROTAS (`/auth/confirm` vs `/auth/recovery`) e a checagem de
`purpose` resolvem corretamente o desvio de código entre fluxos **quando o código é de fato trocado
através de uma rota da aplicação** (ver §5 — testado e confirmado seguro), mas não fecham o caminho
mais curto: chamar as RPCs subjacentes diretamente, pulando a troca de código por completo.

### Passos de reprodução (resumo para o revisor)

1. Criar usuário via `POST /auth/v1/signup`, confirmar e-mail normalmente.
2. Logar normalmente via `POST /auth/v1/token?grant_type=password` — sessão comum.
3. Com o `access_token` dessa sessão comum: `POST /rest/v1/rpc/request_password_recovery_grant`
   `{"p_email": "<próprio e-mail>"}`.
4. `POST /rest/v1/rpc/consume_auth_flow_grant` `{"p_purpose": "password_recovery"}` → `true`.
5. `POST /rest/v1/rpc/claim_recovery_grant_for_password_change` `{}` → `true`.
6. `PUT /auth/v1/user` `{"password": "<nova senha>"}` → `200`, senha trocada.

Script completo usado: `attack-fase3.mjs` (mantido fora do repositório, em scratchpad da sessão —
não commitado, conforme instrução de não alterar código/testes).

---

## 5. Testes que PASSARAM (evidências reais, não presumidas)

### 5.1 Fabricação direta na tabela (`auth_flow_grants`) — SEGURO

Catálogo real via `docker exec ... psql`:

```
select grantee, privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='auth_flow_grants';

   grantee    | privilege_type
--------------+----------------
 postgres     | INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
 service_role | INSERT/SELECT/UPDATE/DELETE
```

Zero linhas para `anon`/`authenticated`. Confirmado também via API real:

```
anon SELECT status: 401 permission denied for table auth_flow_grants
anon INSERT status: 401 permission denied for table auth_flow_grants
authenticated SELECT (own rows) status: 403 permission denied for table auth_flow_grants
authenticated INSERT own user_id status: 403 permission denied for table auth_flow_grants
authenticated UPDATE own rows status: 403 permission denied for table auth_flow_grants
authenticated DELETE own rows status: 403 permission denied for table auth_flow_grants
```

RPCs antigas removidas pela migração 0004 (`log_email_verification_completed`,
`log_password_recovery_completed`) confirmadas ausentes tanto no catálogo (`pg_proc`, 0 linhas)
quanto via chamada real (`404 PGRST202 — no matches found in schema cache`).

RLS: `pg_class.relrowsecurity = t` e `pg_policies` com **0 linhas** para `auth_flow_grants` e
`audit_log` — confirmado pelo subagente de catálogo. Acesso é 100% via funções `SECURITY DEFINER`.

`PUBLIC` (não apenas `anon`/`authenticated`) não tem `EXECUTE` em nenhuma das 5 funções
(`has_function_privilege('public', oid, 'EXECUTE')` = `f` para todas).

### 5.2 Sessão cruzada (mesmo usuário, sessões diferentes) — SEGURO

Este teste isola o BUG-CLAUDE-001: confirma que, **depois** que uma sessão específica consome um
grant, uma sessão *diferente* do mesmo usuário não herda o privilégio.

```
session1 request_password_recovery_grant: 204
session1 consume_auth_flow_grant: 200 true (session_id gets set to session1's on consume)
session2 is_current_session_recovery_grant(): 200 false (session_id mismatch — correto)
session2 consume_auth_flow_grant (grant already consumed by session1): 200 false (correto)
session1 is_current_session_recovery_grant(): 200 true (correto)
session2 claim_recovery_grant_for_password_change(): 200 false (session_id mismatch — correto)
```

`is_current_session_recovery_grant()` e `claim_recovery_grant_for_password_change()` **filtram**
corretamente por `session_id` no `WHERE` (diferente de `consume_auth_flow_grant`, que não filtra).
Isso limita o BUG-CLAUDE-001 à própria sessão que executou o desvio — não há sequestro do grant por
uma sessão de terceiros, nem persistência do privilégio além do fluxo de quem o fabricou.

### 5.3 Troca cruzada de código PKCE nas rotas reais — SEGURO

Este é o teste mais caro da missão (Fase 4) e o único que exige o fluxo PKCE genuíno — refeito com
navegador real, capturando os cookies `sb-127-auth-token-flow-<id>-code-verifier` reais (o design
suporta múltiplos flows PKCE concorrentes, um cookie por `flow-id`, confirmado inspecionando
`document.cookie` após signup + forgot-password na mesma aba).

Usuário criado, e-mail de confirmação e de recuperação pendentes **simultaneamente** (recuperação
solicitada antes de confirmar o cadastro). Código PKCE de cada e-mail extraído via
`fetch(gotrueVerifyLink, {redirect:"manual"})` (sem deixar o navegador consumir o código
automaticamente), depois cada código apresentado na ROTA ERRADA do app real:

```
=== CENARIO A: CONFIRM code at /auth/recovery ===
confirm-code-at-recovery-route -> 307 http://localhost:3000/login?error=invalid_link

=== CENARIO B: RECOVERY code at /auth/confirm ===
recovery-code-at-confirm-route -> 307 http://localhost:3000/login?error=invalid_link
```

Baseline de controle (código inexistente): mesma resposta, sem `Set-Cookie` de sessão — confirma que
a rejeição é real, não um efeito colateral de outro erro. Adicionalmente, o script adversarial do
próprio projeto (`supabase/tests/auth-flow-purpose-check.ts`), rodado do zero nesta sessão, corrobora
com HTTP real:

```
PASS - Requisito 6/7 (BUG-RT2-003): código de confirmação em /auth/recovery: redirect=/login?error=invalid_link, sessão sobrevivente=false
PASS - Requisito 10: confirmação legítima continua funcionando: redirect=/, email_confirmed_at=...
PASS - Requisito 8/9 (BUG-RT2-004): código de recuperação em /auth/confirm: redirect=/login?error=invalid_link, sessão sobrevivente=false
PASS - Requisito 11: recuperação legítima continua funcionando: redirect=/reset-password
```

**Nota de limitação:** não foi isolado, por falta de tempo dentro do escopo desta sessão, se a
rejeição em Cenário A/B ocorre porque `exchangeCodeForSession` falha (mismatch de `code_verifier`
entre flows) ou porque `consume_auth_flow_grant` rejeita corretamente após uma troca bem-sucedida —
ambos os caminhos produzem o mesmo resultado seguro observável (nenhuma sessão utilizável, nenhum
grant fabricado), então o comportameto observável está confirmado seguro, mas a causa exata não foi
isolada. Não afeta a severidade do BUG-CLAUDE-001, que é uma cadeia inteiramente diferente (RPC
direta, sem depender de nenhum código PKCE).

### 5.4 Concorrência real da troca de senha — SEGURO

`supabase/tests/recovery-claim-concurrency-check.ts` usa `Promise.all` com duas conexões de rede
reais e independentes (confirmado lendo o código-fonte, não apenas a saída):

```
aba 1: claim_recovery_grant_for_password_change() = true
aba 2: claim_recovery_grant_for_password_change() = false
Exatamente 1 autorizacao bem-sucedida: PASS (1)
Exatamente 1 evento de auditoria (sem duplicar): PASS (1)
```

DELETE condicional atômico se comporta corretamente sob corrida real.

### 5.5 Migração — banco limpo e upgrade real desde a 0002 — SEGURO

`supabase/tests/migration-upgrade-check.sh`, executado do zero: parou o banco logo após 0001+0002,
inseriu uma linha histórica real (`action='signup_completed'`, válida só sob 0002), reaplicou
0003+0004 por cima **sem reset**, e verificou:

```
PASS - linha histórica com action='signup_completed' sobreviveu intacta ao upgrade da 0002 para o schema final
PASS - as 4 funções de auth_flow_grants existem após o upgrade
PASS - audit_log.store_id está ON DELETE RESTRICT após o upgrade
PASS - upgrade real desde a migration 0002 (com dados históricos) até o schema final: sem erro, dado histórico preservado, schema final funcional.
```

Ao final o script restaura o ambiente com reset completo + reseed — confirmado sem erro.
`audit_log_store_id_fkey` tem `confdeltype='r'` (RESTRICT) no catálogo real, confirmado pelo
subagente de catálogo via `pg_constraint`/`pg_get_constraintdef`.

### 5.6 Auditoria e imutabilidade — SEGURO

Confirmado via `supabase/tests/onboarding_isolation_check.sql` (Casos 25, 26a-c, rodado do zero
contra o banco real) e via catálogo:

```
PASS - Caso 25: ON DELETE RESTRICT bloqueou a exclusao da loja — evento historico nao pode ser alterado nem indiretamente
PASS - Caso 26a: authenticated bloqueado em UPDATE audit_log
PASS - Caso 26b: service_role tambem bloqueado em UPDATE audit_log (append-only real)
PASS - Caso 26c: service_role tambem bloqueado em DELETE audit_log
```

`revoke update, delete on public.audit_log from service_role` confirmado no catálogo real
(`role_table_grants` só mostra SELECT/INSERT para `service_role`).

### 5.7 RLS de TASK-001 e isolamento de onboarding de TASK-002 — SEGURO

`supabase/tests/isolation_check.sql` rodado do zero contra o banco recém-resetado, com UUIDs de
seed reais (não reaproveitados de execução anterior — substituídos manualmente numa cópia de
scratch, arquivo original do repositório não alterado):

```
PASS - Caso 1..7 (7/7)
```

`supabase/tests/onboarding_isolation_check.sql` rodado do zero:

```
PASS - Caso 1..26 (26/26), incluindo:
  Caso 17: authenticated nao consegue inserir diretamente em auth_flow_grants
  Caso 19a: consume_auth_flow_grant sem pedido pendente correspondente devolve false
  Caso 22: sessao de um usuario nao consegue consumir o grant pendente de outro usuario
```

**Observação importante:** o Caso 19a testa apenas a ausência de qualquer grant pendente — ele
**não** cobre o caminho do BUG-CLAUDE-001 (grant pendente existe, criado pela própria sessão comum
via RPC, sem nenhuma troca de código). Essa é a lacuna de cobertura que permitiu o bug passar
despercebido pela suíte SQL de 26 cenários.

## 6. Achados adicionais (não críticos, reportados para o revisor decidir prioridade)

### 6.1 BUG-CLAUDE-002 (BAIXO/MÉDIO) — evento de auditoria de confirmação de e-mail fabricável sem uso da rota do app

Mesma causa-raiz do BUG-CLAUDE-001, aplicada ao propósito `email_confirmation`: como o grant de
confirmação nasce automaticamente por trigger no signup (válido por 24h) e `consume_auth_flow_grant`
não verifica proveniência da sessão, qualquer sessão autenticada-mas-com-grant-ainda-pendente pode
chamar `consume_auth_flow_grant('email_confirmation')` diretamente e gravar um evento
`email_verification_completed` em `audit_log` **sem nunca ter passado pela rota `/auth/confirm`**.

Reproduzido: usuário confirmado via chamada direta ao GoTrue (`/auth/v1/verify`, fora da rota do
app), depois `consume_auth_flow_grant('email_confirmation')` chamado pela sessão comum:

```
consume_auth_flow_grant('email_confirmation') via RAW call (app route never visited) status: 200 true
```

Impacto limitado: não concede nenhum privilégio adicional (o e-mail já estava genuinamente confirmado
no GoTrue; `middleware-policy.ts` decide com base em `auth.users.email_confirmed_at`, não neste
grant) — o efeito é uma linha de auditoria que registra "confirmação via app" para um evento que na
verdade não passou pela rota do app. Efeito colateral notado pelo subagente: se o usuário depois
clicar no link real de confirmação, a rota encontra o grant já consumido e faz `signOut()` da sessão
legítima recém-criada (auto-DoS de UX, não um problema de segurança).

### 6.2 BUG-CLAUDE-003 (BAIXO) — `request_password_recovery_grant` sem rate limit na camada RPC

`app/(auth)/forgot-password/actions.ts` aplica rate limit + captcha apenas na Server Action. A RPC
`request_password_recovery_grant` é `GRANT EXECUTE`-ável a `anon` e chamável diretamente via
PostgREST, sem nenhum limite próprio — nenhum e-mail é disparado por ela (isso é
`resetPasswordForEmail`, chamada separadamente), então nem o rate limit nativo do GoTrue
(`email_sent`) se aplica. Como o upsert reseta `consumed_at`/`session_id` a cada chamada, um
atacante pode invalidar repetidamente o grant pendente de uma vítima (grief: a vítima clica no link
que já recebeu, mas o grant foi substituído por um mais novo que ela não tem), sem limite de
frequência. Encontrado por um dos subagentes de leitura; não verificado por execução direta nesta
sessão (reportado para priorização, não confirmado por reprodução HTTP nesta rodada).

## 7. Resultado completo da sequência exigida pela missão (sessão comum → recuperação → troca de senha)

Ver §4 na íntegra. Resumo:

| Passo | Resultado |
|---|---|
| `request_password_recovery_grant` (sessão comum, próprio e-mail) | `204`, sucesso |
| `consume_auth_flow_grant('password_recovery')` (mesma sessão comum) | `true` — **sem qualquer código de recuperação real** |
| `is_current_session_recovery_grant()` | `true` |
| `claim_recovery_grant_for_password_change()` | `true` |
| `PUT /auth/v1/user` (updateUser) | `200`, senha efetivamente trocada |
| Login com senha antiga | `400` (falha, como esperado após troca) |
| Login com senha nova | `200` (sucesso) |

**A sequência funcionou sem o código legítimo. Classificado como CRÍTICO, conforme instrução da missão.**

## 8. Totais reais obtidos nesta sessão (não copiados do relatório anterior)

| Gate | Resultado real obtido agora |
|---|---|
| `npm test` | **217/217** (22 arquivos) |
| TASK-001 RLS (`isolation_check.sql`) | **7/7** |
| TASK-002 SQL (`onboarding_isolation_check.sql`) | **26/26** |
| `auth-flow-purpose-check.ts` (troca cruzada PKCE) | **4/4** |
| `recovery-claim-concurrency-check.ts` | PASS (1 autorização, 1 auditoria, sob corrida real) |
| `slug-concurrency-check.ts` | PASS (1 sucesso, 1 `slug_taken`, sob corrida real) |
| `migration-upgrade-check.sh` (0002 → 0003/0004 com dado histórico) | PASS |
| `npm run lint` | PASS, sem warnings |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm audit` / `npm audit --omit=dev` | **0 vulnerabilidades** em ambos |

Todos os números batem com os declarados na implementação — a suíte automatizada em si está correta
e passando; o problema é que ela não cobre o caminho de ataque do BUG-CLAUDE-001 (ver §5.7).

## 9. Fluxos legítimos em navegador real

Testado com o Next.js dev server real (`npm run dev`) e o Claude Browser real (não headless
simulado por HTTP puro):

- Cadastro real via formulário `/signup` → e-mail de confirmação real recebido no Mailpit com link
  PKCE (`token=pkce_...&type=signup&redirect_to=.../auth/confirm`).
- `/forgot-password` real → e-mail de recuperação real recebido no Mailpit com link PKCE separado
  (`redirect_to=.../auth/recovery`).
- Cookies de sessão PKCE (`sb-127-auth-token-flow-<id>-code-verifier`) confirmados como
  multi-flow (vários `flow-id` coexistindo na mesma aba sem se sobrescreverem).
- Trocas cruzadas de código nas rotas reais rejeitadas com `/login?error=invalid_link` (ver §5.3).

Não foi executado o ciclo visual completo de onboarding/pending_payment nesta sessão (priorizado o
tempo para o teste crítico de Fase 3 e a Fase 4 real, que exigiam navegador). Isso é uma limitação
declarada — ver §11.

## 10. Logs e segredos

Verificado o log do `next dev` (stdout/stderr da sessão de teste): nenhuma senha, token, code
verifier, `service_role` ou link completo de autenticação foi encontrado nos logs — apenas linhas de
acesso (`METHOD /rota status em Xms`). Nenhum segredo real foi copiado para este relatório; os
tokens/códigos citados acima (ex.: `34bf9cbe-...`) são identificadores de teste de ambiente local
efêmero, já invalidados pelo reset de banco ao final da sessão (`migration-upgrade-check.sh` termina
com reset+reseed completo).

## 11. Testes que NÃO puderam ser executados nesta sessão, e motivo

- **Diagnóstico exato da causa da rejeição em Cenário A/B da Fase 4** (falha de `code_verifier` vs.
  rejeição pelo `consume_auth_flow_grant`) — não isolado por tempo; o resultado observável (seguro)
  foi confirmado, mas a causa raiz exata entre as duas hipóteses não foi diferenciada.
- **QA visual completo do ciclo de onboarding/pending_payment/active/suspended** em navegador real —
  não executado nesta rodada; coberto indiretamente pelos 217 testes automatizados e pelo relatório
  anterior do Júnior (que já havia validado esses guards via HTTP real), mas não re-executado com
  navegador real nesta sessão por priorização de tempo no achado crítico.
- **Verificação hands-on da BUG-CLAUDE-003** (rate limit ausente na RPC `request_password_recovery_grant`)
  — identificada por leitura de código por um subagente, não reproduzida via chamadas HTTP repetidas
  nesta sessão.
- **Stress de concorrência com mais de 2 requisições simultâneas** na troca de senha (a missão pede
  "duas ou mais") — só as 2 requisições do script do próprio projeto foram executadas; não foi feito
  um teste adicional com N>2 tentativas concorrentes.
- **Teste de "relógio do cliente alterado"** — não aplicável/não testável de forma significativa,
  já que toda a expiração é validada server-side via `now()` do Postgres, não por relógio de cliente;
  confirmado por leitura de código (`expires_at > now()` em todas as funções relevantes), não por
  um teste dedicado adicional.

## 12. Diferenças entre testes automatizados e testes reais

Os 217 testes unitários/integração (`npm test`) e os 26 cenários SQL passam integralmente e são
corretos dentro do que testam. Nenhum deles, porém, testa a cadeia completa "sessão comum chama as
RPCs de recuperação diretamente, sem nenhuma troca de código, para a própria conta" — o cenário mais
simples e mais barato de executar por um atacante real. Dois exemplos concretos dessa lacuna:

1. `onboarding_isolation_check.sql` Caso 19a testa "sem grant pendente → RPC nega" mas nunca testa
   "com grant pendente criado pela própria sessão comum → RPC concede" (que é exatamente o que
   acontece de verdade e é o comportamento vulnerável).
2. `recovery-claim-concurrency-check.ts` **usa essa exata cadeia como setup**, com um comentário no
   próprio arquivo racionalizando-a como equivalente a uma troca de código real — mascarando,
   sem intenção, o caminho de ataque dentro da própria infraestrutura de teste.

Isso reforça a instrução da missão de não tratar os testes da própria implementação como prova
suficiente: o BUG-CLAUDE-001 é inteiramente real, reproduzido contra Postgres/GoTrue/PostgREST reais,
mas invisível a qualquer execução de `npm test` ou dos scripts SQL declarados.

## 13. git status final

```
$ git status --short
$ git diff --stat
```

(Ambos vazios — nenhum arquivo de código de produção, migração ou teste existente foi alterado
durante esta verificação. Apenas este relatório foi criado.)

## 14. Confirmações explícitas

- Nenhum código de produção foi alterado.
- Nenhuma migração foi alterada.
- Nenhum teste existente foi alterado.
- Nenhum bug foi corrigido nesta sessão.
- Nenhum merge foi realizado.
- Nenhum deploy foi realizado.
- TASK-002 continua em REVIEW.
- Esta verificação não é uma aprovação. Aguardando revisão externa do ChatGPT.
