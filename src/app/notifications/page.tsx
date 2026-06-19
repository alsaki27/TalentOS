"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Check,
  Info,
  AlertTriangle,
  AlertCircle,
  AtSign,
  X,
  Filter,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from "lucide-react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

const typeIcons: Record<string, React.ReactNode> = {
  info: <Info className="w-4 h-4 text-ink-soft" />,
  success: <Check className="w-4 h-4 text-accent" />,
  warning: <AlertTriangle className="w-4 h-4 text-warn" />,
  error: <AlertCircle className="w-4 h-4 text-danger" />,
  mention: <AtSign className="w-4 h-4 text-accent" />,
};

const typeBadge: Record<string, string> = {
  info: "badge",
  success: "badge badge-interview",
  warning: "badge badge-in_progress",
  error: "badge badge-rejected",
  mention: "badge badge-offer",
};

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread" | "mention" | "system">("all");

  async function load(pageNum: number) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        pageSize: String(PAGE_SIZE),
      });
      if (filter === "unread") params.set("unread", "1");
      if (filter === "mention") params.set("type", "mention");
      if (filter === "system") params.set("type", "info");
      const res = await fetch(`/api/notifications?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setTotal(data.total ?? 0);
      setPage(pageNum);
    } catch {
      setNotifications([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1);
  }, [filter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function markRead(id: string) {
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        cache: "no-store",
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
        );
      }
    } catch {
      // ignore
    }
  }

  async function markAllRead() {
    try {
      const res = await fetch("/api/notifications/mark-all-read", {
        method: "POST",
        cache: "no-store",
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
      }
    } catch {
      // ignore
    }
  }

  async function dismiss(id: string) {
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        cache: "no-store",
      });
      if (res.ok) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        setTotal((t) => Math.max(0, t - 1));
      }
    } catch {
      // ignore
    }
  }

  function linkFor(n: Notification): string {
    if (n.link) return n.link;
    if (n.entity_type === "candidate" && n.entity_id) return `/candidates/${n.entity_id}`;
    if (n.entity_type === "job" && n.entity_id) return `/jobs/${n.entity_id}`;
    if (n.entity_type === "application" && n.entity_id) return `/application-queue`;
    return "#";
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p className="page-kicker">All your notifications in one place</p>
        </div>
        <div className="action-group">
          <button className="btn flex items-center gap-2" onClick={markAllRead}>
            <Check className="w-4 h-4" />
            Mark all as read
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-ink-soft" />
          {(["all", "unread", "mention", "system"] as const).map((f) => (
            <button
              key={f}
              className={`btn btn-compact ${filter === f ? "btn-primary" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="muted text-xs">{total} total</span>
      </div>

      {loading ? (
        <div className="loading-panel">Loading notifications...</div>
      ) : notifications.length === 0 ? (
        <div className="empty">
          <Bell className="w-8 h-8 text-ink-soft mx-auto mb-3" />
          <p>No notifications</p>
          <p className="text-xs mt-1">You&apos;re all caught up</p>
        </div>
      ) : (
        <div className="card space-y-0">
          {notifications.map((n, i) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 py-3 px-4 ${
                i !== notifications.length - 1 ? "border-b border-border" : ""
              } ${!n.read_at ? "bg-accent-soft/20" : ""}`}
            >
              <div className="mt-0.5 shrink-0">{typeIcons[n.type] || typeIcons.info}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={typeBadge[n.type] || typeBadge.info}>{n.type}</span>
                  {!n.read_at && <span className="badge badge-priority-urgent">New</span>}
                </div>
                <p className="text-sm font-medium text-ink mt-1">
                  {n.entity_id ? (
                    <Link href={linkFor(n)} className="row-link">
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                </p>
                {n.body && <p className="text-sm text-ink-soft mt-1">{n.body}</p>}
                <p className="text-[11px] text-ink-soft mt-1">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!n.read_at && (
                  <button
                    className="btn btn-compact"
                    onClick={() => markRead(n.id)}
                    title="Mark as read"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  className="btn btn-compact btn-danger"
                  onClick={() => dismiss(n.id)}
                  title="Dismiss"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination-bar">
          <button
            className="btn btn-compact"
            onClick={() => load(page - 1)}
            disabled={loading || page <= 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-ink-soft">
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-compact"
            onClick={() => load(page + 1)}
            disabled={loading || page >= totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
