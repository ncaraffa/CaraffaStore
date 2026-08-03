import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

/**
 * Callback de RECUPERAÇÃO DE SENHA apenas — confirmação de cadastro tem
 * sua própria rota dedicada (app/auth/confirm/route.ts). Ver o comentário
 * daquela rota para a explicação completa de por que a separação existe
 * (BUG-T2-003, qa/reports/TASK-002.md): é a rota em si, configurada como
 * `redirectTo` só em app/(auth)/forgot-password/actions.ts, que classifica
 * o fluxo — nunca um parâmetro de query.
 *
 * Depois de trocar o código pela sessão, grava um "grant" de recuperação
 * em `recovery_grants` — a prova real, verificada no PRÓXIMO request por
 * lib/tenant/recovery-session.ts, de que esta sessão específica nasceu
 * aqui (não de um login normal). `session_id` é gravado automaticamente
 * a partir do próprio JWT da sessão recém-criada (DEFAULT + CHECK
 * constraint em supabase/migrations/0003_recovery_session.sql) — não há
 * como o cliente influenciar esse valor, mesmo tentando enviá-lo
 * explicitamente.
 *
 * NÃO usa o claim `amr` do GoTrue para nada disso: confirmado
 * empiricamente contra o Supabase local real que confirmação de
 * cadastro e recuperação de senha produzem o mesmo `amr=[{"method":"otp"}]`
 * — inútil para diferenciar os dois fluxos (ver lib/auth/jwt.ts).
 *
 * Sempre redireciona para /reset-password — não há `next` configurável
 * aqui (não sobrou nenhum parâmetro do cliente capaz de influenciar o
 * destino ou a classificação do fluxo).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  let response = NextResponse.redirect(new URL("/reset-password", request.url));

  const env = getPublicSupabaseEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.redirect(new URL("/reset-password", request.url));
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  async function afterSuccess() {
    // Upsert: se já existir um grant anterior (ex.: usuário pediu
    // recuperação de novo antes de concluir a primeira), substitui pelo
    // desta sessão nova — nunca acumula grants órfãos de sessões já
    // encerradas.
    const { error } = await supabase
      .from("recovery_grants")
      .upsert({ user_id: (await supabase.auth.getUser()).data.user!.id }, { onConflict: "user_id" });

    if (error) {
      // Sem grant gravado, /reset-password vai recusar esta sessão (age
      // como "link inválido") — comportamento seguro por padrão, não
      // silenciosamente permissivo. Ainda assim, registra o problema.
      console.error("[auth/recovery] falha ao gravar recovery_grants:", error.message);
    }

    return response;
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      return afterSuccess();
    }
  } else if (tokenHash && type === "recovery") {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      return afterSuccess();
    }
  }

  // Código/token ausente/inválido/expirado/reutilizado — sempre a mesma
  // resposta, sem detalhar o motivo.
  return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
}
