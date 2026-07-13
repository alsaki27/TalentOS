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

export function LiveFeedBoard({ runId, onComplete }: { runId: string, onComplete: () => void }) {
  const [items, setItems] = useState<LiveItem[]>([]);
  const [status, setStatus] = useState<string>("running");

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/job-agent/runs/${runId}/live`);
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        
        setItems(data.items || []);
        setStatus(data.status);

        if (data.status !== "running" && data.status !== "pending") {
          setTimeout(onComplete, 2000); // Give the user 2s to see completion
        }
      } catch (err) {
        console.error(err);
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(interval); };
  }, [runId, onComplete]);

  return (
    <div style={{ marginTop: 24, padding: 24, background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}>
      {/* Header & Progress */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--accent)", textShadow: "0 0 10px var(--accent)" }}>Live Scraping Feed</span>
            {status === "running" && <Loader2 size={16} className="animate-spin" color="var(--accent)" />}
          </h2>
          <p className="muted" style={{ margin: "4px 0 0 0", fontSize: 13 }}>Streaming newly discovered jobs in real-time...</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--foreground)" }}>{items.length}</div>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Jobs Found</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ width: "100%", height: 4, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 24, position: "relative" }}>
        <div style={{ 
          position: "absolute", left: 0, top: 0, bottom: 0, 
          width: status === "running" ? "60%" : "100%", 
          background: "linear-gradient(90deg, transparent, var(--accent))",
          animation: status === "running" ? "pulse-slide 2s infinite linear" : "none",
          transition: "width 1s ease-in-out"
        }} />
      </div>

      {/* Masonry Grid */}
      {items.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>
          <Loader2 size={32} className="animate-spin muted" style={{ margin: "0 auto 16px auto" }} />
          <p className="muted">Waking up scraping cluster and initializing browser fingerprint...</p>
        </div>
      ) : (
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", 
          gap: 16,
          maxHeight: 500,
          overflowY: "auto",
          paddingRight: 8
        }}>
          {items.map((item, i) => (
            <div key={i} style={{ 
              padding: 16, 
              background: "rgba(255,255,255,0.03)", 
              border: "1px solid rgba(255,255,255,0.05)", 
              borderRadius: 8,
              animation: "fade-in-up 0.4s ease-out backwards",
              animationDelay: `${Math.min(i * 0.05, 1)}s`
            }}>
              <h3 style={{ fontSize: 14, margin: "0 0 4px 0", color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.title}>
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

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulse-slide {
          0% { transform: translateX(-100%); opacity: 0.5; }
          50% { opacity: 1; }
          100% { transform: translateX(200%); opacity: 0.5; }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
}
