"use client";

import { useActionState } from "react";
import Link from "next/link";
import { completeOnboardingAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";
import type { Database } from "@/lib/supabase/types";

type OnboardingRow = Database["public"]["Tables"]["onboarding_progress"]["Row"];

const PLAN_LABEL: Record<number, string> = { 30: "R$ 30/mês", 50: "R$ 50/mês", 80: "R$ 80/mês" };

export function ReviewStep({ progress }: { progress: OnboardingRow }) {
  const [state, formAction, pending] = useActionState(completeOnboardingAction, IDLE_ACTION_STATE);

  return (
    <div>
      <h2>Revisão</h2>
      {state.status === "error" && state.message && (
        <p className="form-status" data-tone="error" role="alert">
          {state.message}
        </p>
      )}

      <dl>
        <dt>Seu nome</dt>
        <dd>
          {progress.merchant_name} <Link href="/onboarding?step=profile">Editar</Link>
        </dd>
        <dt>WhatsApp</dt>
        <dd>
          {progress.whatsapp} <Link href="/onboarding?step=profile">Editar</Link>
        </dd>
        <dt>Nome da loja</dt>
        <dd>
          {progress.store_name} <Link href="/onboarding?step=store_name">Editar</Link>
        </dd>
        <dt>Endereço</dt>
        <dd>
          {progress.slug} <Link href="/onboarding?step=slug">Editar</Link>
        </dd>
        <dt>Plano</dt>
        <dd>
          {progress.plan_code ? PLAN_LABEL[progress.plan_code] : "—"}{" "}
          <Link href="/onboarding?step=plan">Editar</Link>
        </dd>
      </dl>

      <p className="form-hint">
        Ao concluir, sua loja é criada em modo de configuração pendente de pagamento — sem
        cobrança nesta etapa.
      </p>

      <form action={formAction}>
        <button type="submit" disabled={pending}>
          {pending ? "Concluindo..." : "Concluir cadastro da loja"}
        </button>
      </form>
    </div>
  );
}
