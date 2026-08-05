# Aprovação final — TASK-005

**Branch:** `feat/TASK-005-pix-payments`
**Commit aprovado (feature branch):** `e46d8d068126c9c001d92f5f84d7a7799dc48d43`
(`feat(task-005): add per-store Pix payments`)

**Decisão: APROVADA PARA MERGE.**

## Credenciais por loja

`store_payment_settings` — uma linha por loja, `environment`/`is_enabled`/`credentials_verified_at`/
`last_error_code`/`access_token_preview` (mascarado) em texto claro; `encrypted_access_token`/
`encrypted_webhook_secret` sempre cifrados. RLS habilitada **sem nenhuma policy** — zero SELECT/DML
direto para `anon`/`authenticated` (confirmado via `information_schema.role_table_grants` e por
tentativa real de SELECT/INSERT/UPDATE/DELETE como `anon`/`authenticated`, todas negadas com
`insufficient_privilege`/`permission denied`). Todo acesso é por `payment_settings_*` (SECURITY
DEFINER, reautoriza `can_manage_store_payments` a cada chamada) ou pelo cliente `service_role`
dedicado de `lib/payments/service-only/client.ts`. Owner/admin de loja `active` configura; staff,
`pending_payment`, `suspended` e Loja B são negados (`insufficient_privilege`, confirmado em
`payments_isolation_check.sql` Casos 2-4 e 17b).

## Criptografia

AES-256-GCM (`lib/payments/crypto.ts` → `crypto-core.ts`), chave só em `PAYMENT_ENCRYPTION_KEY`
(32 bytes base64, nunca `NEXT_PUBLIC_`, ausente do bundle/commit/logs — confirmado por scan). IV
aleatório por valor: mesmo plaintext cifrado duas vezes produz ciphertext diferente (testado). Chave
errada, ciphertext/tag adulterados e valor malformado falham (testado, 9 casos em
`crypto-core.test.ts`). `payment_settings_get` nunca inclui as colunas cifradas no seu retorno
(confirmado por análise estática e pela função em si).

## Gateway fake e produção

`lib/payments/gateway/index.ts`: `PAYMENT_GATEWAY_MODE=fake` só é honrado fora de produção — com
`NODE_ENV=production` a aplicação lança erro alto e cedo em vez de aceitar cobranças falsas
silenciosamente (sem gateway fake como fallback automático em nenhuma hipótese — o real
`MercadoPagoPixGateway` é sempre o padrão sem a variável). Confirmado por leitura direta do código
(guarda condicional explícita) — sem credencial real disponível neste ambiente para um teste ao vivo
contra `NODE_ENV=production`, mas a lógica de bloqueio está no caminho de execução único de seleção
de gateway, sem bypass possível.

## Criação e idempotência

Fluxo (`lib/payments/checkout-orchestration.ts`): loja `active` + Pix habilitado → `create_order`
(TASK-004, sem alteração) → `pix_payment_attempt_upsert_creating` (atômico, `X-Idempotency-Key`
determinística por `order_id`, ≤64 chars) → gateway → QR/Copia-e-Cola persistidos. Retry/duplo
clique/timeout reusam a mesma key e a mesma linha (nunca uma segunda tentativa, nunca um segundo
pedido, nunca baixa de estoque duplicada) — confirmado sob concorrência REAL (2 retries simultâneos,
`payment-concurrency-check.ts`, PASS) e por SQL (Caso 8). `amount_cents` sempre vem de
`orders.total_cents` (não do cliente); `external_reference` é o próprio `id` da tentativa (gerado
pelo banco, não fabricável).

## Webhook

`lib/payments/webhook-handler.ts` (núcleo) + `app/api/webhooks/mercado-pago/route.ts` (adaptador
HTTP). Testado ao vivo nesta sessão contra o servidor real: assinatura ausente → 401; assinatura
inválida → 401; `client` desconhecido → 401; `data.id` ausente → 400; assinatura HMAC-SHA256
genuinamente válida (calculada no navegador, manifest documentado do Mercado Pago,
`id:<data.id minúsculo>;request-id:<x-request-id>;ts:<ts>;`) → aceita, evento registrado em
`payment_webhook_events`. O status do corpo nunca é confiado — o handler sempre chama
`reconcilePaymentAttemptByProviderPaymentId` (busca real no gateway) antes de aplicar qualquer
transição. Confirmado que o manifest usado no código bate exatamente com o testado em
`webhook-signature.test.ts` (9 vetores) — algoritmo não foi alterado nesta sessão, conforme
instrução.

## Reconciliação

Núcleo único (`lib/payments/reconcile.ts`) reusado por webhook, cron (`CRON_SECRET`), página pública
(ao abrir/"Atualizar status") e painel ("Reconciliar"). Trava `order_payments`/`orders` (`for update`)
antes de decidir — mesma técnica de `order_cancel` (TASK-004).

## Concorrência (real, `payment-concurrency-check.ts`, 12/12 PASS)

2 webhooks `approved` concorrentes → 1 confirmação, sem duplicar. Webhook + reconciliação
concorrentes → mesma garantia. `approved` × `cancelled` concorrentes no mesmo pagamento `pending` →
exatamente um estado terminal vence (`confirmed` OU `cancelled`, nunca os dois), o perdedor vira
`manual_review` com auditoria crítica, estoque sempre coerente com o vencedor. 2 retries concorrentes
de criação → 1 única tentativa.

## RLS e privilégios

`store_payment_settings`: zero GRANT para `anon`/`authenticated`. `order_payments`: SELECT só para
`authenticated` com `can_manage_store_payments` (owner/admin, loja `active` — staff excluído,
confirmado Caso 18). `payment_webhook_events`: zero policy, leitura só via
`payment_events_list_sanitized` (escopada por loja, confirmado Caso 19). DML direto (INSERT/UPDATE/
DELETE/TRUNCATE) negado nas 3 tabelas para `anon`/`authenticated` (Caso 6, e
`0007_payments.privileges.test.ts`, 22 testes estáticos). Todas as funções `SECURITY DEFINER` usam
`set search_path = ''`. Loja B nunca lê pagamentos/credenciais da Loja A (Caso 17).

## Auditoria

12 eventos novos, `audit_log_action_check` só alargado (confirmado por diff da constraint e pelo
teste estático dedicado). `actor_user_id`/`store_id`/`action` nunca escolhidos pelo cliente — sempre
resolvidos dentro da função `SECURITY DEFINER`. `payment_manual_review_required` registrado nos
conflitos de estado terminal (Casos 14/16, e no teste de concorrência `approved × cancelled`).

## Resultados finais dos gates (banco limpo, mesma sessão)

| Gate | Resultado |
|---|---|
| `npm test` | **424/424** |
| Lint | OK — 0 erros, 4 warnings `no-img-element` (aceitos, já documentados) |
| `npx tsc --noEmit` | OK, 0 erros |
| `npm run build` | OK — todas as rotas de pagamento presentes |
| `npm audit` | 0 vulnerabilidades |
| TASK-001 RLS (`isolation_check.sql`) | **7/7 PASS** |
| TASK-002 SQL (`onboarding_isolation_check.sql`) | **56/56 PASS** |
| TASK-003 SQL (`catalog_isolation_check.sql`) | **35/35 PASS** |
| TASK-004 SQL (`orders_isolation_check.sql`) | **38/38 PASS** |
| TASK-005 SQL (`payments_isolation_check.sql`) | **24/24 PASS** (19 cenários) |
| Privilégios estáticos (`0007_payments.privileges.test.ts`, dentro de `npm test`) | 22/22 PASS |
| Concorrência de estoque (`stock-concurrency-check.ts`) | **17/17 PASS** |
| Concorrência de pedidos (`order-concurrency-check.ts`) | **12/12 PASS** |
| Concorrência de pagamentos (`payment-concurrency-check.ts`) | **12/12 PASS** |
| `migration-upgrade-check.sh` | PASS — banco novo (0001→0007) e upgrade real desde a 0002 com histórico completo (TASK-002/003/004/005), pedido legado real preservado com `payment_mode='manual'` |
| Scan de bundle/segredos | `.next/static` sem `PAYMENT_ENCRYPTION_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`CRON_SECRET`/`service_role`/valores reais das chaves locais |

## Smoke test (FakePixGateway, banco local real)

1. Login admin-a → configurar credenciais fake → ativar Pix.
2. Catálogo → carrinho → checkout (nome/telefone/e-mail/CPF) → pedido criado, QR Code + Copia-e-Cola
   exibidos, status "Aguardando pagamento".
3. Webhook real testado contra o servidor rodando (ver seção "Webhook" acima) — todas as rejeições e
   a aceitação de assinatura válida confirmadas ao vivo.
4. Estado `approved` aplicado via `pix_payment_apply_provider_state` (a mesma função que o
   webhook/reconciliação chamam depois de consultar o provedor) — necessário porque o
   `FakePixGateway` mantém estado em memória por processo, e o servidor de desenvolvimento
   (`next dev`/Turbopack) não compartilha essa instância entre a Server Action que cria o pagamento
   e o Route Handler do webhook; isso é uma característica do duplo de teste em modo dev, não do
   gateway real (`MercadoPagoPixGateway` é stateless, chamada HTTP real a cada vez) nem da lógica de
   negócio (já provada exaustivamente por SQL/concorrência, que não dependem dessa instância
   compartilhada). Página pública passou a mostrar "Pagamento aprovado"/"confirmado"; painel mostrou
   pedido `confirmado`, pagamento `Pago`, sem botão de cancelar; avançado até `completed` sem erro;
   histórico de eventos do webhook (incluindo a tentativa real que retornou 503 pela limitação acima)
   visível no painel, sem nenhum dado escondido.
5. Segundo pedido criado; estado `rejected` aplicado da mesma forma → pedido `cancelled`
   automaticamente, estoque devolvido (conferido em banco: 19→18→19), página pública mostra
   "Pagamento recusado... estoque devolvido".
6. Mobile (375×812): sem overflow horizontal.
7. Nenhum erro de servidor novo em nenhum passo (só os erros pré-existentes de refresh-token expirado
   de sessão anterior, não relacionados).

## Limitações não bloqueantes

- **Descoberta nesta sessão:** uma chamada de webhook HTTP real, disparada por uma requisição
  genuinamente separada da que criou o pagamento, não encontra o estado do `FakePixGateway` (mapa em
  memória por instância de processo/módulo do `next dev`) — resulta em `provider_unreachable` (503),
  registrado corretamente como evento no painel, sem nenhum efeito de negócio indevido (falha segura:
  nunca aprova/cancela sem confirmação real). Isolado ao duplo de teste em modo de desenvolvimento;
  não se aplica ao gateway real (chamada HTTP stateless) nem à lógica de estado (provada
  independentemente via SQL/concorrência, que chamam a RPC diretamente). Não bloqueia porque: (1)
  nunca ocorre em produção (`FakePixGateway` é proibido com `NODE_ENV=production`); (2) o
  comportamento observado é o fail-safe correto (503, sem decisão indevida); (3) todos os gates que
  provam a máquina de estados em si (SQL, concorrência) não dependem dessa instância compartilhada.
  Recomenda-se, em versão futura, considerar um `FakePixGateway` opcionalmente respaldado em
  banco/arquivo compartilhado se testes ponta-a-ponta via HTTP real do webhook se tornarem uma
  exigência de gate.
- Distinção `cancelled` vs `expired` no mapeamento de status é best-effort (substring no
  `status_detail` do Mercado Pago).
- Sem teste real contra a API do Mercado Pago (nenhuma credencial real disponível neste ambiente).
- Sem cartão, boleto, OAuth, split, assinatura, reembolso, chargeback, nota fiscal — fora do escopo
  aprovado desta tarefa.

## Decisão

**APROVADA PARA MERGE.** Nenhum deploy realizado nesta sessão.
