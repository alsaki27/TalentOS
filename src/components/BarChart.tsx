"use client";

interface BarData {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarData[];
  orientation?: "vertical" | "horizontal";
  maxValue?: number;
}

const DEFAULT_COLORS = [
  "var(--accent)",
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
];

export default function BarChart({
  data,
  orientation = "vertical",
  maxValue,
}: BarChartProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);

  if (orientation === "vertical") {
    return (
      <div className="flex items-end gap-3 h-52 px-2">
        {data.map((item, i) => {
          const pct = (item.value / max) * 100;
          const color = item.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
          return (
            <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
              <div
                className="w-full flex items-end justify-center"
                style={{ height: "100%" }}
              >
                <div
                  className="w-full rounded-t-md transition-all duration-500"
                  style={{
                    height: `${pct}%`,
                    backgroundColor: color,
                    minHeight: 4,
                  }}
                  title={`${item.label}: ${item.value}`}
                />
              </div>
              <span className="text-[11px] text-[var(--ink-soft)] font-medium truncate w-full text-center">
                {item.label}
              </span>
              <span className="text-[11px] font-semibold text-[var(--ink)]">
                {item.value}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {data.map((item, i) => {
        const pct = (item.value / max) * 100;
        const color = item.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-[var(--ink-soft)] w-28 truncate text-right">
              {item.label}
            </span>
            <div className="flex-1 h-7 bg-[var(--bg)] rounded-md overflow-hidden">
              <div
                className="h-full rounded-md flex items-center justify-end px-2 transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: color,
                  minWidth: 4,
                }}
                title={`${item.label}: ${item.value}`}
              >
                {pct > 15 && (
                  <span className="text-[11px] text-white font-semibold">
                    {item.value}
                  </span>
                )}
              </div>
            </div>
            {pct <= 15 && (
              <span className="text-[11px] font-semibold text-[var(--ink)]">
                {item.value}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
