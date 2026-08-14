import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Entrar",
};

import { LoginForm } from "./login-form";
import { RESET_LINK_INVALID_MESSAGE } from "@/lib/auth/messages";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const linkError = params.error === "invalid_link" ? RESET_LINK_INVALID_MESSAGE : undefined;
  return <LoginForm next={params.next ?? ""} linkError={linkError} />;
}
