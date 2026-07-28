"use client";

import { Check } from "lucide-react";

export const CHECKOUT_STEPS = ["Address", "Order Summary", "Payment"] as const;
export type CheckoutStep = 1 | 2 | 3;

export function CheckoutStepper({ current, onStepClick }: { current: CheckoutStep; onStepClick: (step: CheckoutStep) => void }) {
  return (
    <ol className="mb-6 flex items-start">
      {CHECKOUT_STEPS.map((label, index) => {
        const step = (index + 1) as CheckoutStep;
        const isComplete = step < current;
        const isCurrent = step === current;
        const clickable = isComplete;

        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick(step)}
              className="flex flex-col items-center gap-1.5 disabled:cursor-default"
            >
              <span
                className={`grid h-9 w-9 place-items-center rounded-full border-2 text-sm font-bold transition-colors ${
                  isComplete
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCurrent
                      ? "border-primary bg-white text-primary"
                      : "border-border bg-white text-muted-foreground"
                }`}
              >
                {isComplete ? <Check className="h-4 w-4" /> : step}
              </span>
              <span className={`text-xs font-semibold whitespace-nowrap sm:text-sm ${isCurrent ? "text-foreground" : "text-muted-foreground"}`}>
                {label}
              </span>
            </button>
            {step !== CHECKOUT_STEPS.length && (
              <span className={`mx-2 mt-[-1.25rem] h-0.5 flex-1 rounded-full ${isComplete ? "bg-primary" : "bg-border"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
