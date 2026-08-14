"use client";

import { useState } from "react";
import Link from "next/link";
import { PLATFORM_PLANS, getPlatformPlan, type PlatformPlan } from "@/lib/billing/plans";
import { Button } from "@/components/ui/Button";
import { IconArrowRight, IconCheck } from "@/components/ui/icons";
import styles from "./PlanPicker.module.css";

/* ============================================================
   Planos — um produto, três faixas de preço

   Por que não são três cartões comparativos: hoje NÃO existe
   nenhuma diferença funcional entre plan_code 30, 50 e 80 no
   código nem no banco. A única coisa que muda é o valor cobrado
   (platform_plan_price_cents, 0008_saas_billing.sql). Nenhum
   limite de produtos, imagens, pedidos, usuários ou lojas está
   implementado, e nenhum recurso é liberado por plano.

   Três cartões lado a lado FORÇAM a leitura comparativa — e a
   comparação honesta seria três colunas idênticas, o que faz o
   preço maior parecer arbitrário. Um seletor de faixa resolve o
   problema no lugar certo: existe um produto só, completo em
   qualquer faixa, e o lojista escolhe o valor que corresponde ao
   tamanho da operação dele. É a mesma verdade, apresentada de um
   jeito que não se sabota.

   A lista de preços vem de lib/billing/plans.ts — a MESMA que o
   onboarding e a tela de cobrança usam, para landing e produto
   nunca divergirem. `code` é o identificador técnico (o
   Profissional é 80 por herança de banco, custando R$ 70): nunca
   exiba `code` como preço.
   ============================================================ */

/** Recursos reais, verificados no produto — todos valem para as três faixas. */
const INCLUDED = [
  "Catálogo público com endereço próprio",
  "Produtos com fotos, preço e estoque",
  "Categorias e busca no catálogo",
  "Carrinho e pedido sem cadastro do cliente",
  "Cobrança por Pix em cada pedido, com confirmação automática",
  "Painel de pedidos com baixa de estoque",
  "Sem limite de produtos, fotos ou pedidos",
  "Sem comissão sobre as vendas",
];

/**
 * Faixa aberta por padrão — a mesma que o onboarding já destaca
 * (`featured` em PLATFORM_PLANS), para o visitante não ver um plano em
 * destaque aqui e outro lá dentro. Lida por `getPlatformPlan`, que
 * garante um plano existente em tempo de tipo e falha alto se o catálogo
 * mudar sem esta tela acompanhar.
 */
const DEFAULT_PLAN = getPlatformPlan(50);

export function PlanPicker() {
  const [selected, setSelected] = useState<PlatformPlan>(DEFAULT_PLAN);

  return (
    <div className={styles.panel}>
      <div className={styles.pricing}>
        <p className={styles.pickerLabel} id="plan-picker-label">
          Escolha a faixa da sua operação
        </p>

        <div className={styles.picker} role="radiogroup" aria-labelledby="plan-picker-label">
          {PLATFORM_PLANS.map((plan) => (
            <button
              key={plan.code}
              type="button"
              role="radio"
              aria-checked={plan.code === selected.code}
              className={styles.option}
              data-selected={plan.code === selected.code || undefined}
              onClick={() => setSelected(plan)}
            >
              {/* Linha de nível — o motivo da marca. Ordena as faixas sem
                  sugerir recurso exclusivo em nenhuma delas. */}
              <span className={styles.level} aria-hidden="true">
                <span data-on={plan.tier >= 1 || undefined} />
                <span data-on={plan.tier >= 2 || undefined} />
                <span data-on={plan.tier >= 3 || undefined} />
              </span>
              <span className={styles.optionName}>{plan.label}</span>
              <span className={styles.optionPrice}>R$ {plan.price}</span>
            </button>
          ))}
        </div>

        <div className={styles.priceBlock}>
          <p className={styles.price}>
            <span className={styles.currency}>R$</span>
            <span className={styles.priceValue}>{selected.price}</span>
            <span className={styles.period}>/mês</span>
          </p>
          <p className={styles.priceNote}>
            Plano <strong>{selected.label}</strong> · mensalidade fixa, sem comissão sobre o que você vende.
          </p>
        </div>

        <Link href="/signup" className={styles.cta}>
          <Button as="span" size="lg" fullWidth icon={<IconArrowRight />} iconPosition="end">
            Começar com o {selected.label}
          </Button>
        </Link>

        <p className={styles.switchNote}>
          Dá para mudar de faixa depois — é só falar com a gente. O acesso à plataforma não muda.
        </p>
      </div>

      <div className={styles.included}>
        <p className={styles.includedTitle}>Incluído em qualquer faixa</p>
        <ul className={styles.includedList}>
          {INCLUDED.map((item) => (
            <li key={item}>
              <IconCheck />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
