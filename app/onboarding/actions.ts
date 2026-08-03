"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as onboarding from "@/lib/onboarding/service";
import { FIELD_LEVEL_CODES, messageForOnboardingError } from "@/lib/onboarding/messages";
import { fieldErrorsFromZod } from "@/lib/auth/form-errors";
import {
  merchantProfileSchema,
  planSchema,
  slugSchema,
  storeNameSchema,
} from "@/lib/auth/schemas";
import { storeStatusRedirectPath } from "@/lib/tenant/store-redirect";

export interface StepState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Erro de uma função onboarding_* mapeado para o formato de StepState. */
function stepErrorState(error: unknown, fieldName?: string): StepState {
  const message = messageForOnboardingError(error);
  if (
    fieldName &&
    error &&
    typeof error === "object" &&
    "code" in error &&
    FIELD_LEVEL_CODES.has(String((error as { code: unknown }).code))
  ) {
    return { status: "error", fieldErrors: { [fieldName]: message } };
  }
  return { status: "error", message };
}

export async function saveProfileAction(_prev: StepState, formData: FormData): Promise<StepState> {
  const parsed = merchantProfileSchema.safeParse({
    merchantName: String(formData.get("merchantName") ?? ""),
    whatsapp: String(formData.get("whatsapp") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  try {
    await onboarding.saveProfile(supabase, parsed.data.merchantName, parsed.data.whatsapp);
  } catch (error) {
    return stepErrorState(error);
  }
  redirect("/onboarding");
}

export async function saveStoreNameAction(_prev: StepState, formData: FormData): Promise<StepState> {
  const parsed = storeNameSchema.safeParse({ storeName: String(formData.get("storeName") ?? "") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  try {
    await onboarding.saveStoreName(supabase, parsed.data.storeName);
  } catch (error) {
    return stepErrorState(error);
  }
  redirect("/onboarding");
}

export async function saveSlugAction(_prev: StepState, formData: FormData): Promise<StepState> {
  const parsed = slugSchema.safeParse({ slug: String(formData.get("slug") ?? "") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  try {
    await onboarding.saveSlug(supabase, parsed.data.slug);
  } catch (error) {
    return stepErrorState(error, "slug");
  }
  redirect("/onboarding");
}

export async function savePlanAction(_prev: StepState, formData: FormData): Promise<StepState> {
  const parsed = planSchema.safeParse({ planCode: formData.get("planCode") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createServerSupabaseClient();
  try {
    await onboarding.savePlan(supabase, parsed.data.planCode as 30 | 50 | 80);
  } catch (error) {
    return stepErrorState(error, "planCode");
  }
  redirect("/onboarding");
}

export async function completeOnboardingAction(_prev: StepState, _formData: FormData): Promise<StepState> {
  const supabase = await createServerSupabaseClient();

  // A própria função SQL onboarding_complete() já grava, na mesma
  // transação atômica, os eventos de auditoria store_created/
  // owner_assigned/plan_selected/onboarding_completed — não duplicar
  // aqui (ver supabase/migrations/0002_auth_onboarding.sql).
  let store;
  try {
    store = await onboarding.completeOnboarding(supabase);
  } catch (error) {
    return stepErrorState(error);
  }

  redirect(storeStatusRedirectPath(store.status, store.slug));
}
