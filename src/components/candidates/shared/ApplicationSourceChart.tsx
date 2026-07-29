"use client";

import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip } from "chart.js";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

var SOURCE_COLORS: Record<string, string> = {
  linkedin: "#0a66c2", indeed: "#2164f3", hiringcafe: "#8b5cf6",
  glassdoor: "#0caa41", simplyhired: "#f59e0b", company_site: "#06b6d4",
  extension: "#10b981", openjobdata: "#ec4899",
};

var FALLBACK_COLORS = ["#6366f1", "#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#f97316"];

interface SourceCount {
  label: string;
  count: number;
}

interface ApplicationSourceChartProps {
  data: SourceCount[];
  onBarClick?: (source: string) => void;
  activeSource?: string;
}

export default function ApplicationSourceChart({ data, onBarClick, activeSource }: ApplicationSourceChartProps) {
  var total = data.reduce(function (s, d) { return s + d.count; }, 0);
  if (total === 0) {
    return (
      <div style={{ color: "var(--ink-soft)", fontSize: 13, padding: "60px 0", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.3 }}>📡</div>
        No source data yet
      </div>
    );
  }

  var labels = data.map(function (d) { return d.label; });
  var values = data.map(function (d) { return d.count; });
  var colors = data.map(function (d, i) { return SOURCE_COLORS[d.label.toLowerCase()] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]; });
  var borderColors = data.map(function (d) {
    var color = SOURCE_COLORS[d.label.toLowerCase()] ?? FALLBACK_COLORS[data.indexOf(d) % FALLBACK_COLORS.length];
    return color;
  });

  var chartData = {
    labels: labels,
    datasets: [{
      data: values,
      backgroundColor: colors.map(function (c) { return c + "CC"; }),
      borderColor: borderColors,
      borderWidth: 1,
      borderRadius: 8,
      borderSkipped: false,
      maxBarThickness: 48,
    }],
  };

  return (
    <div style={{ width: "100%", height: 240 }}>
      <Bar
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              titleColor: "#f1f5f9",
              bodyColor: "#94a3b8",
              borderColor: "rgba(99, 102, 241, 0.3)",
              borderWidth: 1,
              cornerRadius: 8,
              padding: 12,
              titleFont: { size: 12, weight: "bold" },
              bodyFont: { size: 12 },
              callbacks: {
                label: function (ctx) {
                  var val = ctx.parsed.y ?? 0;
                  return " " + val + " applications" + (total > 0 ? " (" + Math.round((val / total) * 100) + "%)" : "");
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#64748b", font: { size: 10, weight: "bold" as const }, padding: 8 },
              border: { display: false },
            },
            y: {
              grid: { color: "rgba(255, 255, 255, 0.04)" },
              ticks: { color: "#64748b", font: { size: 10 }, stepSize: 1, padding: 8 },
              border: { display: false },
              beginAtZero: true,
            },
          },
          onClick: onBarClick ? function (_event, elements) {
            if (elements.length > 0) {
              var idx = elements[0].index;
              onBarClick(labels[idx]);
            }
          } : undefined,
          onHover: onBarClick ? function (_event, elements) {
            if (_event.native && _event.native.target) {
              (_event.native.target as HTMLElement).style.cursor = elements.length > 0 ? "pointer" : "default";
            }
          } : undefined,
        }}
      />
    </div>
  );
}
