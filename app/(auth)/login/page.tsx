import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Entrar",
};

import { LoginForm } from "./login-form";
import { RESET_LINK_INVALID_MESSAGE, SESSION_ENDED_MESSAGE } from "@/lib/auth/messages";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; sessao?: string }>;
}) {
  const params = await searchParams;
  // `sessao=encerrada` chega de requireStoreStatus quando a sessão desta
  // máquina foi revogada por decisão e NÃO pode ressuscitar (0023).
  const linkError =
    params.sessao === "encerrada"
      ? SESSION_ENDED_MESSAGE
      : params.error === "invalid_link"
        ? RESET_LINK_INVALID_MESSAGE
        : undefined;
  return <LoginForm next={params.next ?? ""} linkError={linkError} />;
}
