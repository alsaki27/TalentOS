"use client";

import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImportStepIndicatorProps {
  steps: string[];
  currentStep: number;
}

export default function ImportStepIndicator({
  steps,
  currentStep,
}: ImportStepIndicatorProps) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center min-w-[500px] px-2 py-4">
        {steps.map((step, index) => {
          const stepNum = index + 1;
          const isCompleted = currentStep > stepNum;
          const isActive = currentStep === stepNum;
          const isFuture = currentStep < stepNum;

          return (
            <React.Fragment key={step}>
              {/* Step circle */}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                    isCompleted && "bg-[var(--accent)] text-white",
                    isActive &&
                      "bg-[var(--accent)] text-white ring-2 ring-[var(--accent-soft)] ring-offset-2 ring-offset-[var(--bg)]",
                    isFuture &&
                      "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-soft)]"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    stepNum
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium whitespace-nowrap",
                    isCompleted && "text-[var(--accent)]",
                    isActive && "text-[var(--ink)]",
                    isFuture && "text-[var(--ink-soft)]"
                  )}
                >
                  {step}
                </span>
              </div>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-0.5 w-full max-w-[80px] flex-1 transition-colors",
                    isCompleted
                      ? "bg-[var(--accent)]"
                      : "bg-[var(--border)]"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
