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
  return (
    <div className={styles.shell}>
      <Link href="/" className={styles.logoLink}>
        <Logo size="md" />
      </Link>

      <div className={styles.layout}>
        <ol className={styles.stepper}>
          {steps.map((step, index) => (
            <li key={step.label} className={styles.step} data-active={step.active || undefined} data-done={step.done || undefined}>
              <span className={styles.stepIndicator}>{step.done ? <IconCheck /> : index + 1}</span>
              {step.label}
            </li>
          ))}
        </ol>

        <div className={styles.card}>{children}</div>
      </div>
    </div>
  );
}
