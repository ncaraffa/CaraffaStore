# Verificação — TASK-005 (Pix e pagamentos)

**Branch:** `feat/TASK-005-pix-payments`
**Base:** `70efe3556753cdbfaa7967ca2b061fdd6126104d` (master, TASK-001/002/003/004 DONE)

## Modelo de credenciais por loja

`store_payment_settings` (uma linha por loja): `environment` (test/production), `encrypted_access_token`/
`encrypted_webhook_secret` (AES-256-GCM, `lib/payments/crypto.ts`), `access_token_preview` (mascarado,
ex. `APP_USR-••••1234`), `webhook_key` (256 bits, `extensions.gen_random_bytes(32)`), `is_enabled`,
`credentials_verified_at`, `last_error_code`. RLS habilitada **sem nenhuma policy** — todo acesso é por
função `SECURITY DEFINER` (`payment_settings_*`, reautoriza `can_manage_store_payments` a cada chamada)
ou pelo cliente `service_role` dedicado (`lib/payments/service-only/client.ts`, nunca reaproveita a
fábrica administrativa genérica de scripts — mesma restrição de BUG-T2-004). O valor cifrado nunca sai
do banco para o navegador; `payment_settings_get` nem tem essas colunas no seu retorno.

## Criptografia

AES-256-GCM (`lib/payments/crypto-core.ts`), chave só em `PAYMENT_ENCRYPTION_KEY` (32 bytes base64, nunca
`NEXT_PUBLIC_`), IV aleatório de 12 bytes por valor, formato `iv:tag:ciphertext` em base64. Falha alta e
cedo sem a variável (qualquer ambiente, não só produção). Testado (`lib/payments/crypto-core.test.ts`,
9 casos): round-trip, ciphertext diferente por IV, chave errada falha, ciphertext/tag adulterados falham
(autenticação), valor malformado falha, chave ausente/tamanho errado falha. Fronteira `server-only`
coberta por análise estática (`lib/payments/crypto.test.ts`, mesmo padrão de
`lib/supabase/service-only/recovery-completion.test.ts`).

## Modelo de order_payments

Uma tentativa por pedido (`order_id` UNIQUE — retry nunca cria uma segunda linha). `external_reference`
= o próprio `id` da linha (gerado pelo banco, nunca fabricável). `provider_idempotency_key` estável
(`pix-<order_id sem hifens>`, ≤64 chars). `status` interno separado do `orders.status`: `creating`,
`pending`, `approved`, `rejected`, `cancelled`, `expired`, `error`, `manual_review`. `payer_doc_last4`
(4 dígitos) + `payer_doc_type` — CPF/CNPJ completo nunca persistido (só vai ao provedor, em memória do
processo, durante a criação).

## Fluxo de criação

`lib/payments/checkout-orchestration.ts` (server-only): resolve loja `active` → credenciais Pix
habilitadas (`getStorePaymentCredentials`, senão `pix_not_configured`) → `create_order` (TASK-004, **sem
alteração**) → `pix_payment_attempt_upsert_creating` (cria a tentativa, marca `payment_mode=pix` +
`receipt_token_hash`, tudo atômico) → gera `X-Idempotency-Key` estável → `gateway.createPayment` → em
sucesso, `pix_payment_mark_created` persiste QR/expiração; em erro transitório mantém `creating` para
retry com a mesma key (nunca cancela); em erro definitivo, `pix_payment_mark_creation_failed` cancela o
pedido e devolve o estoque atomicamente. Carrinho só é limpo depois do QR ser exibido com sucesso.

## Idempotência

`X-Idempotency-Key` determinística a partir do `order_id` — nunca regenerada em retry/timeout/duplo
clique. `pix_payment_attempt_upsert_creating` é idempotente por `order_id` (retorna a tentativa existente
em vez de criar outra). Testado sob concorrência real (2 retries simultâneos de criação →
`supabase/tests/payment-concurrency-check.ts`, PASS).

## Webhook e validação de assinatura

`app/api/webhooks/mercado-pago/route.ts` → `lib/payments/webhook-handler.ts`: localiza a loja pelo
`client` (webhook_key) → valida `x-signature` (HMAC-SHA256 sobre `id:<data.id minúsculo>;request-id:<x-
request-id>;ts:<ts>;`, `lib/payments/gateway/webhook-signature.ts`) → **sempre** busca o pagamento real
no Mercado Pago (nunca confia no corpo) → aplica via `pix_payment_apply_provider_state` (mesma função da
reconciliação) → registra o evento (`payment_webhook_events`, dedup por
`(store_id, provider_payment_id, payload_hash)`). Nunca loga Access Token, Webhook Secret, assinatura
completa, CPF/CNPJ, QR Code completo nem o header `Authorization`.

## Reconciliação

`lib/payments/reconcile.ts` — núcleo único, usado pelo webhook, pela rota `/api/cron/payments/reconcile`
(protegida por `CRON_SECRET`), pela página pública de pagamento (ao abrir, se `pending`/`creating`) e
pelo botão "Reconciliar" do painel. Bloqueia `payment_attempt`/`orders` (`for update`) antes de decidir —
mesma técnica de `order_cancel` (TASK-004) — impedindo dupla confirmação/devolução mesmo sob concorrência
real.

## Expiração e restauração de estoque

Nunca cancela por relógio local — só quando o Mercado Pago confirma um estado terminal não pago
(`rejected`/`cancelled`/`expired`, este último inferido do `status_detail` quando `cancelled`, best-effort
documentado). Estoque só é restaurado nesse momento, exatamente uma vez.

## Relação payment status × order status

`payment.status=approved` → `order.status: pending→confirmed` (uma vez, auditoria `order_confirmed_by_payment`).
`payment.status` terminal-não-pago → `order.status: pending→cancelled` + estoque devolvido (auditoria
`order_cancelled_by_payment_failure`). `order_advance_status` recusa `pending→confirmed` manual para
`payment_mode=pix` (`payment_not_approved`) — só a engine confirma. Pedidos históricos (`payment_mode=
manual`) preservam o comportamento exato da TASK-004.

## Cancelamento de pedidos pagos

`order_cancel` (RPC) recusa **qualquer** pedido `payment_mode=pix` (`pix_order_requires_payment_flow`).
Cancelamento administrativo de um pedido Pix (`lib/payments/admin-actions.ts`) sempre reconcilia primeiro;
se já `approved`, devolve `paid_requires_refund` sem tocar em nada; se terminal não pago, o cancelamento
já foi feito pela própria reconciliação.

## Rotas públicas

`/loja/[storeSlug]/pedido/[publicCode]/pagamento` — exige o cookie HttpOnly de recibo (hash comparado em
tempo constante contra `orders.receipt_token_hash`) além do `publicCode`; sem os dois, 404, nenhum dado
exposto. `/api/webhooks/mercado-pago` (POST).

## Rotas administrativas

`/dashboard/settings/payments` (configurar/testar/ativar credenciais, copiar URL do webhook — nunca
mostra o valor completo salvo). `/dashboard/orders` (coluna + filtros de status de pagamento).
`/dashboard/orders/[orderId]` (estado do Pix, botão reconciliar, histórico de eventos sanitizado, sem
credencial visível). `/api/cron/payments/reconcile` (POST, `Authorization: Bearer <CRON_SECRET>`).

## RLS e privilégios

`store_payment_settings`: zero policy, zero GRANT para `anon`/`authenticated` — só `service_role` (tabela)
e RPCs `payment_settings_*` (authenticated, reautoriza no banco). `order_payments`: `SELECT` só para
`authenticated` com `can_manage_store_payments` (owner/admin, loja `active` — staff **não** vê pagamento,
diferente de pedidos). `payment_webhook_events`: zero policy, leitura só via
`payment_events_list_sanitized`. Mutações de `order_payments`/`payment_webhook_events`: só
`pix_payment_*`/`pix_webhook_event_record`, `EXECUTE` só para `service_role`.

## Auditoria

12 eventos novos (`payment_settings_configured/disabled`, `pix_payment_creation_started/created/approved/
rejected/cancelled/expired`, `pix_payment_reconciliation_failed`, `order_confirmed_by_payment`,
`order_cancelled_by_payment_failure`, `payment_manual_review_required`) — `audit_log_action_check` só
ALARGADO. `actor_user_id`/`store_id`/`action` nunca escolhidos pelo cliente (funções `SECURITY DEFINER`).

## Resultados dos gates (banco limpo, mesma sessão)

| Gate | Resultado |
|---|---|
| `npm test` | **424/424** |
| `npm run lint` | OK — 0 erros, 4 warnings `no-img-element` (3 pré-existentes + 1 novo, QR Code em base64, mesmo padrão aceito) |
| `npx tsc --noEmit` | OK, 0 erros |
| `npm run build` | OK — todas as rotas novas presentes (`/api/webhooks/mercado-pago`, `/api/cron/payments/reconcile`, `/dashboard/settings/payments`, `/loja/[storeSlug]/pedido/[publicCode]/pagamento`) |
| `npm audit` | 0 vulnerabilidades |
| TASK-001 RLS (`isolation_check.sql`) | **7/7 PASS** |
| TASK-002 SQL (`onboarding_isolation_check.sql`) | **56/56 PASS** |
| TASK-003 SQL (`catalog_isolation_check.sql`) | **35/35 PASS** |
| TASK-004 SQL (`orders_isolation_check.sql`) | **38/38 PASS** |
| TASK-005 SQL (`payments_isolation_check.sql`, novo) | **24/24 PASS** — 19 cenários (configuração por papel, DML direto negado, isolamento Loja A×B, idempotência de criação, approved/rejected/manual_review, guards de `order_cancel`/`order_advance_status`, staff sem acesso, eventos sanitizados) |
| Concorrência de estoque (`stock-concurrency-check.ts`) | **17/17 PASS** |
| Concorrência de pedidos (`order-concurrency-check.ts`) | **12/12 PASS** |
| Concorrência de pagamentos (`payment-concurrency-check.ts`, novo) | **12/12 PASS** — 2 webhooks approved concorrentes, webhook×reconciliação concorrente, approved×cancelled concorrente (exatamente um estado terminal vence, perdedor vira manual_review), 2 retries concorrentes de criação |
| `migration-upgrade-check.sh` | PASS — banco novo (0001→0007) e upgrade real desde a 0002 com histórico completo (TASK-002/003/004/005), incluindo um pedido legado real preservado com `payment_mode='manual'` |

## Smoke test (FakePixGateway, banco local real)

1. Login admin-a → `/dashboard/settings/payments` → salvar credenciais fake → "Testar conexão" (Validado)
   → "Ativar Pix".
2. Catálogo público → adicionar produto → checkout (nome/telefone/e-mail/CPF) → pedido `18EBE6F3` criado,
   redirecionado para `/pagamento` → QR Code (imagem + Copia e Cola) exibido, status "Aguardando
   pagamento".
3. Estado aprovado aplicado via `pix_payment_apply_provider_state` (mesma função que webhook/reconciliação
   usam — a simulação de "o Mercado Pago mudou de estado" não pode ser feita via HTTP contra o processo
   real do FakePixGateway, que vive isolado por processo; a função de aplicação de estado em si é a mesma
   testada exaustivamente nas suítes SQL/concorrência acima). Página de pagamento passou a mostrar
   "Pagamento aprovado" / "Pagamento confirmado!".
4. Painel → pedido `confirmado`, pagamento `Pago`, sem botão de cancelar (pago). Avançado
   `confirmed→preparing→ready→completed` sem erro.
5. Segundo pedido (`458E6639`, estoque 20→19→18 já contando o primeiro). Estado `rejected` aplicado da
   mesma forma → pedido `cancelled` automaticamente, estoque devolvido (18→19, conferido em banco), página
   pública mostra "Pagamento recusado... estoque devolvido", painel lista em "Expirado/cancelado".
6. Webhook real testado contra o servidor rodando: assinatura inválida → 401; `client` desconhecido → 401;
   `data.id` ausente → 400; assinatura HMAC-SHA256 **genuinamente válida** (calculada no navegador via
   Web Crypto, manifest documentado do Mercado Pago) → 200 `processed`, evento gravado em
   `payment_webhook_events`.
7. Mobile (375×812): páginas de pedidos e de pagamento sem overflow horizontal.
8. Nenhum erro de servidor novo em nenhum passo (só os 4 erros pré-existentes de refresh-token expirado de
   sessão anterior, não relacionados).

## Scan de segredos, bundle e logs

- `.next/static` (bundle do navegador): nenhuma ocorrência de `PAYMENT_ENCRYPTION_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `service_role`, nem dos valores reais das chaves locais.
- Nenhum arquivo novo usa `NEXT_PUBLIC_` para segredo de pagamento.
- Webhook/reconciliação/orquestração nunca fazem `console.log`/`console.error` de Access Token, Webhook
  Secret, assinatura completa, CPF/CNPJ ou `Authorization`.
- `git diff`/`git status`: nenhum arquivo de credencial real, nenhum `.env.local` versionado.

## Limitações não bloqueantes

- Distinção `cancelled` vs `expired` é best-effort (substring no `status_detail` do Mercado Pago) —
  documentado em `lib/payments/gateway/status-mapping.ts`; pior caso é só o rótulo interno, o pedido ainda
  é cancelado e o estoque ainda é devolvido corretamente.
- Corrida `completed` (operacional) × cancelamento não se aplica a pedidos Pix (cancelamento comum é
  sempre recusado para `payment_mode=pix`) — coberta indiretamente pelas mesmas garantias de lock de
  `orders`/`order_payments` já testadas.
- Sem teste real contra a API do Mercado Pago (nenhuma credencial real disponível neste ambiente) — todos
  os testes usam `FakePixGateway` determinístico, conforme decisão aprovada.

## Decisão

Todos os gates e o smoke test passaram nesta sessão, em banco limpo. Pronta para revisão externa.
