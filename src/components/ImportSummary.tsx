"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ImportSummaryProps {
  total: number;
  newRows: number;
  duplicates: number;
  errors: number;
}

export default function ImportSummary({
  total,
  newRows,
  duplicates,
  errors,
}: ImportSummaryProps) {
  const safeTotal = Math.max(total, 1);
  const newPct = Math.round((newRows / safeTotal) * 100);
  const dupPct = Math.round((duplicates / safeTotal) * 100);
  const errPct = Math.round((errors / safeTotal) * 100);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-[var(--ink)]">{total}</p>
          <p className="text-xs font-medium text-[var(--ink-soft)] uppercase tracking-wide">
            Total rows
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-[var(--accent)]">{newRows}</p>
          <p className="text-xs font-medium text-[var(--ink-soft)] uppercase tracking-wide">
            New rows
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-[var(--warn)]">{duplicates}</p>
          <p className="text-xs font-medium text-[var(--ink-soft)] uppercase tracking-wide">
            Duplicates
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-[var(--danger)]">{errors}</p>
          <p className="text-xs font-medium text-[var(--ink-soft)] uppercase tracking-wide">
            Errors
          </p>
        </div>
      </div>

      <div className="h-3 w-full rounded-full overflow-hidden flex">
        {newRows > 0 && (
          <div
            className="h-full bg-[var(--accent)] transition-all"
            style={{ width: `${newPct}%` }}
            title={`New: ${newRows}`}
          />
        )}
        {duplicates > 0 && (
          <div
            className="h-full bg-[var(--warn)] transition-all"
            style={{ width: `${dupPct}%` }}
            title={`Duplicates: ${duplicates}`}
          />
        )}
        {errors > 0 && (
          <div
            className="h-full bg-[var(--danger)] transition-all"
            style={{ width: `${errPct}%` }}
            title={`Errors: ${errors}`}
          />
        )}
        {total === 0 && (
          <div className="h-full w-full bg-[var(--border)]" />
        )}
      </div>

      <div className="flex items-center justify-center gap-4 mt-3 text-xs">
        {newRows > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
            New {newPct}%
          </span>
        )}
        {duplicates > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--warn)]" />
            Duplicates {dupPct}%
          </span>
        )}
        {errors > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
            Errors {errPct}%
          </span>
        )}
      </div>
    </div>
  );
}
