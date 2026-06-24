// src/app/ops/CrawlerStatusLive.tsx
// Live panel for /ops: shows registered job-crawler bots' online/offline status and a
// running count of jobs received this session, updated via Server-Sent Events
// (/api/integrations/crawler/stream) instead of polling. See README.md's "Job crawler"
// section for what feeds this.
"use client";

import { useEffect, useRef, useState } from "react";

interface CrawlerStatus {
  crawler_name: string;
  is_active: boolean;
  last_heartbeat_at: string | null;
  message: string | null;
  isOnline: boolean;
}

export default function CrawlerStatusLive() {
  const [statuses, setStatuses] = useState<CrawlerStatus[]>([]);
  const [jobsReceived, setJobsReceived] = useState(0);
  const [lastJobTitle, setLastJobTitle] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/integrations/crawler/status")
      .then((res) => (res.ok ? res.json() : []))
      .then(setStatuses)
      .catch(() => setStatuses([]));

    const source = new EventSource("/api/integrations/crawler/stream");
    sourceRef.current = source;

    source.addEventListener("ready", () => setConnected(true));
    source.addEventListener("crawler_status", (e) => {
      const updated = JSON.parse((e as MessageEvent).data);
      setStatuses((prev) => {
        const others = prev.filter((s) => s.crawler_name !== updated.crawler_name);
        return [...others, updated].sort((a, b) => a.crawler_name.localeCompare(b.crawler_name));
      });
    });
    source.addEventListener("job_inserted", (e) => {
      const job = JSON.parse((e as MessageEvent).data);
      setJobsReceived((n) => n + 1);
      setLastJobTitle(job.title ?? null);
    });
    source.onerror = () => setConnected(false);

    return () => source.close();
  }, []);

  if (statuses.length === 0 && jobsReceived === 0) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <label>Job crawler</label>
        <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          No crawler has reported in yet. Push a heartbeat to <code>/api/integrations/crawler/heartbeat</code>{" "}
          (with <code>CRAWLER_API_KEY</code>) to register one — see README.md.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <label>Job crawler (live)</label>
        <span className="muted" style={{ fontSize: 11 }}>
          {connected ? "● connected" : "○ reconnecting…"}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {statuses.map((s) => (
          <span
            key={s.crawler_name}
            className="badge"
            style={s.isOnline ? undefined : { background: "#fbe9e7", color: "var(--danger)" }}
          >
            {s.crawler_name}: {s.isOnline ? "online" : "offline"}
          </span>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
        {jobsReceived} job{jobsReceived === 1 ? "" : "s"} received live this session
        {lastJobTitle ? ` — most recent: "${lastJobTitle}"` : ""}.
      </p>
    </div>
  );
}
