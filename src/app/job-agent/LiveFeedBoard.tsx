"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface LiveItem {
  title: string;
  company: string;
  location: string;
  salary: string;
  date: string;
}

export function LiveFeedBoard({ runId, onComplete }: { runId: string; onComplete: () => void }) {
  const [items, setItems] = useState<LiveItem[]>([]);
  const [status, setStatus] = useState<string>("running");
  const [error, setError] = useState<string>("");
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  useEffect(() => {
    let mounted = true;
    let processingTriggered = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/job-agent/runs/${runId}/live`);
        if (!res.ok) {
          if (res.status === 404 || res.status === 500) {
            return;
          }
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }

        const data = await res.json();
        if (!mounted) return;

        setItems(data.items || []);
        setStatus(data.status ?? "running");
        setError(data.error || "");
        setLastUpdate(Date.now());

        if (data.status === "processing") {
          // Leave the spinner on; processing is in flight.
          return;
        }

        // When the run settles (succeeded, failed, partial), auto-dismiss
        // after giving the user a moment to see the final counts.
        if (
          data.status === "succeeded" ||
          data.status === "failed" ||
          data.status === "partial"
        ) {
          if (!processingTriggered) {
            processingTriggered = true;
            setTimeout(onComplete, 3000);
          }
        }
      } catch (err: any) {
        console.error("[LiveFeed] poll error:", err.message);
        if (mounted) setError(err.message);
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [runId, onComplete]);

  const isActive = status === "running" || status === "pending" || status === "processing";

  function statusLabel() {
    switch (status) {
      case "pending":   return "Initializing Apify run…";
      case "running":   return "Scraping job listings…";
      case "processing":return "Processing & classifying results…";
      case "succeeded": return "Completed";
      case "failed":    return "Failed";
      case "partial":   return "Completed (partial)";
      default:          return status;
    }
  }

  return (
    <div
      style={{
        marginTop: 24,
        padding: 24,
        background: "var(--surface)",
        borderRadius: 12,
        border: "1px solid var(--border)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      }}
    >
      {/* Header & Progress */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--accent)", textShadow: "0 0 10px var(--accent)" }}>
              Live Scraping Feed
            </span>
            {isActive && <Loader2 size={16} className="animate-spin" color="var(--accent)" />}
          </h2>
          <p className="muted" style={{ margin: "4px 0 0 0", fontSize: 13 }}>
            {statusLabel()}
          </p>
          {error && (
            <p className="form-error" style={{ margin: "4px 0 0 0", fontSize: 12 }}>
              {error}
            </p>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--foreground)" }}>{items.length}</div>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
            Jobs Found
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ width: "100%", height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 24, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: isActive ? "60%" : "100%",
            background:
              status === "failed"
                ? "var(--danger)"
                : "linear-gradient(90deg, transparent, var(--accent))",
            animation: isActive ? "pulse-slide 2s infinite linear" : "none",
            transition: "width 1s ease-in-out",
          }}
        />
      </div>

      {/* Datetime of last data refresh */}
      <div className="muted" style={{ fontSize: 11, marginBottom: 12, textAlign: "right" }}>
        Last updated: {new Date(lastUpdate).toLocaleTimeString()}
      </div>

      {/* Masonry Grid */}
      {items.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>
          <Loader2 size={32} className="animate-spin muted" style={{ margin: "0 auto 16px auto" }} />
          <p className="muted">
            {status === "pending"
              ? "Connecting to Apify and initializing browser fingerprint…"
              : status === "processing"
              ? "Downloading and classifying job data…"
              : "Waking up scraping cluster and initializing browser fingerprint…"}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
            maxHeight: 500,
            overflowY: "auto",
            paddingRight: 8,
          }}
        >
          {items.map((item, i) => (
            <div
              key={`${item.title}-${i}`}
              style={{
                padding: 16,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 8,
                animation: "fade-in-up 0.4s ease-out backwards",
                animationDelay: `${Math.min(i * 0.05, 1)}s`,
              }}
            >
              <h3
                style={{
                  fontSize: 14,
                  margin: "0 0 4px 0",
                  color: "var(--foreground)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={item.title}
              >
                {item.title}
              </h3>
              <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 8, fontWeight: 500 }}>
                {item.company}
              </div>
              <div className="muted" style={{ fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span>📍 {item.location}</span>
                {item.salary && <span>💰 {item.salary}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes pulse-slide {
          0% { transform: translateX(-100%); opacity: 0.5; }
          50% { opacity: 1; }
          100% { transform: translateX(200%); opacity: 0.5; }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `,
        }}
      />
    </div>
  );
}
