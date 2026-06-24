"use client";

import { useEffect, useState } from "react";
import {
  Webhook,
  Plus,
  Pencil,
  Trash2,
  Play,
  Send,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
} from "lucide-react";

interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  secret: string | null;
  events: string[];
  status: string;
  last_delivered_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  created_at: string;
}

interface WebhookEvent {
  id: string;
  event_type: string;
  response_status: number | null;
  attempt_count: number;
  max_attempts: number;
  delivered_at: string | null;
  failed_at: string | null;
  error_message: string | null;
  created_at: string;
}

const ALL_EVENTS = [
  "application.created",
  "application.updated",
  "application.deleted",
  "candidate.created",
  "candidate.updated",
  "candidate.deleted",
  "job.created",
  "job.updated",
  "job.deleted",
  "webhook.test",
];

const PAGE_SIZE = 20;

export default function WebhooksSettingsPage() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [saving, setSaving] = useState(false);
  const [eventsOpen, setEventsOpen] = useState<string | null>(null);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [testLoading, setTestLoading] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formSecret, setFormSecret] = useState("");
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [formStatus, setFormStatus] = useState("active");

  async function load(pageNum: number) {
    setLoading(true);
    setForbidden(false);
    try {
      const res = await fetch(`/api/webhooks?page=${pageNum}&pageSize=${PAGE_SIZE}`, {
        cache: "no-store",
      });
      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setWebhooks(data.webhooks ?? []);
      setTotal(data.total ?? 0);
      setPage(pageNum);
    } catch {
      setWebhooks([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function openModal(endpoint?: WebhookEndpoint) {
    if (endpoint) {
      setEditing(endpoint);
      setFormName(endpoint.name);
      setFormUrl(endpoint.url);
      setFormSecret(endpoint.secret ?? "");
      setFormEvents(endpoint.events ?? []);
      setFormStatus(endpoint.status);
    } else {
      setEditing(null);
      setFormName("");
      setFormUrl("");
      setFormSecret("");
      setFormEvents([]);
      setFormStatus("active");
    }
    setModalOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        name: formName,
        url: formUrl,
        secret: formSecret || null,
        events: formEvents,
        status: formStatus,
      };

      if (editing) {
        const res = await fetch(`/api/webhooks/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Update failed");
      } else {
        const res = await fetch("/api/webhooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Create failed");
      }
      setModalOpen(false);
      load(page);
    } catch (err: any) {
      alert(err.message || "Failed to save webhook");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this webhook endpoint?")) return;
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      load(page);
    } catch (err: any) {
      alert(err.message || "Failed to delete webhook");
    }
  }

  async function testWebhook(id: string) {
    setTestLoading(id);
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert(`Test delivered successfully (HTTP ${data.status})`);
      } else {
        alert(`Test failed: ${data.error || "Unknown error"}`);
      }
      load(page);
    } catch (err: any) {
      alert(err.message || "Test failed");
    } finally {
      setTestLoading(null);
    }
  }

  async function viewEvents(id: string) {
    setEventsOpen(id);
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/webhooks/${id}/events`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load events");
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }

  function toggleEvent(ev: string) {
    setFormEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  }

  if (forbidden) {
    return <div className="empty">Admins and managers only.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Webhooks</h1>
          <p className="page-kicker">Manage webhook endpoints for event notifications</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => openModal()}>
          <Plus className="w-4 h-4" />
          Add Webhook
        </button>
      </div>

      {loading ? (
        <div className="loading-panel">Loading webhooks...</div>
      ) : webhooks.length === 0 ? (
        <div className="empty">
          <Webhook className="w-8 h-8 text-ink-soft mx-auto mb-3" />
          <p>No webhooks configured</p>
          <p className="text-xs mt-1">Add a webhook to receive event notifications</p>
        </div>
      ) : (
        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Events</th>
                <th>Status</th>
                <th>Last Delivered</th>
                <th>Last Failed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((wh) => (
                <tr key={wh.id}>
                  <td className="font-medium">{wh.name}</td>
                  <td className="max-w-[200px] truncate text-ink-soft">{wh.url}</td>
                  <td>
                    {wh.events.length === 0 ? (
                      <span className="badge">All events</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {wh.events.map((e) => (
                          <span key={e} className="badge badge-applied">
                            {e}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        wh.status === "active"
                          ? "badge-interview"
                          : wh.status === "paused"
                          ? "badge-waiting"
                          : "badge-rejected"
                      }`}
                    >
                      {wh.status}
                    </span>
                  </td>
                  <td className="text-ink-soft text-xs">
                    {wh.last_delivered_at
                      ? new Date(wh.last_delivered_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="text-ink-soft text-xs">
                    {wh.last_failure_at ? (
                      <span className="text-danger">
                        {new Date(wh.last_failure_at).toLocaleString()}
                        {wh.failure_count > 0 && ` (${wh.failure_count} failures)`}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <div className="action-group">
                      <button
                        className="btn btn-compact"
                        onClick={() => testWebhook(wh.id)}
                        disabled={testLoading === wh.id}
                        title="Test"
                      >
                        {testLoading === wh.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        className="btn btn-compact"
                        onClick={() => viewEvents(wh.id)}
                        title="View Events"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="btn btn-compact"
                        onClick={() => openModal(wh)}
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="btn btn-compact btn-danger"
                        onClick={() => remove(wh.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "Edit Webhook" : "Add Webhook"}</h2>
            <div className="space-y-4 mt-4">
              <div className="field-group">
                <label>Name</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="My webhook"
                />
              </div>
              <div className="field-group">
                <label>URL</label>
                <input
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://example.com/webhook"
                />
              </div>
              <div className="field-group">
                <label>Secret (optional)</label>
                <input
                  value={formSecret}
                  onChange={(e) => setFormSecret(e.target.value)}
                  placeholder="Used for HMAC signature"
                  type="password"
                />
              </div>
              <div className="field-group">
                <label>Events</label>
                <div className="grid grid-cols-2 gap-2 max-h-[180px] overflow-y-auto p-2 border border-border rounded-md bg-bg">
                  {ALL_EVENTS.map((ev) => (
                    <label key={ev} className="checkbox-row text-xs">
                      <input
                        type="checkbox"
                        checked={formEvents.includes(ev)}
                        onChange={() => toggleEvent(ev)}
                      />
                      {ev}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-ink-soft mt-1">
                  Leave empty to subscribe to all events
                </p>
              </div>
              <div className="field-group">
                <label>Status</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={saving || !formName || !formUrl}>
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : editing ? (
                  <>
                    <Check className="w-4 h-4" /> Save
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" /> Create
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {eventsOpen && (
        <div className="modal-overlay" onClick={() => setEventsOpen(null)}>
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2>Delivery Events</h2>
              <button className="p-1 rounded hover:bg-bg" onClick={() => setEventsOpen(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            {eventsLoading ? (
              <div className="py-6 text-center text-sm text-ink-soft">Loading...</div>
            ) : events.length === 0 ? (
              <div className="py-6 text-center text-sm text-ink-soft">No events recorded</div>
            ) : (
              <div className="table-shell mt-4" style={{ maxHeight: 360, overflow: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Time</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id}>
                        <td className="text-xs">{ev.event_type}</td>
                        <td>
                          {ev.delivered_at ? (
                            <span className="badge badge-interview">{ev.response_status}</span>
                          ) : (
                            <span className="badge badge-rejected">Failed</span>
                          )}
                        </td>
                        <td className="text-xs">
                          {ev.attempt_count}/{ev.max_attempts}
                        </td>
                        <td className="text-xs text-ink-soft">
                          {new Date(ev.created_at).toLocaleString()}
                        </td>
                        <td className="text-xs text-danger max-w-[140px] truncate">
                          {ev.error_message || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
