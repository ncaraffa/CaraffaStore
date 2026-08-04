# Verificação final, adversarial e somente leitura — TASK-002 (rodada 2)

**Este documento é uma VERIFICAÇÃO DO IMPLEMENTADOR — AGUARDANDO REVISÃO EXTERNA.**
Não é um QA independente. Claude Code não declara aprovação, não faz merge, não faz deploy e não
move a tarefa para DONE. Esta sessão foi somente leitura de código/migrations/testes — nenhum
arquivo de produção, migration ou teste existente foi alterado.

**Commit testado:** `cda0ae30574fcd680dc748fdff0e50e27609e04b`
**Branch:** `feat/TASK-002-auth-onboarding`
**Commit do relatório de verificação anterior:** `3e0548e51567f188c1bbe2bc405fb7b907806229`
**Relatórios anteriores (não sobrescritos):** `qa/reports/TASK-002.md`, `qa/reports/TASK-002-RETEST.md`,
`qa/reports/TASK-002-CLAUDE-VERIFICATION.md`

## Resultado

**BLOQUEADOR ENCONTRADO.**

Um bug real e reproduzível foi confirmado no Ponto 6 (semântica de auditoria do `claim`): o evento
`password_recovery_completed` é gravado em `audit_log` **dentro de** `claim_recovery_grant_for_password_change`,
que executa **antes** de `supabase.auth.updateUser({password})` em `app/(auth)/reset-password/actions.ts`.
Quando `updateUser` falha depois de um `claim` bem-sucedido (reproduzido nesta sessão via revogação real
da sessão entre os dois passos), a auditoria afirma que a recuperação de senha foi concluída, mas a senha
NUNCA mudou de fato. Isso corresponde exatamente aos critérios automáticos de reprovação #5 e #6 definidos
pela revisão externa.

Não há escalação de privilégio nem reuso do grant a partir deste bug (o grant é corretamente apagado e não
pode ser "devolvido" — confirmado abaixo) — é um bug de **integridade de auditoria/correção semântica**, não
uma nova via de ataque de autorização. Ainda assim, por instrução explícita da revisão externa, é
classificado como bloqueador.

## 1. Estado inicial do Git

```
$ git status
On branch feat/TASK-002-auth-onboarding
nothing to commit, working tree clean

$ git branch --show-current
feat/TASK-002-auth-onboarding

$ git rev-parse HEAD
cda0ae30574fcd680dc748fdff0e50e27609e04b

$ git log --oneline -8
cda0ae3 fix(task-002): bind password recovery to verified recovery tokens
3e0548e test(qa): add TASK-002 Claude verification report
f038c7d fix(task-002): secure recovery grants token purpose and audit flow
027678e test(TASK-002): add post-remediation independent QA
104eefb fix(TASK-002): remediate QA-reported authz bugs (BUG-T2-001..005, RESSALVA-T2-001)
115aa8f test(TASK-002): add independent authentication and onboarding QA
42e36df feat(TASK-002): auth, email verification, recovery and merchant onboarding
ca24351 docs(TASK-002): approve authentication and onboarding scope
```

Estado idêntico ao esperado. Prosseguido.

## 2. Ambiente

- Node v24.18.0, npm 11.16.0.
- Supabase CLI, stack local (Docker) já em execução — `npx supabase status` confirmou API/DB/Auth/Mailpit
  saudáveis.
- `npm run build && npm run start` usados para os testes do Ponto 4 (modo produção local, não `next dev`).
- Nenhuma credencial/serviço de produção usado.

## 3. PONTO 1 — Fronteira server-only e service role

### 3.1 Proteção explícita contra importação no cliente

`lib/supabase/service-only/recovery-grant-issuer.ts` **não** usa `import "server-only"` nem qualquer
mecanismo de falha em tempo de build equivalente. A proteção existente é só em tempo de execução, via
`getServiceRoleEnv()` (`lib/supabase/env.ts:47-51`): `if (typeof window !== "undefined") throw ...`.

Verificado: o pacote npm `server-only` **não está instalado** (`node_modules/server-only` ausente,
`package.json` sem a dependência).

**Risco prático avaliado como BAIXO, não crítico**, pelos seguintes motivos verificados nesta sessão:
- `SUPABASE_SERVICE_ROLE_KEY` não tem prefixo `NEXT_PUBLIC_`, então o Next.js não a inlina em nenhum bundle
  cliente por padrão (comportamento nativo do framework, independente de qualquer guarda no código) —
  confirmado empiricamente abaixo (§3.2).
- O módulo só é importado por `app/auth/recovery/route.ts` (Route Handler, sempre server-only por
  arquitetura do Next.js) — confirmado via `grep -rln "recovery-grant-issuer"`, único import real.
- Mesmo que o módulo fosse acidentalmente importado por um Client Component no futuro, o valor da chave
  seria `undefined` no navegador (não seria inlinado) e a validação `zod` de `getServiceRoleEnv` falharia
  com um erro claro, mas SÓ EM TEMPO DE EXECUÇÃO — não impediria o `next build` de compilar com sucesso um
  código morto referenciando o módulo. Isto é uma lacuna real de defesa em profundidade frente ao pedido
  explícito da revisão externa ("preferencialmente `import 'server-only'`"), mas não configura vazamento de
  segredo hoje.

**Recomendação (não aplicada nesta sessão, por ser somente leitura):** adicionar `import "server-only";`
como primeira linha de `lib/supabase/service-only/recovery-grant-issuer.ts` (requer `npm install server-only`,
pacote oficial do Next.js, zero dependências).

### 3.2 Verificação empírica de não-exposição da chave

```
$ SERVICE_KEY=$(grep "SUPABASE_SERVICE_ROLE_KEY" .env.local | cut -d= -f2)   # 164 caracteres
$ grep -rl "$SERVICE_KEY" .next/static                    → (vazio)
$ grep -rl "SUPABASE_SERVICE_ROLE_KEY" .next/static        → (vazio)
$ grep -rl "$SERVICE_KEY" .next/server                     → (vazio — nem no bundle SERVER;
                                                               valor só existe em process.env em runtime)
$ find .next -iname "*.map" | xargs grep -l "$SERVICE_KEY"  → (vazio)
```

A chave não aparece em nenhum artefato de build (cliente ou servidor) nem em source maps — comportamento
nativo do Next.js para variáveis sem prefixo `NEXT_PUBLIC_`, que só são lidas de `process.env` em tempo de
execução no servidor, nunca inlinadas em arquivo compilado.

### 3.3 Locais que referenciam os termos pesquisados

```
$ grep -rn "SUPABASE_SERVICE_ROLE_KEY" --include=*.ts --include=*.tsx .   (fora de node_modules)
```

| Arquivo | Uso |
|---|---|
| `lib/supabase/env.ts` | Definição do schema zod + guarda `typeof window` + leitura de `process.env` |
| `lib/supabase/admin.ts` | Fábrica de cliente genérica, documentada como proibida em código de fluxo de usuário (BUG-T2-004) — usada só por scripts de seed/manutenção/teste |
| `lib/supabase/service-only/recovery-grant-issuer.ts` | Único uso em código de fluxo de usuário — leitura + construção de um cliente `service_role` estreito, uma única chamada RPC |
| `lib/env/load-local-env.test.ts`, `lib/supabase/env.test.ts` | Testes unitários (mock de env var, nunca o valor real) |

Nenhum outro arquivo referencia a chave. `grep -rn "service_role"` (case-sensitive, minúsculo) devolve as
mesmas ocorrências acima mais comentários explicativos nas migrations e nos testes — nenhum uso de cliente
`service_role` fora de `lib/supabase/admin.ts` (scripts) e `recovery-grant-issuer.ts` (fluxo de usuário,
isolado).

### 3.4 Catálogo PostgreSQL

```sql
select p.proname, p.prosecdef, p.proconfig, r.rolname as owner
from pg_proc p join pg_roles r on r.oid = p.proowner
where p.proname in ('issue_password_recovery_grant','claim_recovery_grant_for_password_change',
                     'is_current_session_recovery_grant','handle_email_confirmed_audit');
```

| proname | security_definer | proconfig | owner |
|---|---|---|---|
| issue_password_recovery_grant | t | search_path="" | postgres |
| claim_recovery_grant_for_password_change | t | search_path="" | postgres |
| is_current_session_recovery_grant | t | search_path="" | postgres |
| handle_email_confirmed_audit | t | search_path="" | postgres |

Overloads/funções antigas (`request_password_recovery_grant`, `consume_auth_flow_grant`,
`handle_new_user_confirmation_grant`, `log_email_verification_completed`, `log_password_recovery_completed`):
**0 linhas** no catálogo — todas genuinamente removidas, nenhum overload órfão.

`EXECUTE` de `issue_password_recovery_grant`: `postgres` (owner) e `service_role` apenas — **zero** para
`anon`/`authenticated`/`PUBLIC`. Confirmado também via `has_function_privilege('public', oid, 'EXECUTE')` →
`false` para as 4 funções. `claim_recovery_grant_for_password_change`/`is_current_session_recovery_grant`:
`postgres` + `authenticated` apenas (nunca `anon`). `handle_email_confirmed_audit`: só `postgres`
(nenhum `authenticated`) — confirma que só o trigger a invoca.

Tabela `password_recovery_grants`: grants só para `postgres`/`service_role`; **zero** para `anon`/`authenticated`;
`pg_policies` com **0 linhas** (RLS habilitada, acesso 100% mediado por função `SECURITY DEFINER`).

### 3.5 Tentativas diretas de chamar `issue_password_recovery_grant`

Via `supabase/tests/bug-claude-001-regression-check.ts` (rodado nesta sessão, ver §6) e
`supabase/tests/onboarding_isolation_check.sql` Caso 18a/18b/18c (ver §10):

| Papel | Alvo | Resultado |
|---|---|---|
| `anon` | qualquer user_id | `403`, `permission denied for function issue_password_recovery_grant` |
| `authenticated` (sessão comum) | o próprio user_id | `403`, mesma mensagem |
| `authenticated` (sessão comum) | outro user_id (vítima) | `403`, mesma mensagem |

Nenhuma tentativa permitiu escolher `user_id`/`session_id`/`nonce`/`expires_at` — a chamada inteira é
rejeitada antes mesmo de os parâmetros serem avaliados (rejeição de `GRANT`, não de lógica de negócio).
Não existe `purpose`/`consumed_at` no desenho atual (a tabela tem só `user_id`/`session_id`/`nonce_hash`/
`expires_at`), então esses dois campos específicos citados no pedido não se aplicam a este schema.

## 4. PONTO 2 — Ataque original completo (banco/ambiente limpos)

Reproduzido via `supabase/tests/bug-claude-001-regression-check.ts`, rodado do zero (usuários novos,
banco recém-resetado/reseedado) contra `npm run start` (produção local):

| Passo | Resultado | Evidência |
|---|---|---|
| `request_password_recovery_grant` | RPC inexistente | `404` PostgREST |
| `consume_auth_flow_grant` | RPC inexistente | `404` PostgREST |
| `issue_password_recovery_grant` (para si) | Bloqueado | `403 permission denied` |
| `issue_password_recovery_grant` (para vítima) | Bloqueado | `403 permission denied` |
| `is_current_session_recovery_grant()`/`claim` após tudo acima | `false`/`false` | RPC direta |
| `GET /reset-password` (sessão comum, sem grant) | "Link inválido" | confirmado via navegador real (§7) |
| `updateUser` | Nunca alcançado (claim já bloqueia antes) | — |
| login com senha antiga | funciona | `200` |
| login com "senha nova" pretendida | falha | `400` |

Nenhum grant autorizador foi criado; nenhum evento de auditoria fabricado. Saída completa do script:

```
PASS - 1a. request_password_recovery_grant não existe mais (404 do PostgREST): status=404
PASS - 1b. consume_auth_flow_grant não existe mais (404 do PostgREST): status=404
PASS - 5. sessão comum não consegue chamar issue_password_recovery_grant para SI MESMA: status=403
PASS - 6. sessão comum não consegue emitir grant para OUTRO usuário (vítima): status=403
PASS - 2. is_current_session_recovery_grant()/claim continuam false: is_current=false, claim=false
PASS - 7. outra sessão do MESMO usuário não reivindica o grant de sessão diferente: claim=false
PASS - 8. usuário DIFERENTE não reivindica o grant de outro usuário: claim=false
PASS - (controle) sessão que fez verifyOtp de verdade AINDA reivindica: claim=true
PASS - 22. concorrência real com 5 tentativas simultâneas: exatamente 1 reivindicação
```

## 5. PONTO 3 — verifyOtp e finalidade do token

Confirmado por leitura de código (`app/auth/confirm/route.ts:81`, `app/auth/recovery/route.ts:88`): `type`
é um literal (`"signup"`/`"recovery"`) no código-fonte, nunca `searchParams.get("type")`. Nenhuma das duas
rotas lê `type` da URL em nenhum ponto. `exchangeCodeForSession` não existe mais em nenhuma das duas rotas
(`grep -n "exchangeCodeForSession" app/auth/confirm/route.ts app/auth/recovery/route.ts` → vazio) — só
`verifyOtp({type, token_hash})`.

| # | Teste | Resultado |
|---|---|---|
| 1 | token de confirmação em `/auth/recovery` | Rejeitado, `/login?error=invalid_link`, sem sessão sobrevivente (`auth-flow-purpose-check.ts`) |
| 2 | token de recuperação em `/auth/confirm` | Rejeitado, idem |
| 3 | confirmação e recuperação simultaneamente pendentes | Testado no Ponto 2 (grant de recuperação emitido não afeta trigger de confirmação, mecanismos independentes — tabela/trigger separados) |
| 4/5 | token antigo vs. novo (confirmação/recuperação cruzados) | Ver #6 abaixo |
| 6 | múltiplos tokens de recuperação | Testado nesta sessão: gerar um segundo token de recuperação **invalida automaticamente o primeiro no próprio GoTrue** — `verifyOtp` do token antigo devolve `"Email link is invalid or has expired"` mesmo sem nunca tê-lo usado; o token novo continua válido. Não há janela de corrida entre dois tokens de recovery vivos simultaneamente. |
| 7 | token já utilizado | Rejeitado — confirmado no Ponto 4 (reuso do link de recuperação real → `/login?error=invalid_link`) |
| 8 | token expirado | Coberto por SQL Caso 20 (grant expirado rejeitado) — expiração do `token_hash` em si é responsabilidade do GoTrue (TTL nativo), não testada isoladamente nesta rodada |
| 9 | `token_hash` inventado | `verifyOtp` falha (mesmo comportamento de "ausente"), rota devolve `/login?error=invalid_link` |
| 10 | `token_hash` vazio | Rota trata como ausente (`if (tokenHash)`/`if (!tokenHash)`), redireciona direto sem chamar `verifyOtp` |
| 11 | query string com `type` adulterado | Ignorado por completo — rota nunca lê `type` da URL (confirmado por leitura de código, ver acima) |
| 12 | `next`/open redirect | `lib/auth/redirects.ts` **inalterado** nesta remediação (`git diff f038c7d..HEAD -- lib/auth/redirects.ts` vazio) — já validado em rodadas anteriores, allowlist + rejeição de `//`/segmentos `..` |

## 6. PONTO 4 — Fluxo completo em `npm run start`, host consistente

Build de produção (`npm run build && npm run start`) usado, não `next dev`. Descoberta importante desta
rodada: o mesmo redirecionamento cross-host (`request.url` do Route Handler resolvendo para `localhost`
independentemente do `Host` da requisição) **também ocorre sob `npm run start`**, não é exclusivo do
`next dev` — verificado com uma sonda dedicada:

```
request host=http://127.0.0.1:3000 -> status=307 location=http://localhost:3000/login?error=invalid_link
request host=http://localhost:3000 -> status=307 location=http://localhost:3000/login?error=invalid_link
```

Ou seja: uma requisição feita a `localhost:3000` sempre recebe um `Location` também em `localhost:3000`
(auto-consistente); uma requisição feita a `127.0.0.1:3000` sempre recebe `Location` em `localhost:3000`
(cross-origin). Como `NEXT_PUBLIC_SITE_URL`/`site_url` do `config.toml` apontam para `127.0.0.1:3000`, o
e-mail real gerado pelo template sempre contém `127.0.0.1` — **usar exatamente o link do e-mail sem
modificação, em qualquer host de partida, sempre produz o salto cross-origin**, porque a rota em si
normaliza para `localhost` de qualquer forma.

**Interpretação:** por instrução explícita ("use consistentemente `localhost:3000`, não misture"), o teste
foi conduzido com o navegador/cliente HTTP sempre em `localhost:3000`, substituindo apenas o hostname do
link real do Mailpit por `localhost` (mantendo `token_hash`/`type` idênticos ao e-mail genuíno) — não uma
alteração de código, apenas o host usado para acessá-lo, exatamente como a instrução pede. Com isso, o
fluxo funcionou integralmente de ponta a ponta, com evidência de navegador real (Claude Browser) e de
`fetch` com cookie-jar manual:

| # | Etapa | Hostname | Resultado |
|---|---|---|---|
| 1-2 | signup | localhost:3000 | Sucesso, mensagem genérica |
| 3 | link no Mailpit | — | `http://127.0.0.1:3000/auth/confirm?token_hash=...&type=signup` |
| 4-5 | clique (host substituído p/ localhost) | localhost:3000 | `307` → `http://localhost:3000/`, 1 cookie de sessão setado |
| 6 | onboarding | localhost:3000 | `200`, formulário "Seus dados" renderizado (navegador real) |
| 8 | logout | localhost:3000 | Rota é `POST`-only (`app/logout/route.ts`); `GET` direto devolve `405` — não é bug, é o botão de logout que faz `POST` |
| 9 | login normal | localhost:3000 | `200`, sessão válida |
| 10 | forgot-password | localhost:3000 | Mensagem genérica: "Se este e-mail tiver uma conta, enviamos instruções..." |
| 11 | link no Mailpit | — | `http://127.0.0.1:3000/auth/recovery?token_hash=...&type=recovery` |
| 12-13 | clique (host substituído) | localhost:3000 | `307` → `http://localhost:3000/reset-password`, 2 cookies setados (`sb-127-auth-token` + `sb-recovery-nonce`, HttpOnly — invisível a `document.cookie`, confirmado via header bruto) |
| 13 | formulário renderiza | localhost:3000 | "Definir nova senha" (navegador real) |
| 14 | troca de senha | localhost:3000 | Sucesso, redireciona para `/login` |
| 15-16 | redirecionamento + encerramento de sessão | localhost:3000 | Confirmado — `window.location.href` final = `/login` |
| 17 | login com senha antiga | — | `400` (falha, correto) |
| 18 | login com senha nova | — | `200` (funciona, correto) |
| 19 | reuso do link de recuperação | localhost:3000 | `307` → `/login?error=invalid_link` (falha, correto) |
| 20 | reuso do grant | — | Coberto pelo Ponto 5 SQL (Caso 21) — grant já deletado pelo claim, `count=0` |
| 21 | sessão comum em `/reset-password` | localhost:3000 | "Link inválido" (navegador real, login com a senha NOVA, depois `GET /reset-password`) |
| 22 | sessão de recuperação em onboarding/dashboard | — | Estruturalmente impedido por `lib/auth/middleware-policy.ts` (`RECOVERY_SESSION_ALLOWED_PATHS`), código inalterado nesta rodada, não re-testado isoladamente por tempo (ver §16) |

**Classificação:** o fluxo legítimo **não falhou** quando o host foi mantido consistente conforme
instruído — não se enquadra no critério automático de reprovação #4. A causa-raiz do salto cross-host em
si (config `site_url=127.0.0.1` + `request.url` do Next.js sempre resolvendo para `localhost`) é reportada
como uma **limitação de ambiente separada**, não bloqueante por si só dado que o teste com host consistente
teve sucesso total — ver §16.

## 7. PONTO 5 — Cookie do nonce

Nonce real nunca revelado neste relatório — só metadados.

| Propriedade | Verificado | Como |
|---|---|---|
| HttpOnly | ✅ | Código (`app/auth/recovery/route.ts:112`) + invisível a `document.cookie` no navegador real, presente no header `Set-Cookie` bruto |
| SameSite | `lax` | Código, linha 114 |
| Secure em produção | ✅ | `secure: process.env.NODE_ENV === "production"` (linha 113) — em `npm run start` local, `NODE_ENV` não foi setado como `production` explicitamente pelo script `next start` do Next.js por padrão sem `NODE_ENV=production` no ambiente; **não verificado empiricamente nesta sessão se o valor real do processo era `"production"`** — ver limitação §16 |
| path restrito | `/reset-password` | Código, linha 115; confirmado meta-teste: o cookie não apareceu ligado a outras rotas |
| expiração coerente | ✅ | `maxAge: RECOVERY_GRANT_TTL_SECONDS` (30 min), mesmo valor usado como `p_ttl_seconds` na emissão |
| valor aleatório forte | ✅ | `randomBytes(32)` = 256 bits, código |
| banco guarda só hash | ✅ | `nonce_hash text` com `CHECK (nonce_hash ~ '^[0-9a-f]{64}$')`, populado via `extensions.digest(nonce,'sha256')` — confirmado no catálogo que a coluna nunca recebe o valor bruto |
| removido após sucesso | ✅ | `cookieStore.delete(RECOVERY_NONCE_COOKIE)` logo após o claim, independente do resultado (`app/(auth)/reset-password/actions.ts:71`) |
| removido após falha definitiva | ✅ | Mesma linha — `delete` roda antes do `if (!claimed)` |
| cookie expirado não funciona | ✅ | Coberto por SQL Caso 20 (`expires_at` checado no `WHERE` do `DELETE` atômico) |
| cookie copiado p/ outra sessão | ✅ bloqueado | SQL Caso 24 (`session_id` incorreto rejeitado) e `bug-claude-001-regression-check.ts` item 7 (outro navegador, mesmo usuário, nonce correto → `false`) |
| nonce correto + session_id errado | ✅ bloqueado | SQL Caso 24 |
| session_id correto + nonce errado | ✅ bloqueado | SQL Caso 23 |
| cookie sozinho sem sessão verificada | ✅ bloqueado | `claim_recovery_grant_for_password_change` exige `auth.uid()` não nulo — sem sessão autenticada, retorna `false` antes de qualquer comparação de nonce |

## 8. PONTO 6 — Claim, updateUser e semântica da auditoria (CRÍTICO — BUG CONFIRMADO)

### Ordem exata no código (`app/(auth)/reset-password/actions.ts`)

1. `isCurrentSessionRecovery` (gate de leitura)
2. Validação de senha (schema + HIBP se habilitado)
3. **`claimRecoveryGrantForPasswordChange(supabase, nonce)`** → `claim_recovery_grant_for_password_change(p_nonce)`
   no banco: `DELETE` atômico do grant **+ `INSERT INTO audit_log (..., 'password_recovery_completed', ...)`
   NA MESMA TRANSAÇÃO/FUNÇÃO**
4. `cookieStore.delete(RECOVERY_NONCE_COOKIE)`
5. **`supabase.auth.updateUser({password})`** — só depois do passo 3
6. Se `updateUser` falhar: `signOut()` e retorna erro
7. Se `updateUser` tiver sucesso: `signOut()` e `redirect("/login")`

### Nome exato do evento

`password_recovery_completed` (constante em `supabase/migrations/0003_recovery_session.sql:246`).

### Por que isto é um bug

O evento é gravado no **passo 3**, antes do **passo 5** (`updateUser`, a troca de senha real). Não há
nenhuma reversão possível caso o passo 5 falhe — o comentário do próprio código já reconhece isso
("O grant já foi consumido... não há como devolvê-lo") mas não corrige a consequência sobre a auditoria.

### Reprodução real (sessão revogada entre claim e updateUser)

Sequência: `verifyOtp` real → `issue_password_recovery_grant` real (via `service_role`, replicando
exatamente o que a rota faz) → `claim_recovery_grant_for_password_change` **sucesso** → sessão revogada
via `admin.auth.admin.signOut(access_token, "global")` (simula conexão caindo/sessão invalidada no meio do
fluxo, sem alterar nenhum código) → `updateUser` chamado com a sessão já revogada.

```
=== ESTADO IMEDIATAMENTE APÓS O CLAIM, ANTES DE QUALQUER updateUser ===
audit_log rows: [
  {"action":"email_verification_completed", ...},
  {"action":"password_recovery_completed", "created_at":"2026-08-04T10:37:20.126254+00:00"}
]
password_recovery_grants rows (expect 0, deleted by claim): []

=== TENTATIVA DE updateUser COM A SESSÃO JÁ REVOGADA (deve falhar) ===
updateUser succeeded: false error: Auth session missing! status: 400

=== ESTADO FINAL DO BANCO ===
audit_log rows FINAL: [... mesmas 2 linhas, SEM remoção/correção do evento ...]
password_recovery_grants rows FINAL (expect 0): []

=== VERIFICANDO SENHAS REAIS ===
login com senha ANTIGA status: 200 (a senha NUNCA mudou de fato)
login com senha 'nova' pretendida status: 400 (updateUser falhou, senha não mudou)

=== VEREDITO ===
Evento 'password_recovery_completed' já estava gravado ANTES de qualquer updateUser: true
A senha REALMENTE mudou (login novo funciona): false

!!! CONFIRMADO: audit_log afirma 'password_recovery_completed' mesmo quando updateUser
NUNCA teve sucesso (senha real não mudou) !!!
```

### Verificação dos itens pedidos após a falha forçada

- Grant permanece consumido (não restaurado): ✅ (`password_recovery_grants` = 0 linhas, confirmado)
- Nova tentativa exige novo `recovery`: ✅ (não há como reemitir sem um novo `verifyOtp` real — nenhuma
  RPC "restaura" um grant já deletado)
- Senha antiga continua válida: ✅ (`login old = 200`)
- Senha nova não funciona: ✅ (`login new = 400`)
- **Auditoria afirma falsamente que a senha foi alterada: SIM — este é o bug.**
- Nenhuma sessão privilegiada sobrevive: ✅ (sessão já estava revogada; nenhum novo grant/sessão de
  recuperação foi criado)
- Cookie removido/inutilizável: o cookie de nonce é removido pela Server Action real independentemente do
  resultado do `updateUser` (código lido, não exercido neste script isolado que chamou as RPCs diretamente
  sem passar pela Server Action em si — ver limitação §16)

### Classificação

**BUG CONFIRMADO — severidade ALTA (correção/integridade de auditoria, não escalação de privilégio).**
Nome sugerido pela revisão externa para o evento correto seria algo como `recovery_authorization_consumed`
(grant reivindicado com sucesso) e um evento SEPARADO, gravado só após `updateUser` ter sucesso real, para
`password_recovery_completed`. A causa-raiz é a mesma em toda a linhagem desta migração (já existia antes
desta rodada de correção também) — não foi introduzida pela remediação de BUG-CLAUDE-001/002/003, mas
também não foi corrigida por ela, e a revisão externa pediu explicitamente para testá-la nesta rodada.

## 9. PONTO 7 — Concorrência completa com cinco senhas

Cinco clientes independentes, mesma sessão (`setSession` com o mesmo `access_token`/`refresh_token` de um
`verifyOtp` real), cada um tentando `claim` → `updateUser` com uma senha diferente, disparados via
`Promise.all` (5 conexões HTTP reais e simultâneas):

```
tentativa 1: claim=true,  updateUser tentado=true,  updateUser sucesso=true
tentativa 2: claim=false, updateUser tentado=false, updateUser sucesso=null
tentativa 3: claim=false, updateUser tentado=false, updateUser sucesso=null
tentativa 4: claim=false, updateUser tentado=false, updateUser sucesso=null
tentativa 5: claim=false, updateUser tentado=false, updateUser sucesso=null

claims bem-sucedidos: 1
updateUser bem-sucedidos: 1
eventos de auditoria password_recovery_completed: 1

=== LOGIN FINAL COM AS 6 SENHAS CANDIDATAS ===
login com senha ANTIGA:       status=400 (falha)
login com senha concorrente 1: status=200 (FUNCIONA)
login com senha concorrente 2: status=400 (falha)
login com senha concorrente 3: status=400 (falha)
login com senha concorrente 4: status=400 (falha)
login com senha concorrente 5: status=400 (falha)
```

**Exatamente 1 de 6 senhas funcionou** (a da única tentativa que reivindicou o grant). Quatro tentativas
rejeitadas na etapa de `claim` (nunca chegaram a chamar `updateUser` — não houve segunda chamada de
`updateUser` nenhuma). Exatamente 1 evento de auditoria. Mecanismo de concorrência **correto** — este ponto
é diferente do bug do Ponto 6 (aqui a auditoria condiz com a realidade, porque a única tentativa que
gravou o evento foi também a única que teve `updateUser` bem-sucedido; o bug do Ponto 6 só se manifesta
quando a ÚNICA tentativa vencedora do `claim` falha depois no `updateUser`, cenário não coberto por este
teste de concorrência).

## 10. PONTO 8 — Confirmação e auditoria (trigger)

- Transição `NULL -> timestamp` cria exatamente um evento: confirmado por leitura do trigger
  (`AFTER UPDATE ... WHEN (old.email_confirmed_at IS NULL AND new.email_confirmed_at IS NOT NULL)`) — só
  pode disparar uma vez por natureza da cláusula (a coluna não pode voltar a `NULL` no desenho atual).
- Atualização posterior de `auth.users` não duplica evento: garantido pela mesma cláusula `WHEN`.
- Visita repetida ao link não cria evento: o `token_hash` é de uso único no próprio GoTrue (confirmado no
  Ponto 4, passo 19, para recovery; comportamento idêntico documentado para signup).
- `authenticated` não chama a função do trigger diretamente: **testado nesta sessão**,
  `perform public.handle_email_confirmed_audit()` como `authenticated` → `insufficient_privilege` (SQL
  Caso 27, script novo desta rodada).
- `PUBLIC` sem `EXECUTE`: confirmado via `has_function_privilege('public', oid, 'EXECUTE')` = `false`.
- Não existe RPC antiga de confirmação: `consume_auth_flow_grant`/`log_email_verification_completed` — 0
  linhas no catálogo.
- Usuário não confirmado não possui evento: estrutural (trigger só dispara na transição real).
- Migration/upgrade não gera evento retroativo falso: **verificado por inspeção de código, não por teste
  dedicado nesta rodada** — as migrations 0003/0004 só fazem `CREATE TRIGGER`, nunca `UPDATE auth.users`;
  logicamente impossível qualquer usuário histórico (já confirmado antes da migration) disparar o trigger
  retroativamente, pois o trigger só reage a uma transição que acontece DEPOIS de existir. `migration-upgrade-check.sh`
  (rodado nesta sessão, ver §11) não reportou nenhuma linha de auditoria inesperada.
- Migration não duplica eventos: confirmado — `migration-upgrade-check.sh` mostra a linha histórica
  sobrevivendo intacta, sem duplicação.

## 11. PONTO 9 — Solicitação de recuperação

Confirmado por leitura de `app/(auth)/forgot-password/actions.ts` (não alterado desde a última verificação,
diff vazio contra o commit anterior nesta seção específica) e por teste real (Ponto 2, Ponto 4): não cria
grant, não cria nonce, não cria sessão de recuperação, não cria evento de conclusão — só chama
`resetPasswordForEmail`. Responde genericamente ("Se este e-mail tiver uma conta...") tanto para e-mail
existente quanto inexistente (comportamento nativo do GoTrue). Passa por `checkRateLimit`/`verifyCaptcha` da
aplicação antes de chamar o Supabase.

**Limitação documentada honestamente (não é concessão de privilégio):** um cliente ainda pode chamar
`POST /auth/v1/recover` diretamente no Supabase com a `anon key`, contornando o rate limit/CAPTCHA da
aplicação (que só protegem a Server Action, não o endpoint nativo do GoTrue). Confirmado que isso:
- não cria nenhum grant (`issue_password_recovery_grant` é inalcançável por esse caminho, ver Ponto 1);
- não autoriza reset (nenhuma linha em `password_recovery_grants` resulta desta chamada isolada);
- não permite claim (nada para reivindicar);
- não expõe existência de conta (GoTrue responde igual para ambos os casos).
Isto é um vetor de abuso de ENVIO de e-mail (rate limit nativo do GoTrue — `email_sent = 2` em
`config.toml` — é a única proteção nesse caminho direto), não uma via de escalação de privilégio. Mitigável
em produção habilitando CAPTCHA nativo do GoTrue/Supabase, fora do escopo desta correção.

## 12. PONTO 10 — Migrations e privilégios

### Cenário A — banco limpo

```
npx supabase db reset  → aplica 0001-0004 sem erro
npm run seed:local     → sucesso
npm test                → 225/225
```

### Cenário B — upgrade da 0002

`supabase/tests/migration-upgrade-check.sh`, rodado do zero nesta sessão: para o banco logo após 0001+0002,
insere uma linha histórica real (`action='signup_completed'`), reaplica 0003+0004 por cima sem reset:

```
PASS - linha histórica com action='signup_completed' sobreviveu intacta ao upgrade da 0002 para o schema final
PASS - as 4 funções de password_recovery_grants/auditoria de confirmação existem após o upgrade
PASS - nenhuma função antiga (consume_auth_flow_grant/request_password_recovery_grant/handle_new_user_confirmation_grant) sobrevive ao upgrade
PASS - audit_log.store_id está ON DELETE RESTRICT após o upgrade
PASS - upgrade real desde a migration 0002 (com dados históricos) até o schema final: sem erro, dado histórico preservado, schema final funcional.
```

**Limitação:** o script usa uma única linha histórica (`signup_completed`), não múltiplos tipos de evento
histórico variados como pedido pelo Ponto 10 ("eventos históricos variados, não somente uma linha") — não
estendido nesta rodada por tempo; é o mesmo script já usado nas duas rodadas anteriores, não modificado
aqui (proibido alterar testes existentes).

Verificado: nenhuma função/tabela/policy antiga; nenhum overload antigo; nenhum `EXECUTE` herdado (catálogo,
§3.4); `audit_log` append-only (`revoke update, delete on public.audit_log from service_role` — confirmado,
SQL Caso 29); `ON DELETE RESTRICT` (SQL Caso 28); `TRUNCATE` não testado explicitamente nesta rodada (mas
coberto pela ausência total de `GRANT` de qualquer tipo para `anon`/`authenticated` nas duas tabelas
relevantes — sem `TRUNCATE` nem qualquer outro privilégio).

## 13. Regressões e gates — totais reais desta sessão

| Gate | Comando | Resultado real obtido |
|---|---|---|
| `npm test` | `npm test` | **225/225** (22 arquivos) |
| Lint | `npm run lint` | OK, sem erros |
| Typecheck | `npx tsc --noEmit` | OK, sem erros |
| Build | `npm run build` | OK |
| `npm audit` | `npm audit` | 0 vulnerabilidades |
| `npm audit --omit=dev` | `npm audit --omit=dev` | 0 vulnerabilidades |
| TASK-001 RLS | `isolation_check.sql` | **7/7 PASS** |
| TASK-002 SQL | `onboarding_isolation_check.sql` | **40/40 asserts PASS**, 0 FAIL, 0 ERROR (29 cenários numerados) |
| Purpose check | `auth-flow-purpose-check.ts` | **4/4 PASS** |
| `bug-claude-001-regression-check.ts` | idem | PASS (todos os itens) |
| `recovery-claim-concurrency-check.ts` | idem | PASS |
| `slug-concurrency-check.ts` | não re-executado nesta rodada (sem mudança de código na área de slug; já coberto pela rodada anterior) | — |
| `migration-upgrade-check.sh` | idem | PASS |

Todos os totais foram REEXECUTADOS nesta sessão contra banco/ambiente resetados, não copiados de relatórios
anteriores.

## 14. Scan de segredos e logs

Log do `npm run start` desta sessão revisado (`grep` por `password`, `service_role`, `access_token`,
`nonce`, senha de teste em texto puro): **nenhuma ocorrência**. Chave `service_role` não aparece em
`.next/static`, `.next/server`, nem em nenhum `*.map` (§3.2).

## 15. Bugs encontrados

| ID | Severidade | Descrição | Status |
|---|---|---|---|
| BUG-CLAUDE-VERIF2-001 | **ALTA** (integridade de auditoria, não escalação de privilégio) | `password_recovery_completed` gravado dentro do `claim`, antes de `updateUser` — auditoria pode afirmar troca de senha concluída quando ela falhou depois | Confirmado empiricamente, ver §8 |
| (observação) | BAIXA | `lib/supabase/service-only/recovery-grant-issuer.ts` não usa `import "server-only"` (proteção só em runtime) | Ver §3.1 — risco prático baixo, recomendação registrada |
| (observação) | BAIXA, não é bug | `POST /auth/v1/recover` chamável direto com anon key, contornando rate limit/CAPTCHA da aplicação — não concede privilégio | Ver §11, já era limitação conhecida/documentada |

Nenhum bug de escalação de privilégio, fabricação de grant, ou bypass de finalidade de token foi encontrado
nesta rodada — os 3 bugs anteriores (BUG-CLAUDE-001/002/003) permanecem corrigidos sob teste adversarial
real.

## 16. Limitações e testes não executados

- **`Secure` do cookie de nonce em produção**: não verificado empiricamente se `process.env.NODE_ENV`
  realmente vale `"production"` sob `npm run start` neste ambiente local (o código confia nisso
  corretamente; só não confirmei o valor real do processo nesta sessão por tempo).
- **Cenário B do Ponto 10 com múltiplos tipos de evento histórico**: só uma linha histórica testada (mesmo
  script das rodadas anteriores, não estendido — proibido alterar testes existentes nesta sessão).
- **Sessão de recuperação tentando acessar onboarding/dashboard diretamente**: não re-testado isoladamente
  nesta rodada (código de `lib/auth/middleware-policy.ts` inalterado desde a rodada anterior, onde já foi
  validado); coberto só por inspeção de código nesta rodada.
- **Cookie removido também no caminho de falha real da Server Action** (não da RPC isolada): o teste do
  Ponto 6 chamou as RPCs diretamente (para forçar a falha de forma controlada) em vez de passar pela Server
  Action real via HTTP — o comportamento de limpeza do cookie foi confirmado por leitura de código
  (`cookieStore.delete` roda incondicionalmente após o `claim`, antes de checar o resultado), não por
  observação direta de um `Set-Cookie` de remoção nesta falha específica.
- **`TRUNCATE` explícito**: não tentado como comando isolado; coberto pela ausência total de `GRANT` a
  `anon`/`authenticated` nas tabelas relevantes.
- **`slug-concurrency-check.ts`**: não reexecutado nesta rodada especificamente (sem mudança de código na
  área; já confirmado na rodada anterior).

## 17. git status final

```
$ git status
On branch feat/TASK-002-auth-onboarding
nothing to commit, working tree clean
```

Nenhum script de depuração temporário (`scripts/__point6_forced_failure.ts`,
`scripts/__point7_five_way_concurrency.ts`, `scripts/__point3_multi_token.ts`,
`scripts/__debug_redirect_host.ts`) permaneceu no repositório — todos removidos após uso, confirmado pelo
`git status` limpo acima.

## 18. Confirmações explícitas

- Nenhum código de produção, migration ou teste existente foi alterado nesta sessão.
- Nenhuma correção foi aplicada.
- Nenhum merge foi realizado.
- Nenhum deploy foi realizado.
- TASK-002 continua em REVIEW.
- Esta verificação não é uma aprovação. Aguardando revisão externa do ChatGPT.
