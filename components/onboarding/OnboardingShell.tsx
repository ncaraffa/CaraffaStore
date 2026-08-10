import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { IconCheck } from "@/components/ui/icons";
import styles from "./OnboardingShell.module.css";

export interface OnboardingStepInfo {
  label: string;
  done: boolean;
  active: boolean;
}

export function OnboardingShell({ steps, children }: { steps: OnboardingStepInfo[]; children: ReactNode }) {
  const activeIndex = steps.findIndex((step) => step.active);
  const doneCount = steps.filter((step) => step.done).length;
  // Metade de crédito pelo passo atual: a linha de nível se move ao
  // entrar num passo, não só ao completá-lo — é isso que faz o
  // progresso parecer contínuo em vez de saltar em degraus.
  const fillRatio = steps.length === 0 ? 0 : Math.min(1, (doneCount + 0.5) / steps.length);

  return (
    <div className={styles.shell}>
      <Link href="/" className={styles.logoLink}>
        <Logo size="md" compact />
      </Link>

      <div className={styles.layout}>
        {steps.length > 0 && (
          <div className={styles.progress}>
            <div className={styles.track}>
              <div className={styles.fill} style={{ width: `${fillRatio * 100}%` }} />
            </div>
            <ol className={styles.stepper}>
              {steps.map((step, index) => (
                <li
                  key={step.label}
                  className={styles.step}
                  data-active={step.active || undefined}
                  data-done={step.done || undefined}
                >
                  <span className={styles.stepDot}>{step.done ? <IconCheck /> : index + 1}</span>
                  <span className={styles.stepLabel}>{step.label}</span>
                </li>
              ))}
            </ol>
            <p className={styles.progressCaption}>
              Etapa {Math.min(activeIndex + 1, steps.length) || steps.length} de {steps.length}
            </p>
          </div>
        )}

        <div className={styles.card}>{children}</div>
      </div>
    </div>
  );
}
