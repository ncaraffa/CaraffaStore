# TASK-009 — CaraffaStore Commercial V2

Branch: `feat/TASK-009-commercial-v2`, criada a partir de `master` (`acfcd91`).

Revisão **exclusivamente de frontend, UX, copy e apresentação comercial**. Nenhuma
migration, policy RLS, RPC, Server Action com regra de negócio, rota de API,
webhook, state machine ou configuração de produção foi tocada. A branch usa
exatamente o mesmo backend da `master`.

## Auditoria que embasou as decisões

Verificado no código antes de qualquer alteração:

| Pergunta | Resposta encontrada | Onde |
| --- | --- | --- |
| Existe diferença funcional entre os planos? | **Não.** Só o valor cobrado muda. Nenhuma quota, limite ou gating por `plan_code`. | `platform_plan_price_cents` em `supabase/migrations/0008_saas_billing.sql`; `lib/billing/plans.ts` |
| A ativação da loja é manual? | **Não, é automática** desde a TASK-007: Pix aprovado → `stores.status = 'active'`. | `billing_charge_apply_provider_state`, `0008_saas_billing.sql`; `lib/billing/reconcile.ts` |
| Existe cobrança recorrente / renovação automática? | **Não.** A cobrança só é criada pela tela `/pending-payment`. Não há cron de billing nem suspensão automática por vencimento. | `lib/billing/orchestration.ts`; `vercel.json` |
| A conexão com o Mercado Pago é OAuth? | **Não.** É colagem manual de Access Token + Webhook Secret, e o endereço de notificação é cadastrado à mão no painel do MP. | `app/dashboard/settings/payments/**` |
| A loja pública tem logo/capa personalizável? | **Não.** Só nome da loja em texto. | `components/storefront/StorefrontHeader.tsx`; tabela `stores` |
| Existe loja de demonstração pública? | **Não.** Fixtures são só de seed local. | `lib/data/fixtures.ts`; `scripts/seed-local.ts` |

## Principais mudanças

- **Demonstração da loja** (`components/marketing/StorefrontDemo.*`): reprodução fiel
  das telas reais de `/loja/[slug]` — catálogo, checkout e Pix — em moldura de
  navegador + trilho de celulares. Sem logo nem capa, porque o produto não os tem.
- **Planos** (`components/marketing/PricingPlans.*`): três cartões cuja diferença
  é o **nível de acompanhamento humano**, não recurso de software. Importa
  `PLATFORM_PLANS` de `lib/billing/plans.ts` — landing, onboarding e cobrança não
  podem divergir.
- **Termos e Privacidade**: casca visual própria (`components/legal/LegalPage.*`),
  com sumário e data de atualização. Removida a linguagem de "minuta/piloto" e
  corrigido o texto que ainda descrevia ativação manual.
- **Copy**: linguagem de desenvolvedor removida ("isolamento imposto no banco de
  dados", "credenciais"), redundância cortada (FAQ 8→6, bento 6→4, "não faz"
  4→3) e claims ajustados à realidade (ver relatório da task).
- **Domínio e contato** (`lib/config/site.ts`): `NEXT_PUBLIC_SITE_URL` e
  `NEXT_PUBLIC_CONTACT_EMAIL`, ambos opcionais e com o valor atual como padrão.
- **Acessibilidade**: `<Button as="span">` elimina `<button>` dentro de `<a>` nos
  18 pontos onde isso existia.

## Diferenciação dos planos — compromisso comercial, não código

Os planos anunciam níveis de **atendimento e acompanhamento** (suporte
prioritário, ajuda na configuração, revisão da loja). Isso é deliberado e não
tem contrapartida no sistema:

- nenhum entitlement, quota ou gating por `plan_code` foi criado — o backend
  segue exatamente como na `master`;
- nada no código verifica ou entrega esses serviços: **quem os cumpre é o
  operador**. São promessas comerciais que precisam ser honradas manualmente;
- por isso nenhum bullet de Crescimento ou Profissional cita funcionalidade de
  software — só atendimento. Um bullet de recurso ali seria falso.

## Fora de escopo — recomendações para tasks futuras (backend)

1. **Diferenciação funcional de planos.** Se um dia os planos precisarem
   diferir no produto (e não só no atendimento), isso exige uma task de backend
   que defina e implemente quotas/recursos por `plan_code` antes de a landing
   poder anunciá-los.
2. **Renovação mensal.** Não há cobrança recorrente nem suspensão por vencimento.
   Hoje os Termos dizem isso abertamente; automatizar exige backend.
3. **Política de senha (15 caracteres).** Mantida intacta. Só a explicação visual
   melhorou (`components/auth/PasswordGuide`).
4. **Loja de demonstração pública real.** Exigiria seed/rota dedicada. A
   demonstração atual é visual, no frontend.
5. **Identidade da loja (logo/capa/cor).** Não existe no schema; a demonstração
   deliberadamente não mostra o que o produto não entrega.
6. **`docs/production-runbook.md` seção 13** descreve ativação manual — ficou
   desatualizado desde a TASK-007. Não foi alterado aqui por ser documentação
   operacional de backend.
