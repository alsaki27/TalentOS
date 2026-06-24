"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User, Settings, FilePlus, Pencil, Trash2, Import, Upload, Loader2 } from "lucide-react";

interface ActivityLog {
  id: string;
  actor_name: string | null;
  actor_type: string;
  type: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  created_at: string;
}

const typeIcons: Record<string, React.ReactNode> = {
  create: <FilePlus className="w-3.5 h-3.5" />,
  update: <Pencil className="w-3.5 h-3.5" />,
  delete: <Trash2 className="w-3.5 h-3.5" />,
  import: <Import className="w-3.5 h-3.5" />,
  login: <User className="w-3.5 h-3.5" />,
};

function linkFor(log: ActivityLog): string {
  if (log.entity_type === "candidate" && log.entity_id) return `/candidates/${log.entity_id}`;
  if (log.entity_type === "job" && log.entity_id) return `/jobs/${log.entity_id}`;
  if (log.entity_type === "application" && log.entity_id) return `/application-queue`;
  return "#";
}

function groupByDate(logs: ActivityLog[]) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups: { label: string; logs: ActivityLog[] }[] = [];
  const todayLogs: ActivityLog[] = [];
  const yesterdayLogs: ActivityLog[] = [];
  const earlierLogs: ActivityLog[] = [];
  for (const log of logs) {
    const d = new Date(log.created_at).toDateString();
    if (d === today) todayLogs.push(log);
    else if (d === yesterday) yesterdayLogs.push(log);
    else earlierLogs.push(log);
  }
  if (todayLogs.length) groups.push({ label: "Today", logs: todayLogs });
  if (yesterdayLogs.length) groups.push({ label: "Yesterday", logs: yesterdayLogs });
  if (earlierLogs.length) groups.push({ label: "Earlier", logs: earlierLogs });
  return groups;
}

export default function ActivityFeed() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/activity?page=1&pageSize=10", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setLogs(data.logs ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const groups = groupByDate(logs);

  if (loading) {
    return (
      <div className="card flex items-center justify-center gap-2 py-6 text-ink-soft text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading activity...
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="card py-6 text-center text-sm text-ink-soft">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          <h4 className="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2 px-1">
            {group.label}
          </h4>
          <div className="card space-y-0">
            {group.logs.map((log, i) => (
              <div
                key={log.id}
                className={`flex items-start gap-3 py-2.5 ${
                  i !== group.logs.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="mt-0.5 p-1 rounded bg-bg text-ink-soft">
                  {typeIcons[log.type] || <Settings className="w-3.5 h-3.5" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    {log.entity_id ? (
                      <Link href={linkFor(log)} className="row-link">
                        {log.description}
                      </Link>
                    ) : (
                      log.description
                    )}
                  </p>
                  <p className="text-[11px] text-ink-soft mt-0.5">
                    {log.actor_name || log.actor_type} · {new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
