"use client";

import { useActionState } from "react";
import Link from "next/link";
import { completeOnboardingAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import styles from "./review-step.module.css";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

/**
 * `plan_code` (30|50|80) é o identificador técnico travado por CHECK
 * constraint — o texto exibido aqui é comercial e independente dele. Ver
 * o comentário em plan-step.tsx e docs/PLANS-SPEC.md.
 */
const PLAN_LABEL: Record<number, string> = {
  30: "Essencial — R$ 30/mês",
  50: "Crescimento — R$ 50/mês",
  80: "Profissional — R$ 70/mês",
};

export function ReviewStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(completeOnboardingAction, IDLE_ACTION_STATE);

  const rows = [
    { label: "Seu nome", value: progress.merchant_name, step: "profile" },
    { label: "WhatsApp", value: progress.whatsapp, step: "profile" },
    { label: "Nome da loja", value: progress.store_name, step: "store_name" },
    { label: "Endereço", value: progress.slug, step: "slug" },
    { label: "Plano", value: progress.plan_code ? PLAN_LABEL[progress.plan_code] : "—", step: "plan" },
  ];

  return (
    <div>
      <h2>Revisão</h2>
      {state.status === "error" && state.message && (
        <div style={{ marginBottom: "1.25rem" }}>
          <Alert tone="danger">{state.message}</Alert>
        </div>
      )}

      <dl className={styles.list}>
        {rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <div>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
            <Link href={`/onboarding?step=${row.step}`} className={styles.edit}>
              Editar
            </Link>
          </div>
        ))}
      </dl>

      <div className={styles.noticeGap}>
        <Alert tone="info">
          Ao concluir, sua loja é criada em modo de configuração pendente de pagamento — sem cobrança nesta etapa.
        </Alert>
      </div>

      <form action={formAction}>
        <Button type="submit" loading={pending}>
          Concluir cadastro da loja
        </Button>
      </form>
    </div>
  );
}
