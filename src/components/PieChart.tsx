"use client";

interface PieData {
  label: string;
  value: number;
  color?: string;
}

interface PieChartProps {
  data: PieData[];
}

const DEFAULT_COLORS = [
  "var(--accent)",
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

export default function PieChart({ data }: PieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return <div className="empty text-sm py-8">No data</div>;
  }

  let accumulated = 0;
  const slices = data.map((item, i) => {
    const percentage = item.value / total;
    const start = accumulated;
    accumulated += percentage;
    return {
      ...item,
      start,
      end: accumulated,
      pct: Math.round(percentage * 1000) / 10,
      color: item.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    };
  });

  const conicGradient = slices
    .map((s) => `${s.color} ${s.start * 100}% ${s.end * 100}%`)
    .join(", ");

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="w-36 h-36 rounded-full relative"
        style={{ background: `conic-gradient(${conicGradient})` }}
      >
        <div className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-[var(--surface)]" />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-xs text-[var(--ink-soft)]">
              {s.label}{" "}
              <span className="font-semibold text-[var(--ink)]">{s.pct}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
