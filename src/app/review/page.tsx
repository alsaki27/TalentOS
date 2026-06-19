// src/app/review/page.tsx
// QC Review Queue for reviewers and managers.
// MVP: Base resumes only. Application packet review coming soon.

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TableSkeleton } from "../Skeleton";

const REVIEWER_ROLES = ["admin", "manager", "reviewer"];

type ReviewTab = "All" | "Base Resumes" | "Application Packets" | "Approved" | "Rejected";

interface MeResponse {
  user: { id: string; email: string | null };
  profile: { display_name: string; email: string | null; role: string };
}

interface CandidateCompact {
  id: string;
  name: string;
}

interface BaseResumeSummary {
  id: string;
  name: string;
  target_industry: string | null;
  target_roles: string[] | null;
  status: string;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

interface ReviewItem {
  id: string;
  type: "base_resume" | "application_packet";
  candidateId: string;
  candidateName: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
}

interface ResumeDocument {
  header: {
    fullName: string;
    location?: string;
    phone?: string;
    email?: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
  };
  summary?: { id: string; text: string };
  skills: { id: string; title: string; skills: string[] }[];
  experience: {
    id: string;
    title: string;
    company: string;
    location?: string;
    startDate: string;
    endDate?: string;
    bullets: { id: string; text: string }[];
  }[];
  education: { id: string; degree: string; school: string; graduationDate?: string }[];
}

interface BaseResumeDetail {
  id: string;
  candidate_id: string;
  name: string;
  target_industry: string | null;
  target_roles: string[] | null;
  status: string;
  content: ResumeDocument;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

interface CandidateDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  work_authorization: string | null;
  target_industries: string[] | null;
  visa_status: string | null;
  target_roles: string | null;
}

interface EvidenceRow {
  id: string;
  title: string;
  description: string | null;
  source_type: string;
  related_skills: string[] | null;
  confidence_score: number | null;
}

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export default function ReviewPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ReviewTab>("All");
  const [reviewItem, setReviewItem] = useState<ReviewItem | null>(null);
  const [rejectItem, setRejectItem] = useState<ReviewItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!me) return;
    loadItems();
  }, [me]);

  async function loadItems() {
    setLoading(true);
    try {
      // Fetch up to 200 candidates. For each, fetch base resumes in parallel.
      const candRes = await fetch("/api/candidates?page=1&pageSize=200", { cache: "no-store" });
      const candData = await candRes.json();
      const candidates: CandidateCompact[] = (candData.items ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
      }));

      const results = await Promise.all(
        candidates.map(async (c) => {
          try {
            const res = await fetch(`/api/base-resumes?candidateId=${c.id}`, { cache: "no-store" });
            const data = res.ok ? await res.json() : [];
            return (data as BaseResumeSummary[]).map((b) => ({
              id: b.id,
              type: "base_resume" as const,
              candidateId: c.id,
              candidateName: c.name,
              name: b.name,
              status: b.status,
              createdAt: b.created_at,
              updatedAt: b.updated_at,
              createdBy: b.created_by,
            }));
          } catch {
            return [];
          }
        })
      );
      setItems(results.flat());
    } catch {
      showToast("Failed to load review queue.", "error");
    } finally {
      setLoading(false);
    }
  }

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function logActivity(
    description: string,
    entityId: string,
    entityName: string,
    metadata: Record<string, unknown>
  ) {
    await fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: me?.user.id,
        actor_name: me?.profile.display_name || me?.profile.email,
        type: "update",
        description,
        entity_type: "base_resume",
        entity_id: entityId,
        entity_name: entityName,
        metadata,
      }),
    });
  }

  async function handleApprove(item: ReviewItem) {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/base-resumes/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (!res.ok) throw new Error("Approve failed");
      await logActivity(
        `Approved base resume "${item.name}"`,
        item.id,
        item.name,
        { candidate_id: item.candidateId, action: "approve" }
      );
      showToast(`Approved "${item.name}"`);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "approved" } : i)));
    } catch {
      showToast("Failed to approve.", "error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject(item: ReviewItem, reason: string) {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/base-resumes/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "draft" }),
      });
      if (!res.ok) throw new Error("Reject failed");
      await logActivity(
        `Rejected base resume "${item.name}": ${reason}`,
        item.id,
        item.name,
        { candidate_id: item.candidateId, action: "reject", reason }
      );
      showToast(`Rejected "${item.name}"`);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "draft" } : i)));
      setRejectItem(null);
      setRejectReason("");
    } catch {
      showToast("Failed to reject.", "error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFlag(item: ReviewItem, note: string) {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await logActivity(
        `Flagged issue on base resume "${item.name}": ${note}`,
        item.id,
        item.name,
        { candidate_id: item.candidateId, action: "flag", note }
      );
      showToast("Issue flagged");
    } catch {
      showToast("Failed to flag issue.", "error");
    } finally {
      setActionLoading(false);
    }
  }

  const filtered = useMemo(() => {
    let list = items;
    if (activeTab === "Base Resumes") list = list.filter((i) => i.type === "base_resume");
    if (activeTab === "Application Packets") list = list.filter((i) => i.type === "application_packet");
    if (activeTab === "Approved") list = list.filter((i) => i.status === "approved");
    if (activeTab === "Rejected") list = list.filter((i) => i.status === "rejected");
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || i.candidateName.toLowerCase().includes(q));
    }
    return list;
  }, [items, activeTab, search]);

  const stats = useMemo(() => {
    const pending = items.filter((i) => i.status === "in_review").length;
    const approvedToday = items.filter((i) => i.status === "approved" && isToday(i.updatedAt)).length;
    const rejectedToday = items.filter((i) => i.status === "rejected" && isToday(i.updatedAt)).length;
    const approvedItems = items.filter((i) => i.status === "approved");
    const avgReviewTime =
      approvedItems.length > 0
        ? Math.round(
            approvedItems.reduce((sum, i) => {
              const created = new Date(i.createdAt).getTime();
              const updated = new Date(i.updatedAt).getTime();
              return sum + (updated - created);
            }, 0) /
              approvedItems.length /
              60000
          )
        : 0;
    return { pending, approvedToday, rejectedToday, avgReviewTime };
  }, [items]);

  const isReviewer = me && REVIEWER_ROLES.includes(me.profile.role);

  if (!me) {
    return (
      <div className="page">
        <div className="loading-panel">Loading…</div>
      </div>
    );
  }

  if (!isReviewer) {
    return (
      <div className="page">
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <h1 style={{ marginTop: 0 }}>Access denied</h1>
          <p className="muted">You do not have permission to view the review queue.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Review Queue</h1>
          <p className="page-kicker">QC review for base resumes and application packets</p>
        </div>
      </div>

      <div className="filter-bar">
        {(["All", "Base Resumes", "Application Packets", "Approved", "Rejected"] as ReviewTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              borderRadius: "var(--radius)",
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid var(--border)",
              background: activeTab === tab ? "var(--accent-soft)" : "var(--surface)",
              color: activeTab === tab ? "var(--accent)" : "var(--ink)",
              cursor: "pointer",
            }}
          >
            {tab}
          </button>
        ))}
        <input
          placeholder="Search candidate or item name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220, marginLeft: "auto" }}
        />
      </div>

      <div className="stats-strip">
        <div className="stat-card">
          <span className="stat-label">Pending reviews</span>
          <span className="stat-value">{stats.pending}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Approved today</span>
          <span className="stat-value">{stats.approvedToday}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Rejected today</span>
          <span className="stat-value">{stats.rejectedToday}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Avg review time</span>
          <span className="stat-value">{stats.avgReviewTime}m</span>
        </div>
      </div>

      {toast && (
        <div className={`toast ${toast.type === "error" ? "toast-error" : ""}`}>{toast.message}</div>
      )}

      {loading ? (
        <TableSkeleton cols={7} />
      ) : activeTab === "Application Packets" ? (
        <div className="empty">
          Application packet review is coming soon. Use the <strong>Base Resumes</strong> tab for now.
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {search ? "No items match your search." : "No items in the review queue."}
        </div>
      ) : (
        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Candidate</th>
                <th>Item Name</th>
                <th>Status</th>
                <th>Created By</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="badge">
                      {item.type === "base_resume" ? "Base Resume" : "Application Packet"}
                    </span>
                  </td>
                  <td>
                    <Link className="row-link" href={`/candidates/${item.candidateId}`}>
                      {item.candidateName}
                    </Link>
                  </td>
                  <td>{item.name}</td>
                  <td>
                    <span className={`badge badge-${item.status}`}>{item.status}</span>
                  </td>
                  <td
                    className="muted"
                    title="created_by not returned by base-resumes list API — add it to the select if needed"
                  >
                    {item.createdBy ?? "—"}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {new Date(item.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div className="action-group">
                      <button className="btn-compact" onClick={() => setReviewItem(item)}>
                        Review
                      </button>
                      <button
                        className="btn-compact btn-primary"
                        onClick={() => handleApprove(item)}
                        disabled={actionLoading || item.status === "approved"}
                      >
                        Approve
                      </button>
                      <button
                        className="btn-compact btn-danger"
                        onClick={() => setRejectItem(item)}
                        disabled={actionLoading || item.status === "rejected"}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reviewItem && (
        <ReviewModal
          item={reviewItem}
          onClose={() => setReviewItem(null)}
          onApprove={handleApprove}
          onReject={(item, reason) => {
            handleReject(item, reason);
            setReviewItem(null);
          }}
          onFlag={(item, note) => {
            handleFlag(item, note);
            setReviewItem(null);
          }}
          actionLoading={actionLoading}
        />
      )}

      {rejectItem && (
        <div className="modal-overlay" onClick={() => setRejectItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reject {rejectItem.name}</h2>
            <div className="field-group">
              <label>Reason</label>
              <textarea
                rows={3}
                placeholder="Why is this being rejected?"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setRejectItem(null)}>Cancel</button>
              <button
                className="btn-danger"
                onClick={() => handleReject(rejectItem, rejectReason)}
                disabled={actionLoading || !rejectReason.trim()}
              >
                {actionLoading ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewModal({
  item,
  onClose,
  onApprove,
  onReject,
  onFlag,
  actionLoading,
}: {
  item: ReviewItem;
  onClose: () => void;
  onApprove: (item: ReviewItem) => void;
  onReject: (item: ReviewItem, reason: string) => void;
  onFlag: (item: ReviewItem, note: string) => void;
  actionLoading: boolean;
}) {
  const [detail, setDetail] = useState<BaseResumeDetail | null>(null);
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectNote, setRejectNote] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showFlag, setShowFlag] = useState(false);

  useEffect(() => {
    setLoading(true);
    setRejectNote("");
    setFlagNote("");
    setShowReject(false);
    setShowFlag(false);
    Promise.all([
      fetch(`/api/base-resumes/${item.id}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/candidates/${item.candidateId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/candidates/${item.candidateId}/evidence`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([d, c, e]) => {
        setDetail(d);
        setCandidate(c);
        setEvidence(e);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [item]);

  const content = detail?.content;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(960px, 94vw)", maxHeight: "92vh", overflowY: "auto" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0 }}>{item.name}</h2>
          <button onClick={onClose}>Close</button>
        </div>

        {loading || !content ? (
          <p className="muted">Loading detail…</p>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div className="card">
                <h3 style={{ fontSize: 14, marginTop: 0 }}>Candidate context</h3>
                <p className="muted" style={{ fontSize: 13 }}>
                  <strong>{candidate?.name ?? item.candidateName}</strong>
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  Work auth: {candidate?.work_authorization ?? "—"}
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  Target industry: {detail?.target_industry ?? "—"}
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  Target roles: {detail?.target_roles?.join(", ") ?? "—"}
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  Visa status: {candidate?.visa_status ?? "—"}
                </p>
              </div>

              <div className="card">
                <h3 style={{ fontSize: 14, marginTop: 0 }}>Evidence bank ({evidence.length})</h3>
                {evidence.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>
                    No evidence yet.
                  </p>
                ) : (
                  <ul style={{ paddingLeft: 16, fontSize: 12, margin: 0 }}>
                    {evidence.slice(0, 6).map((e) => (
                      <li key={e.id} style={{ marginBottom: 4 }}>
                        <strong>{e.title}</strong>{" "}
                        <span className="muted">({e.source_type})</span>
                      </li>
                    ))}
                    {evidence.length > 6 && (
                      <li className="muted">+{evidence.length - 6} more</li>
                    )}
                  </ul>
                )}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, marginTop: 0 }}>Resume draft</h3>
              <h2 style={{ margin: "8px 0 0", fontSize: 18 }}>{content.header.fullName}</h2>
              <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {[
                  content.header.location,
                  content.header.phone,
                  content.header.email,
                  content.header.linkedin,
                  content.header.portfolio,
                ]
                  .filter(Boolean)
                  .join(" | ")}
              </p>
              {content.summary?.text && (
                <p style={{ fontSize: 13, marginTop: 8 }}>{content.summary.text}</p>
              )}

              {content.skills.length > 0 && (
                <>
                  <h4 style={{ fontSize: 13, margin: "12px 0 4px" }}>Technical Skills</h4>
                  {content.skills.map((s) => (
                    <p key={s.id} style={{ fontSize: 12, margin: "2px 0" }}>
                      <strong>{s.title}:</strong> {s.skills.join(", ")}
                    </p>
                  ))}
                </>
              )}

              {content.experience.length > 0 && (
                <>
                  <h4 style={{ fontSize: 13, margin: "12px 0 4px" }}>Professional Experience</h4>
                  {content.experience.map((exp) => (
                    <div key={exp.id} style={{ marginBottom: 8 }}>
                      <p style={{ fontSize: 13, margin: 0 }}>
                        <strong>{exp.title}</strong> — {exp.company}{" "}
                        {exp.location ? `(${exp.location})` : ""}
                      </p>
                      <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                        {exp.startDate} – {exp.endDate ?? "Present"}
                      </p>
                      <ul style={{ fontSize: 12, margin: "2px 0", paddingLeft: 16 }}>
                        {exp.bullets.map((b) => (
                          <li key={b.id}>{b.text}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}

              {content.education.length > 0 && (
                <>
                  <h4 style={{ fontSize: 13, margin: "12px 0 4px" }}>Education</h4>
                  {content.education.map((edu) => (
                    <p key={edu.id} style={{ fontSize: 12, margin: "2px 0" }}>
                      {edu.degree} — {edu.school}{" "}
                      {edu.graduationDate ? `(${edu.graduationDate})` : ""}
                    </p>
                  ))}
                </>
              )}
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, marginTop: 0 }}>Falood command log</h3>
              <p className="muted" style={{ fontSize: 12 }}>
                Command history is available in the{" "}
                <Link href={`/falood/studio/base/${item.id}`} onClick={onClose}>
                  Falood Studio
                </Link>
                .
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn-primary"
                  onClick={() => onApprove(item)}
                  disabled={actionLoading || item.status === "approved"}
                >
                  Approve
                </button>
                <button
                  className="btn-danger"
                  onClick={() => {
                    setShowFlag(false);
                    setShowReject((v) => !v);
                  }}
                  disabled={actionLoading}
                >
                  Reject
                </button>
                <button
                  onClick={() => {
                    setShowReject(false);
                    setShowFlag((v) => !v);
                  }}
                  disabled={actionLoading}
                >
                  Flag Issue
                </button>
              </div>

              {showReject && (
                <div className="card" style={{ background: "var(--bg)" }}>
                  <label>Rejection reason</label>
                  <textarea
                    rows={2}
                    placeholder="Why is this being rejected?"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    style={{ marginBottom: 8 }}
                  />
                  <div className="action-group">
                    <button
                      className="btn-danger"
                      onClick={() => onReject(item, rejectNote)}
                      disabled={actionLoading || !rejectNote.trim()}
                    >
                      Confirm Reject
                    </button>
                    <button onClick={() => setShowReject(false)}>Cancel</button>
                  </div>
                </div>
              )}

              {showFlag && (
                <div className="card" style={{ background: "var(--bg)" }}>
                  <label>Flag note</label>
                  <textarea
                    rows={2}
                    placeholder="Describe the issue…"
                    value={flagNote}
                    onChange={(e) => setFlagNote(e.target.value)}
                    style={{ marginBottom: 8 }}
                  />
                  <div className="action-group">
                    <button
                      className="btn-primary"
                      onClick={() => onFlag(item, flagNote)}
                      disabled={actionLoading || !flagNote.trim()}
                    >
                      Confirm Flag
                    </button>
                    <button onClick={() => setShowFlag(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
