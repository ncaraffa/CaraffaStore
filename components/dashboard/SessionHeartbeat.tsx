"use client";

import { useEffect, useRef } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/auth/app-session";

/**
 * Mantém vivo o lease da sessão da CaraffaStore enquanto o painel está
 * aberto, e encerra a sessão local quando o servidor informa que ela foi
 * revogada (takeover, logout em outro lugar, remoção da equipe,
 * downgrade de plano).
 *
 * DUAS COISAS QUE ESTE COMPONENTE NÃO É:
 *
 *  - não é segurança. Se alguém remover este script, nada é liberado: as
 *    mutations continuam sendo recusadas pelo banco. Ele existe para o
 *    usuário não ficar clicando numa tela morta.
 *  - não é polling agressivo. Uma batida a cada 5 minutos, contra uma
 *    janela de stale de 30 no servidor — seis falhas seguidas ainda são
 *    toleradas.
 *
 * Bate também ao voltar do background: browsers congelam timers de aba
 * oculta, e um notebook que acordou depois de horas deve reconciliar na
 * hora em vez de esperar o próximo tick.
 */
export function SessionHeartbeat() {
  // Evita disparar dois redirects se o retorno negativo chegar em
  // paralelo pelo timer e pelo visibilitychange.
  const endedRef = useRef(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let cancelled = false;

    async function beat() {
      if (cancelled || endedRef.current) return;
      try {
        const { data, error } = await supabase.rpc("app_session_heartbeat");
        if (cancelled) return;
        // Erro de rede não encerra sessão: pode ser queda momentânea, e
        // desconectar o lojista por causa disso seria pior que esperar.
        if (error) return;
        if (data === false) {
          endedRef.current = true;
          window.location.href = "/login?sessao=encerrada";
        }
      } catch {
        // idem: silencioso de propósito.
      }
    }

    void beat();
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);

    function onVisible() {
      if (document.visibilityState === "visible") void beat();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
