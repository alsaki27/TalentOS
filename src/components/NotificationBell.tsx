"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Check, Info, AlertTriangle, AlertCircle, AtSign, X } from "lucide-react";

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

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  async function loadNotifications() {
    try {
      const res = await fetch("/api/notifications?page=1&pageSize=10&unread=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list: Notification[] = data.notifications ?? [];
      setNotifications(list);
      setUnreadCount(data.total ?? 0);
    } catch {
      // ignore polling errors
    }
  }

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
  }, [open]);

  async function markAllRead() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications/mark-all-read", {
        method: "POST",
        cache: "no-store",
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
        setUnreadCount(0);
      }
    } finally {
      setLoading(false);
    }
  }

  async function dismissOne(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        cache: "no-store",
      });
      if (res.ok) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        setUnreadCount((c) => Math.max(0, c - 1));
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
    <div className="relative" ref={panelRef}>
      <button
        className="relative p-1.5 rounded-md hover:bg-bg transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="w-4 h-4 text-ink-soft" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-9 right-0 w-[360px] max-w-[90vw] bg-surface border border-border rounded-lg shadow-xl z-50 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  className="text-xs font-medium text-accent hover:underline"
                  onClick={markAllRead}
                  disabled={loading}
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-ink-soft">
                No unread notifications
              </div>
            ) : (
              notifications.map((n) => (
                <Link
                  key={n.id}
                  href={linkFor(n)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-bg transition-colors border-b border-border last:border-b-0"
                  onClick={() => setOpen(false)}
                >
                  <div className="mt-0.5 shrink-0">{typeIcons[n.type] || typeIcons.info}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{n.title}</p>
                    {n.body && <p className="text-xs text-ink-soft mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[11px] text-ink-soft mt-1">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    className="mt-0.5 p-1 rounded hover:bg-border text-ink-soft"
                    onClick={(e) => dismissOne(n.id, e)}
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Link>
              ))
            )}
          </div>

          <div className="px-4 py-2 border-t border-border text-center">
            <Link
              href="/notifications"
              className="text-xs font-medium text-accent hover:underline"
              onClick={() => setOpen(false)}
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
