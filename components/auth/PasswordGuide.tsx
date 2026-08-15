"use client";

import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { IconCheck } from "@/components/ui/icons";
import styles from "./PasswordGuide.module.css";

/* ============================================================
   Guia de senha

   A política é de 15 caracteres sem exigir maiúscula, número ou
   símbolo (lib/auth/password-policy.ts) — o que é, na prática, a
   recomendação moderna: comprimento vale mais que composição. Só
   que "pelo menos 15 caracteres" LIDO por quem está criando conta
   soa como a regra mais dura que a pessoa já viu, porque ela pensa
   em senha, não em frase.

   Este componente não afeta a validação: só mostra o progresso e
   ensina o caminho mais curto para chegar lá — uma frase de três
   ou quatro palavras. Nenhuma senha sai daqui; o valor é lido do
   evento do próprio campo e só o comprimento é guardado em estado.
   ============================================================ */

export function PasswordGuide({ length }: { length: number }) {
  const complete = length >= MIN_PASSWORD_LENGTH;
  const remaining = Math.max(0, MIN_PASSWORD_LENGTH - length);
  const progress = Math.min(1, length / MIN_PASSWORD_LENGTH);

  return (
    <span className={styles.guide}>
      <span className={styles.meter} data-complete={complete || undefined} aria-hidden="true">
        <span className={styles.meterFill} style={{ transform: `scaleX(${progress})` }} />
      </span>

      <span className={styles.status} data-complete={complete || undefined} role="status">
        {complete ? (
          <>
            <IconCheck />
            Boa — essa senha já pode ser usada.
          </>
        ) : length === 0 ? (
          <>Use uma frase de {MIN_PASSWORD_LENGTH} caracteres ou mais.</>
        ) : (
          <>
            Faltam {remaining} {remaining === 1 ? "caractere" : "caracteres"}.
          </>
        )}
      </span>

      <span className={styles.tip}>
        Junte três ou quatro palavras que só você lembra — <span className={styles.example}>pão da dona rita 92</span>.
        É mais fácil de guardar e mais difícil de adivinhar do que uma senha curta cheia de símbolos. Espaços e
        acentos são aceitos, e não é obrigatório usar maiúsculas, números ou símbolos.
      </span>
    </span>
  );
}
