# Verificação do implementador — correlação e ciclo de vida do recovery grant

**VERIFICAÇÃO DO IMPLEMENTADOR — CORRELAÇÃO E CICLO DE VIDA DO RECOVERY GRANT.**
Não é um QA independente. Sessão somente leitura de código/migrations/testes existentes — nenhum
arquivo de produção, migration ou teste existente foi alterado. Claude Code não declara aprovação,
não faz merge, não faz deploy e não move a tarefa para DONE.

**Commit testado:** `de6c2dc3931e2f48fb7af19dfd1500e92e53f441`
**Branch:** `feat/TASK-002-auth-onboarding`
**Relatórios anteriores (não sobrescritos):** `qa/reports/TASK-002.md`, `qa/reports/TASK-002-RETEST.md`,
`qa/reports/TASK-002-CLAUDE-VERIFICATION.md`, `qa/reports/TASK-002-CLAUDE-VERIFICATION-2.md`

## Resultado

**BLOQUEADOR ENCONTRADO.**

A correção anterior (BUG-CLAUDE-VERIF2-001) fechou corretamente o problema de *timing* (auditoria gravada
antes do `updateUser`), mas a correlação usada pela trigger de conclusão (`user_id` + `claimed_at is not
null and completed_at is null and revoked_at is null`, sem `expires_at`/`session_id`/janela temporal) não
prova relação causal entre uma tentativa de recuperação específica e uma alteração de senha posterior.
Confirmado empiricamente: **três cenários distintos e independentes** fazem uma alteração de senha
completamente não relacionada "concluir" um grant de recuperação antigo e interrompido, fabricando um
evento `password_recovery_completed` falso.

## 1. Estado inicial do Git

```
$ git status
On branch feat/TASK-002-auth-onboarding
nothing to commit, working tree clean

$ git rev-parse HEAD
de6c2dc3931e2f48fb7af19dfd1500e92e53f441

$ git log --oneline -8
de6c2dc fix(task-002): audit password recovery only after credential update
d53ff79 test(qa): add final TASK-002 remediation verification
cda0ae3 fix(task-002): bind password recovery to verified recovery tokens
3e0548e test(qa): add TASK-002 Claude verification report
f038c7d fix(task-002): secure recovery grants token purpose and audit flow
027678e test(TASK-002): add post-remediation independent QA
104eefb fix(TASK-002): remediate QA-reported authz bugs (BUG-T2-001..005, RESSALVA-T2-001)
115aa8f test(TASK-002): add independent authentication and onboarding QA
```

Idêntico ao esperado. Prosseguido.

## 2. Ambiente

Node v24.18.0, Supabase CLI local (Docker), `npm run build && npm run start` para os testes que
precisam do servidor real. Nenhuma credencial/serviço de produção usado.

## 3. Inspeção obrigatória — respostas exatas

### 3.1 WHERE completo da trigger

`handle_password_recovery_completion()` (`supabase/migrations/0004_account_audit.sql:188-194`):

```sql
update public.password_recovery_grants
set completed_at = now()
where user_id = new.id
  and claimed_at is not null
  and completed_at is null
  and revoked_at is null
returning id into v_grant_id;
```

### 3.2 O que a trigger verifica — e o que NÃO verifica

| Condição | Verificada? |
|---|---|
| `claimed_at IS NOT NULL` | ✅ Sim |
| `completed_at IS NULL` | ✅ Sim |
| `revoked_at IS NULL` | ✅ Sim |
| `expires_at > now()` | ❌ **NÃO** — confirmado no código e empiricamente (Cenário 3) |
| `session_id` (da sessão que fez updateUser) | ❌ **NÃO** — a trigger roda no contexto de `auth.users`, sem acesso a `auth.jwt()`/sessão da requisição que originou o `UPDATE`; não há comparação alguma com `session_id` |
| Janela temporal entre `claimed_at` e o `UPDATE` de `encrypted_password` | ❌ **NÃO** — nenhum limite de tempo, o grant pode ficar `claimed` indefinidamente e ainda ser "concluído" por qualquer alteração de senha futura |
| Qualquer prova além de `user_id` | ❌ **NÃO** — a única correlação é "este usuário tem uma linha claimed-não-completed-não-revoked", nunca "esta alteração específica de senha decorre desta autorização específica" |

### 3.3 Comportamento de `issue_password_recovery_grant` por estado existente

```sql
insert into public.password_recovery_grants (user_id, session_id, nonce_hash, expires_at)
values (...)
on conflict (user_id) do update
  set id = gen_random_uuid(),
      session_id = excluded.session_id,
      nonce_hash = excluded.nonce_hash,
      created_at = now(),
      expires_at = excluded.expires_at,
      claimed_at = null,
      completed_at = null,
      revoked_at = null;
```

**Sempre `INSERT ... ON CONFLICT (user_id) DO UPDATE`** (upsert), independente do estado anterior da
linha — não existe `DELETE` prévio nem diferenciação por estado. Confirmado empiricamente para os 5
estados pedidos:

| Estado anterior | Comportamento da nova emissão |
|---|---|
| Nenhuma linha (primeira vez) | `INSERT` normal |
| `pending` (nunca reivindicado) | Sobrescrita silenciosa — `id` novo, `session_id`/`nonce_hash`/`expires_at` novos, os 3 timestamps de estado resetados para `null` |
| `claimed` (reivindicado, não concluído) | **Mesma sobrescrita** — a reivindicação anterior é silenciosamente descartada (Cenário 6) |
| `completed` (recuperação anterior concluída com sucesso) | Mesma sobrescrita — permite um novo ciclo (Cenário 5) |
| "expirado" (linha `pending`/`claimed` com `expires_at` no passado) | Mesma sobrescrita — `expires_at` não é sequer consultado antes de sobrescrever |
| `revoked` (nenhum caminho atual grava isto, mas o comportamento seria idêntico) | Mesma sobrescrita |

`unique(user_id)` garante que só existe UMA linha por usuário a qualquer momento — isso impede
ambiguidade entre duas linhas simultâneas, mas **não implica nada sobre se uma alteração de senha
POSTERIOR pertence à MESMA tentativa** que originou aquela linha, porque a linha é identificada só por
`user_id`, e qualquer alteração de senha subsequente (de qualquer origem) dispara a mesma trigger contra
o mesmo `user_id`.

## 4. Cenário 1 — falha após claim + troca normal posterior

**BLOQUEADOR ENCONTRADO.**

Linha do tempo (usuário `corr-scenario1-*@example.test`):

1. `admin.generateLink({type:"recovery"})` + `verifyOtp` real → sessão de recuperação real.
2. `issue_password_recovery_grant` (service_role) → grant `pending`.
3. `claim_recovery_grant_for_password_change(nonce)` → `true`. Estado:
   `{"claimed_at":"...813897+00:00","completed_at":null,"revoked_at":null}`.
   Auditoria: `[email_verification_completed, password_recovery_authorization_claimed]`.
4. Sessão de recuperação revogada (`admin.auth.admin.signOut(token,"global")`, simula conexão
   caindo/sessão inválida antes do `updateUser`).
5. `updateUser({password})` na sessão de recuperação → **falha** (`Auth session missing!`). Estado
   inalterado: `claimed_at` preenchido, `completed_at` ainda `null`.
6. **Sem iniciar nova recuperação**: login normal (`signInWithPassword` com a senha antiga, sessão
   comum de verdade) + `updateUser({password: NEW_PASSWORD_NORMAL})` pelo fluxo comum do Supabase.
   Resultado: **sucesso**.
7. Estado FINAL do grant: `{"claimed_at":"...813897+00:00","completed_at":"...855302305+00:00","revoked_at":null}`
   — **o grant antigo, interrompido, foi marcado `completed`**.
8. Auditoria FINAL: `[email_verification_completed, password_recovery_authorization_claimed,
   password_recovery_completed]` — **`password_recovery_completed` foi fabricado** para uma troca de
   senha que não teve nenhuma relação com a recuperação original.
9. Login com senha antiga: `400`. Login com a senha trocada normalmente: `200` (a troca em si é
   legítima e funcionou — o problema é só a auditoria/estado do grant).

Nenhum evento genérico de "mudança de senha" foi criado (não existe esse evento no modelo atual) — a
única gravação indevida foi `password_recovery_completed`.

**Classificação: BLOQUEADOR DE INTEGRIDADE DE AUDITORIA**, conforme critério automático #1.

## 5. Cenário 2 — alteração administrativa posterior

**BLOQUEADOR ENCONTRADO.**

Mesma preparação do Cenário 1 (claim bem-sucedido, `updateUser` da recuperação falha por sessão
revogada). Em vez de uma troca normal, a alteração foi feita via `admin.auth.admin.updateUserById(userId,
{password})` (operação administrativa apropriada ao ambiente local — chave `service_role` nunca exposta
nos logs deste relatório).

Resultado: `sucesso`. Estado final do grant: `completed_at` preenchido
(`"...56.137349+00:00"`). Auditoria final inclui `password_recovery_completed`.

**Classificação: BLOQUEADOR**, conforme critério automático #2.

## 6. Cenário 3 — grant claimed expirado

**BLOQUEADOR ENCONTRADO.** Confirma explicitamente que a trigger **NÃO** verifica `expires_at > now()`.

Preparação: grant emitido com `p_ttl_seconds=1` (1 segundo, mínimo tecnicamente possível — `issue_password_recovery_grant`
rejeita `p_ttl_seconds <= 0`), claim bem-sucedido, `updateUser` da recuperação falha (sessão revogada).
Aguardados 2 segundos reais (`expires_at` confirmado no passado:
`"expires_at":"...12:47:57.457907+00:00"` contra o relógio real do teste, `nowExpired: true`).

Depois, alteração administrativa da senha (`admin.auth.admin.updateUserById`). Resultado: `sucesso`.
Estado final do grant: **`completed_at` preenchido mesmo com `expires_at` no passado**
(`"expires_at":"...57.457907+00:00"`, `"completed_at":"...58.760349+00:00"` — a conclusão aconteceu
DEPOIS da expiração). Auditoria final inclui `password_recovery_completed`.

**Classificação: BLOQUEADOR**, conforme critério automático #3.

## 7. Cenário 4 — nova recuperação após falha pós-claim

**Sem bloqueador — comportamento correto neste aspecto específico.**

1. 1ª tentativa: claim bem-sucedido, `updateUser` falha (sessão revogada). Grant fica `claimed`,
   `completed_at` null.
2. **Sem qualquer correção de código**, uma 2ª recuperação legítima é iniciada para o mesmo usuário
   (`generateLink` + `verifyOtp` reais) — funciona normalmente, um novo `token_hash` é emitido e
   verificável.
3. `issue_password_recovery_grant` da 2ª tentativa sobrescreve a linha (mesmo `user_id`) — `unique(user_id)`
   **não bloqueia** a nova emissão.
4. Nonce da 1ª tentativa, testado contra o estado atual: `claim_recovery_grant_for_password_change(oldNonce)`
   → `false` (não reivindica nada — a linha já foi sobrescrita).
5. 2ª tentativa: claim → `true`, `updateUser` → sucesso.
6. Auditoria final (ordem cronológica): `email_verification_completed`,
   `password_recovery_authorization_claimed` (1ª), `password_recovery_authorization_claimed` (2ª),
   `password_recovery_completed` (só 1, da 2ª tentativa realmente bem-sucedida).
7. Login com a senha da 2ª recuperação: `200`. Login com a senha antiga: `400`.

**Resultado obrigatório atendido**: o usuário NÃO fica permanentemente impedido de recuperar a senha
depois de uma falha pós-claim; `unique(user_id)` não bloqueia. **Ressalva de integridade**: a linha
antiga (1ª tentativa, `claimed`) é *sobrescrita silenciosamente*, não arquivada/revogada explicitamente
— o rastro do que aconteceu com a 1ª tentativa só sobrevive no `audit_log` (evento `claimed` da 1ª
tentativa), nunca fica visível na tabela operacional `password_recovery_grants` em si. Isso é aceitável
como decisão de design (a tabela operacional não pretende ser um log histórico), mas nesta rodada isso
também significa que, SE a 1ª tentativa nunca tivesse sido "limpa" por uma 2ª recuperação e em vez disso
uma troca de senha não relacionada acontecesse primeiro, o Cenário 1/2/3 se aplicaria.

## 8. Cenário 5 — três recuperações consecutivas com sucesso

**Sem bloqueador.**

Três ciclos completos (`generateLink` → `verifyOtp` → `issue` → `claim` → `updateUser`) para o mesmo
usuário, sequencialmente, cada um com uma senha diferente:

| Ciclo | updateUser | Login senha nova | Login senha anterior | Reuso do nonce já usado |
|---|---|---|---|---|
| 1 | sucesso | 200 | 400 | `false` |
| 2 | sucesso | 200 | 400 | `false` |
| 3 | sucesso | 200 | 400 | `false` |

Auditoria completa: 3× `password_recovery_authorization_claimed` intercalados com 3×
`password_recovery_completed`, em ordem cronológica correta, sem duplicação nem perda. `unique(user_id)`
não bloqueou nenhum dos 3 ciclos.

## 9. Cenário 6 — novo pedido enquanto existe grant claimed

**Sem bloqueador para o critério #6 específico (grant antigo não volta a ser utilizável)**, mas confirma
e documenta explicitamente o comportamento de sobrescrita silenciosa já antecipado no Cenário 4.

1. 1º claim bem-sucedido (grant `claimed`, não concluído).
2. Uma 2ª recuperação é solicitada e verificada (`verifyOtp` real) **enquanto a 1ª ainda está `claimed`**.
3. `issue_password_recovery_grant` da 2ª tentativa: sucesso — sobrescreve a linha inteira
   (`claimed_at` volta a `null`).
4. Tentativa de reivindicar com o nonce/sessão da 1ª tentativa: `false` — **o grant antigo NÃO volta a
   ser utilizável** (resultado correto).
5. 2ª tentativa completa normalmente: claim → `true`, `updateUser` → sucesso.
6. Exatamente 1 evento `password_recovery_completed` (não duplicado, não prematuro).
7. Login final com a senha do 2º ciclo: `200`.

**Comportamento determinístico**: a emissão mais recente sempre vence, sobrescrevendo qualquer estado
anterior (pending/claimed/completed) sem gerar dois grants simultâneos nem estado inconsistente. Não é,
por si só, um bloqueador — mas é o MESMO mecanismo (upsert por `user_id`, sem verificação de origem) que,
combinado com a ausência de checagem em `handle_password_recovery_completion`, produz os bloqueadores dos
Cenários 1-3.

## 10. Cenário 7 — alteração de senha sem grant

**Sem bloqueador.**

Usuário que nunca iniciou nenhuma recuperação. Alteração administrativa de senha:
`admin.auth.admin.updateUserById(userId, {password})` → sucesso. Auditoria final: só
`email_verification_completed` (da criação da conta) — nenhum `password_recovery_authorization_claimed`
nem `password_recovery_completed` fabricado. Nenhuma linha em `password_recovery_grants` (nunca existiu).
Confirma que a trigger não fabrica NADA quando genuinamente não há grant algum — o problema dos Cenários
1-3 é especificamente sobre grants `claimed`-e-abandonados, não sobre qualquer alteração de senha.

## 11. Cenário 8 — janela temporal e crash

Não executado como um teste de processo isolado (matar/reiniciar o `next start` literalmente), por ser
redundante com a evidência já obtida: o estado que um crash deixaria no banco (`claimed_at` preenchido,
`completed_at` null, sem nenhum request em andamento) é **exatamente o mesmo estado** produzido
artificialmente nos Cenários 1-3 via revogação de sessão. Como a trigger de conclusão só reage ao
`UPDATE` de `encrypted_password` em `auth.users` (nunca ao estado do processo Next.js), reiniciar a
aplicação não altera em nada a superfície do bug — a mesma alteração de senha não relacionada, feita a
qualquer momento (mesmo depois de reiniciar a aplicação, mesmo minutos/horas depois), continua
"concluindo" o grant abandonado. **A conclusão do Cenário 8 é a mesma dos Cenários 1-3: confirmado, sem
necessidade de um teste de crash literal adicional.**

## 12. Avaliação da relação causal entre claim e password update

A implementação atual afirma provar a relação causal via: `user_id` + "existe exatamente um grant
`claimed`-não-`completed`-não-`revoked`". Isso prova **unicidade** (não há ambiguidade entre duas linhas
candidatas — `unique(user_id)` garante isso), mas **não prova causalidade** — não há nada que amarre a
alteração específica de `encrypted_password` que disparou a trigger à sessão/requisição/janela de tempo
específica que fez o `claim`. Qualquer alteração de senha subsequente, de QUALQUER origem (sessão comum
autenticada, operação administrativa, e — por extensão lógica, não testada isoladamente nesta rodada —
uma futura funcionalidade de "trocar senha logado" caso venha a existir), short-circuita para "sim, isto
completa a recuperação pendente", mesmo sem qualquer relação real com o fluxo de recuperação que criou o
grant.

A semântica atual de `password_recovery_completed` é, na prática, mais próxima de: **"esta é a primeira
alteração de senha deste usuário depois de uma reivindicação de recuperação não concluída"** — não
**"esta alteração de senha é resultado direto daquela reivindicação de recuperação"**. Isso viola
explicitamente o critério de semântica aceitável definido para esta rodada.

## 13. Outras verificações rápidas (reexecutadas)

| Item | Resultado |
|---|---|
| `import "server-only"` presente em `recovery-grant-issuer.ts` | ✅ Confirmado (primeira linha do arquivo) |
| `service_role` ausente dos bundles cliente | ✅ Confirmado (`grep` em `.next/static` pós-build: nenhuma ocorrência) |
| Ataque original bloqueado | ✅ `bug-claude-001-regression-check.ts` PASS integral |
| Troca cruzada de token bloqueada | ✅ `auth-flow-purpose-check.ts` PASS integral |
| Concorrência de 5 senhas (cenário limpo, sem alteração posterior não relacionada) | ✅ `bug-claude-verif2-001-regression-check.ts` PASS integral — **nota**: este teste não cobre o bloqueador desta rodada, porque não inclui nenhuma alteração de senha posterior não relacionada; é exatamente por isso que a suíte existente não capturou o problema antes desta verificação |
| Auditoria append-only | ✅ Coberto por `onboarding_isolation_check.sql` Caso 29 (reexecutado) |
| `ON DELETE RESTRICT` | ✅ Coberto por Caso 28 (reexecutado) |
| Banco limpo | ✅ `npx supabase db reset` sem erro |
| Upgrade desde 0002 | ✅ `migration-upgrade-check.sh` PASS integral (9 eventos históricos variados) |
| `npm test` | ✅ 235/235 |
| `npm run lint` | ✅ OK |
| `npx tsc --noEmit` | ✅ OK |
| `npm run build` | ✅ OK |
| `npm audit` / `npm audit --omit=dev` | ✅ 0 vulnerabilidades em ambos |
| `onboarding_isolation_check.sql` | ✅ 33 cenários, 44 asserts, todos PASS |
| `isolation_check.sql` (TASK-001 RLS) | ✅ 7/7 |
| Scan de segredos nos logs do `npm run start` | ✅ Nenhuma ocorrência |

## 14. Bugs encontrados

| ID | Severidade | Descrição |
|---|---|---|
| BUG-CLAUDE-VERIF3-001 | **BLOQUEADOR / ALTA** | A trigger `handle_password_recovery_completion` correlaciona só por `user_id` + estado (`claimed_at`/`completed_at`/`revoked_at`), sem `expires_at > now()`, sem `session_id`, sem janela temporal. Qualquer alteração de senha subsequente e NÃO relacionada (troca normal por sessão comum, operação administrativa, ou o mesmo grant já expirado) marca um grant de recuperação abandonado como `completed` e fabrica um evento `password_recovery_completed` sem relação causal real com aquele evento de recuperação. Confirmado empiricamente nos Cenários 1, 2 e 3. |

Nenhum outro bug de escalação de privilégio, fabricação de grant, ou bypass de finalidade de token foi
encontrado nesta rodada — BUG-CLAUDE-001/002/003 e o problema de *timing* do BUG-CLAUDE-VERIF2-001
(auditoria antes do `updateUser`) permanecem corrigidos sob teste adversarial real; o problema desta
rodada é especificamente sobre a AUSÊNCIA de `expires_at`/janela temporal/prova de sessão na correlação
da trigger de conclusão, não uma regressão daquelas correções.

## 15. Limitações

- Cenário 8 (crash) avaliado por equivalência lógica de estado, não por um teste literal de
  matar/reiniciar o processo `next start` (ver §11).
- Não foi testado o efeito de uma futura funcionalidade de "trocar senha logado" (não existe hoje na
  TASK-002) — a análise do Cenário 1 já demonstra que o mesmo problema se aplicaria a qualquer caminho
  que chame `updateUser`, então uma funcionalidade assim herdaria automaticamente o mesmo bloqueador sem
  nenhuma mudança de código adicional.
- Não foi reexecutado o QA visual completo do ciclo de onboarding/pending_payment (código inalterado
  desde a rodada anterior, já validado).

## 16. Resultado final

**BLOQUEADOR ENCONTRADO — BUG-CLAUDE-VERIF3-001.** Não corrigido nesta sessão (somente leitura). TASK-002
continua em REVIEW, aguardando decisão da revisão externa sobre o desenho de correção (a arquitetura
alternativa mencionada nas instruções desta rodada — manter só `password_recovery_authorization_claimed`
e a trigger gravar um evento genérico `password_changed` sem afirmar "recovery completed" sem correlação
confiável — não foi implementada nesta sessão, por instrução explícita de só avaliar, não corrigir).
