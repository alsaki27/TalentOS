"use client";

import { useEffect, useState } from "react";

interface Comment {
  id: string;
  body: string;
  commenter_name: string;
  visible_to_candidate: boolean;
  created_at: string;
}

interface ApplicationNotesModalProps {
  applicationId: string;
  onClose: () => void;
}

export default function ApplicationNotesModal({ applicationId, onClose }: ApplicationNotesModalProps) {
  var [comments, setComments] = useState<Comment[]>([]);
  var [body, setBody] = useState("");
  var [loading, setLoading] = useState(true);
  var [saving, setSaving] = useState(false);
  var [error, setError] = useState<string | null>(null);

  useEffect(function () {
    fetch("/api/applications/" + applicationId + "/comments")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setComments(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(function (err) {
        setError("Failed to load comments: " + (err.message ?? String(err)));
        setLoading(false);
      });
  }, [applicationId]);

  async function handleSave() {
    var text = body.trim();
    if (!text) return;
    setSaving(true);
    setError(null);

    try {
      var res = await fetch("/api/applications/" + applicationId + "/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, visible_to_candidate: false, commenter_name: "Job CEO Dashboard" }),
      });
      if (!res.ok) {
        var errData = await res.json().catch(function () { return { error: "Unknown" }; });
        throw new Error(errData.error ?? "HTTP " + res.status);
      }
      var newComment = await res.json();
      setComments(function (prev) { return [newComment, ...prev]; });
      setBody("");
    } catch (err) {
      setError((err as Error).message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 12, maxWidth: 560, width: "100%", maxHeight: "80vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }} onClick={function (e) { e.stopPropagation(); }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px", borderBottom: "1px solid var(--border)",
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
            Application Notes
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none", color: "var(--ink-soft)",
              fontSize: 20, cursor: "pointer", lineHeight: 1,
            }}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div style={{ padding: "14px 18px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {error && (
            <div style={{ color: "var(--danger)", fontSize: 12, padding: "6px 10px", background: "var(--danger-soft, rgba(244,63,94,0.1))", borderRadius: 6 }}>
              {error}
            </div>
          )}

          {loading ? (
            <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Loading notes...</span>
          ) : comments.length === 0 ? (
            <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>No notes yet. Add one below.</span>
          ) : (
            comments.map(function (c) { return (
              <div key={c.id} style={{ padding: "8px 12px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: 12 }}>{c.commenter_name}</span>
                  <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                <p style={{ margin: 0, color: "var(--ink)", whiteSpace: "pre-wrap" }}>{c.body}</p>
              </div>
            ); })
          )}

          <textarea
            value={body}
            onChange={function (e) { setBody(e.target.value); }}
            placeholder="Add a note..."
            rows={3}
            style={{
              width: "100%", padding: 10,
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 8, color: "var(--ink)", fontSize: 13,
              fontFamily: "inherit", resize: "vertical",
            }}
          />
        </div>

        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          padding: "12px 18px", borderTop: "1px solid var(--border)",
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "6px 16px", borderRadius: 8,
              background: "var(--bg)", border: "1px solid var(--border)",
              color: "var(--ink-soft)", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !body.trim()}
            style={{
              padding: "6px 16px", borderRadius: 8,
              background: "var(--accent)", border: "none",
              color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: saving || !body.trim() ? "not-allowed" : "pointer",
              opacity: saving || !body.trim() ? 0.6 : 1,
            }}
          >
            {saving ? "Saving..." : "Save Note"}
          </button>
        </div>
      </div>
    </div>
  );
}
