"use client";

import { useActionState } from "react";
import { resendVerificationAction } from "./actions";
import { IDLE_ACTION_STATE } from "@/lib/auth/action-state";

export function ResendForm() {
  const [state, formAction, pending] = useActionState(resendVerificationAction, IDLE_ACTION_STATE);

  return (
    <form action={formAction}>
      {state.status !== "idle" && state.message && (
        <p
          className="form-status"
          data-tone={state.status === "error" ? "error" : "success"}
          role="status"
        >
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Reenviando..." : "Reenviar confirmação"}
      </button>
    </form>
  );
}
