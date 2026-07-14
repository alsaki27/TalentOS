"use client";

interface ApplicationsPerDayChartProps {
  data: { d: string; count: number }[];
}

export default function ApplicationsPerDayChart({ data }: ApplicationsPerDayChartProps) {
  if (!data || data.length === 0) return null;

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const chartWidth = 300;
  const chartHeight = 120;
  const barWidth = Math.max(3, (chartWidth - data.length * 4) / data.length);
  const gapX = 4;

  const bars = data.map((point, i) => {
    const barHeight = point.count > 0 ? Math.max(2, (point.count / maxCount) * (chartHeight - 20)) : 0;
    const x = i * (barWidth + gapX) + 20;
    const y = chartHeight - barHeight - 5;

    return (
      <g key={i}>
        <rect
          x={x}
          y={y}
          width={barWidth}
          height={barHeight}
          rx={1}
          fill="var(--primary)"
        />
        {point.count > 0 && (
          <text
            x={x + barWidth / 2}
            y={y - 3}
            textAnchor="middle"
            fontSize={9}
            fill="var(--muted)"
          >
            {point.count}
          </text>
        )}
      </g>
    );
  });

  const totalHeight = chartHeight + 5;

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${chartWidth + 20} ${totalHeight}`}
        width="100%"
        height={totalHeight}
        role="img"
      >
        {bars}
        <line
          x1={20}
          y1={chartHeight - 5}
          x2={chartWidth + 10}
          y2={chartHeight - 5}
          stroke="var(--border)"
          strokeWidth={0.5}
        />
      </svg>
    </div>
  );
}
