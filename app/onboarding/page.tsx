import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as onboarding from "@/lib/onboarding/service";
import { OnboardingError } from "@/lib/onboarding/service";
import { onboardingErrorMessage } from "@/lib/onboarding/messages";
import { resolveOnboardingView } from "@/lib/onboarding/steps";
import { resolveUserDestination } from "@/lib/tenant/membership";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defesa em profundidade: middleware já garante isto, esta página não
  // confia só nele.
  if (!user) redirect("/login");
  if (!user.email_confirmed_at) redirect("/verify");

  let progress;
  try {
    progress = await onboarding.ensureOnboardingProgress(supabase);
  } catch (error) {
    if (error instanceof OnboardingError && error.code === "already_has_store") {
      const destination = await resolveUserDestination(supabase, user.id);
      redirect(destination.path);
    }
    return (
      <main>
        <h1>Não foi possível carregar o onboarding</h1>
        <p role="alert">
          {error instanceof OnboardingError ? onboardingErrorMessage(error.code) : "Tente novamente."}
        </p>
      </main>
    );
  }

  const view = resolveOnboardingView(progress, requestedStep);

  return (
    <main>
      <h1>Configurar minha loja</h1>
      <ol className="step-list">
        <li data-done={Boolean(progress.merchant_name && progress.whatsapp)}>Seus dados</li>
        <li data-done={Boolean(progress.store_name)}>Nome da loja</li>
        <li data-done={Boolean(progress.slug)}>Endereço da loja</li>
        <li data-done={Boolean(progress.plan_code)}>Plano</li>
        <li data-done={progress.step === "completed"}>Revisão</li>
      </ol>

      {view === "profile" && <ProfileStep progress={progress} />}
      {view === "store_name" && <StoreNameStep progress={progress} />}
      {view === "slug" && <SlugStep progress={progress} />}
      {view === "plan" && <PlanStep progress={progress} />}
      {view === "review" && <ReviewStep progress={progress} />}
    </main>
  );
}
