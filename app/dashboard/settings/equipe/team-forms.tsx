"use client";

import { useActionState } from "react";
import {
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
  type TeamActionState,
} from "./actions";
import { Alert } from "@/components/ui/Alert";
import styles from "./team.module.css";

const INITIAL: TeamActionState = { status: "idle" };

export function InviteForm({ disabled }: { disabled: boolean }) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, INITIAL);

  return (
    <form action={formAction} className={styles.inviteForm}>
      {state.status === "error" && state.message && <Alert tone="danger">{state.message}</Alert>}

      {state.status === "success" && state.inviteUrl && (
        <Alert tone="success" title={state.message}>
          <p className={styles.inviteHint}>
            Envie este link para a pessoa. Ele funciona uma única vez e expira em 7 dias.
          </p>
          {/* readOnly + select-all: o token aparece uma vez só; o banco
              guarda apenas o hash e não há como exibi-lo de novo depois. */}
          <input
            className={styles.inviteLink}
            value={state.inviteUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Link do convite"
          />
        </Alert>
      )}

      <div className={styles.inviteRow}>
        <div className={styles.inviteField}>
          <label htmlFor="invite-email" className={styles.label}>
            E-mail de quem vai receber o acesso
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            disabled={disabled || pending}
            autoComplete="off"
            inputMode="email"
            className={styles.input}
            placeholder="pessoa@exemplo.com"
          />
          {state.fieldErrors?.email && <p className={styles.fieldError}>{state.fieldErrors.email}</p>}
        </div>
        <button type="submit" className={styles.primary} disabled={disabled || pending}>
          {pending ? "Enviando…" : "Convidar"}
        </button>
      </div>
    </form>
  );
}

export function RevokeInviteForm({ invitationId }: { invitationId: string }) {
  const [state, formAction, pending] = useActionState(revokeInvitationAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <button type="submit" className={styles.danger} disabled={pending}>
        {pending ? "Cancelando…" : "Cancelar"}
      </button>
      {state.status === "error" && <span className={styles.inlineError}>{state.message}</span>}
    </form>
  );
}

export function RemoveMemberForm({ userId, name }: { userId: string; name: string }) {
  const [state, formAction, pending] = useActionState(removeMemberAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" className={styles.danger} disabled={pending} aria-label={`Remover ${name}`}>
        {pending ? "Removendo…" : "Remover"}
      </button>
      {state.status === "error" && <span className={styles.inlineError}>{state.message}</span>}
    </form>
  );
}
