"use client";

interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;
  icon?: React.ReactNode;
}

export default function StatCard({ label, value, change, icon }: StatCardProps) {
  return (
    <div className="card flex items-center gap-3">
      {icon && (
        <div className="w-10 h-10 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] shrink-0">
          {icon}
        </div>
      )}
      <div>
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
        {change !== undefined && (
          <span
            className="text-xs font-semibold"
            style={{ color: change >= 0 ? "var(--accent)" : "var(--danger)" }}
          >
            {change >= 0 ? "↑" : "↓"} {Math.abs(change)}%
          </span>
        )}
      </div>
    </div>
  );
}
