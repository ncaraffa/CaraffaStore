import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveUserDestination } from "@/lib/tenant/membership";

export const dynamic = "force-dynamic";

/**
 * Ponto central da matriz de redirecionamento (tasks/in-progress/task-002.md).
 * Anônimo/não verificado já são barrados pelo middleware antes de chegar
 * aqui, mas esta página revalida por conta própria — nunca confia só no
 * middleware (docs/SECURITY.md).
 */
export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!user.email_confirmed_at) redirect("/verify");

  const destination = await resolveUserDestination(supabase, user.id);
  redirect(destination.path);
}
