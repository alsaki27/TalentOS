"use client";

import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

var CHART_COLORS = ["#10b981", "#06b6d4", "#a855f7", "#3b82f6", "#f43f5e", "#64748b"];

interface StatusCount {
  label: string;
  count: number;
}

interface ApplicationStatusChartProps {
  data: StatusCount[];
  onSliceClick?: (label: string) => void;
  activeLabel?: string;
}

export default function ApplicationStatusChart({ data, onSliceClick, activeLabel }: ApplicationStatusChartProps) {
  var total = data.reduce(function (s, d) { return s + d.count; }, 0);
  if (total === 0) {
    return (
      <div style={{ color: "var(--ink-soft)", fontSize: 13, padding: "60px 0", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.3 }}>📊</div>
        No application data yet
      </div>
    );
  }

  var labels = data.map(function (d) { return d.label; });
  var values = data.map(function (d) { return d.count; });
  var colors = CHART_COLORS.slice(0, labels.length);

  var chartData = {
    labels: labels,
    datasets: [{
      data: values,
      backgroundColor: colors.map(function (c) { return c + "DD"; }),
      borderColor: "rgba(15, 23, 42, 0.85)",
      borderWidth: 3,
      hoverBorderColor: "rgba(255, 255, 255, 0.4)",
      hoverBorderWidth: 3,
      borderRadius: 4,
      spacing: 3,
    }],
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{ width: "100%", maxWidth: 260, height: 220, position: "relative" }}>
        <Doughnut
          data={chartData}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: "62%",
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
                    var label = ctx.label || "";
                    var val = ctx.parsed;
                    var pct = total > 0 ? Math.round((val / total) * 100) : 0;
                    return " " + label + ": " + val + " jobs (" + pct + "%)";
                  },
                },
              },
            },
            onClick: onSliceClick ? function (_event, elements, chart) {
              if (elements.length > 0) {
                var idx = elements[0].index;
                var label = chart.data.labels ? String(chart.data.labels[idx]) : "";
                onSliceClick(label);
              }
            } : undefined,
            onHover: onSliceClick ? function (_event, elements) {
              if (_event.native && _event.native.target) {
                (_event.native.target as HTMLElement).style.cursor = elements.length > 0 ? "pointer" : "default";
              }
            } : undefined,
          }}
        />
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center", pointerEvents: "none",
        }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#f1f5f9", lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>Total</div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", justifyContent: "center" }}>
        {data.map(function (item, i) {
          var color = colors[i];
          var pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
          var isActive = activeLabel === item.label;
          return (
            <div
              key={item.label}
              onClick={onSliceClick ? function () { onSliceClick(item.label); } : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                cursor: onSliceClick ? "pointer" : "default",
                padding: "4px 10px", borderRadius: 8,
                background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
                border: isActive ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                transition: "all 0.15s ease",
              }}
              title={item.label + ": " + item.count + " (" + pct + "%) — Click to filter"}
            >
              <span style={{
                width: 10, height: 10, borderRadius: 3,
                backgroundColor: color, display: "inline-block", flexShrink: 0,
                boxShadow: "0 0 6px " + color + "55",
              }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? "#f1f5f9" : "#94a3b8" }}>
                {item.label}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: color, fontFamily: "var(--font-mono, monospace)" }}>
                {item.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
