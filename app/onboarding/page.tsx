import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as onboarding from "@/lib/onboarding/service";
import { OnboardingError } from "@/lib/onboarding/service";
import { onboardingErrorMessage } from "@/lib/onboarding/messages";
import { resolveOnboardingView } from "@/lib/onboarding/steps";
import { resolveUserDestination } from "@/lib/tenant/membership";
import { requireOnboardingAccess } from "@/lib/tenant/access-control";
import { OnboardingShell, type OnboardingStepInfo } from "@/components/onboarding/OnboardingShell";
import { Alert } from "@/components/ui/Alert";
import { ProfileStep } from "./profile-step";
import { StoreNameStep } from "./store-name-step";
import { SlugStep } from "./slug-step";
import { PlanStep } from "./plan-step";
import { ReviewStep } from "./review-step";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { step: requestedStep } = await searchParams;
  const supabase = await createServerSupabaseClient();

  // Único guard: usuário verificado, sessão não é de recuperação, e
  // (sem loja OU loja em `onboarding`) — qualquer outro estado já é
  // redirecionado aqui dentro (lib/tenant/access-control.ts).
  const { userId } = await requireOnboardingAccess(supabase);

  let progress;
  try {
    progress = await onboarding.ensureOnboardingProgress(supabase);
  } catch (error) {
    if (error instanceof OnboardingError && error.code === "already_has_store") {
      const destination = await resolveUserDestination(supabase, userId);
      redirect(destination.path);
    }
    return (
      <OnboardingShell steps={[]}>
        <h2>Não foi possível carregar o onboarding</h2>
        <Alert tone="danger">
          {error instanceof OnboardingError ? onboardingErrorMessage(error.code) : "Tente novamente."}
        </Alert>
      </OnboardingShell>
    );
  }

  const view = resolveOnboardingView(progress, requestedStep);

  const steps: OnboardingStepInfo[] = [
    { label: "Seus dados", done: Boolean(progress.merchant_name && progress.whatsapp), active: view === "profile" },
    { label: "Nome da loja", done: Boolean(progress.store_name), active: view === "store_name" },
    { label: "Endereço", done: Boolean(progress.slug), active: view === "slug" },
    { label: "Plano", done: Boolean(progress.plan_code), active: view === "plan" },
    { label: "Revisão", done: progress.step === "completed", active: view === "review" },
  ];

  return (
    <OnboardingShell steps={steps}>
      {view === "profile" && <ProfileStep progress={progress} />}
      {view === "store_name" && <StoreNameStep progress={progress} />}
      {view === "slug" && <SlugStep progress={progress} />}
      {view === "plan" && <PlanStep progress={progress} />}
      {view === "review" && <ReviewStep progress={progress} />}
    </OnboardingShell>
  );
}
