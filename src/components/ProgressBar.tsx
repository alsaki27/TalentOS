"use client";

import { cn } from "../lib/utils";

interface ProgressBarProps {
  value: number;
  max: number;
  color?: "green" | "yellow" | "red" | "auto";
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function ProgressBar({
  value,
  max,
  color = "auto",
  className,
  showLabel = true,
  size = "md",
}: ProgressBarProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;

  const autoColor =
    pct > 100 ? "red" : pct >= 80 ? "yellow" : "green";
  const resolvedColor = color === "auto" ? autoColor : color;

  const barColorClasses = {
    green: "bg-emerald-500",
    yellow: "bg-amber-500",
    red: "bg-red-500",
  };

  const textColorClasses = {
    green: "text-emerald-600",
    yellow: "text-amber-600",
    red: "text-red-600",
  };

  const heightClass = size === "sm" ? "h-2" : "h-3";

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "w-full rounded-full border border-border bg-bg overflow-hidden",
          heightClass
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            barColorClasses[resolvedColor]
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {showLabel && (
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-ink-soft">
            {value.toLocaleString()} / {max.toLocaleString()}
          </span>
          <span
            className={cn(
              "text-xs font-semibold",
              textColorClasses[resolvedColor]
            )}
          >
            {pct}%
          </span>
        </div>
      )}
    </div>
  );
}

export default ProgressBar;
