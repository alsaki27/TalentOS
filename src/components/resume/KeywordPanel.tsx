"use client";

import { useState } from "react";

/* ──────────── types ──────────── */

interface KeywordPanelProps {
  keywords: {
    id: string;
    keyword: string;
    evidence: "strong" | "weak" | "missing" | null;
    category?: string;
    importance?: string;
  }[];
  keywordApprovals: {
    id: string;
    keyword_id: string;
    decision: "approved" | "rejected" | "pending";
  }[];
  onApproveKeyword: (keywordId: string) => void;
  onRejectKeyword: (keywordId: string) => void;
  onKeywordClick: (keyword: string) => void;
  keywordMap?: Record<string, string[]>; // keyword -> sections where it appears
}

const CATEGORY_COLORS: Record<string, string> = {
  skill: "#e0f2fe",
  tool: "#f3e8ff",
  responsibility: "#fef9c3",
  certification: "#dcfce7",
  education: "#ffedd5",
  experience: "#fce7f3",
  domain: "#e7f2ec",
  soft_skill: "#eef2ff",
  visa: "#fef2f2",
  red_flag: "#fecaca",
  other: "#f1f5f9",
};

const CATEGORY_LABELS: Record<string, string> = {
  skill: "Skill",
  tool: "Tool",
  responsibility: "Responsibility",
  certification: "Certification",
  education: "Education",
  experience: "Experience",
  domain: "Domain",
  soft_skill: "Soft Skill",
  visa: "Visa",
  red_flag: "Red Flag",
  other: "Other",
};

export default function KeywordPanel({
  keywords,
  keywordApprovals,
  onApproveKeyword,
  onRejectKeyword,
  onKeywordClick,
  keywordMap = {},
}: KeywordPanelProps) {
  const [filter, setFilter] = useState<"all" | "approved" | "rejected" | "pending" | "missing" | "weak" | "strong">("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const approvedIds = new Set(keywordApprovals.filter((k) => k.decision === "approved").map((k) => k.keyword_id));
  const rejectedIds = new Set(keywordApprovals.filter((k) => k.decision === "rejected").map((k) => k.keyword_id));

  const categories = Array.from(new Set(keywords.map((k) => k.category ?? "other"))).sort();

  const filtered = keywords.filter((k) => {
    const isApproved = approvedIds.has(k.id);
    const isRejected = rejectedIds.has(k.id);
    const isPending = !isApproved && !isRejected;

    if (filter === "approved" && !isApproved) return false;
    if (filter === "rejected" && !isRejected) return false;
    if (filter === "pending" && !isPending) return false;
    if (filter === "missing" && k.evidence !== "missing") return false;
    if (filter === "weak" && k.evidence !== "weak") return false;
    if (filter === "strong" && k.evidence !== "strong") return false;

    if (categoryFilter && k.category !== categoryFilter) return false;
    if (search && !k.keyword.toLowerCase().includes(search.toLowerCase())) return false;

    return true;
  });

  const stats = {
    total: keywords.length,
    approved: keywords.filter((k) => approvedIds.has(k.id)).length,
    rejected: keywords.filter((k) => rejectedIds.has(k.id)).length,
    pending: keywords.filter((k) => !approvedIds.has(k.id) && !rejectedIds.has(k.id)).length,
    strong: keywords.filter((k) => k.evidence === "strong").length,
    weak: keywords.filter((k) => k.evidence === "weak").length,
    missing: keywords.filter((k) => k.evidence === "missing").length,
  };

  function getKeywordStatus(k: typeof keywords[0]) {
    if (approvedIds.has(k.id)) return "approved";
    if (rejectedIds.has(k.id)) return "rejected";
    return "pending";
  }

  function getKeywordEvidenceColor(k: typeof keywords[0]) {
    if (k.evidence === "strong") return "#15803d";
    if (k.evidence === "weak") return "#a16207";
    if (k.evidence === "missing") return "var(--danger)";
    return "var(--ink-soft)";
  }

  function getKeywordEvidenceBg(k: typeof keywords[0]) {
    if (k.evidence === "strong") return "#f0fdf4";
    if (k.evidence === "weak") return "#fffbeb";
    if (k.evidence === "missing") return "#fef2f2";
    return "var(--bg)";
  }

  function getImportanceLabel(k: typeof keywords[0]) {
    if (k.importance === "critical") return "🔴";
    if (k.importance === "high") return "🟠";
    if (k.importance === "medium") return "🟡";
    return "⚪";
  }

  return (
    <div className="keyword-panel">
      <div className="keyword-panel-header">
        <h3 style={{ fontSize: 13, margin: 0, fontWeight: 700 }}>JD Keywords</h3>
        <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
          {stats.approved} approved · {stats.rejected} rejected · {stats.missing} missing
        </p>
      </div>

      {/* Stats strip */}
      <div className="keyword-stats-strip">
        <button className={`keyword-stat-btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          <span className="keyword-stat-value">{stats.total}</span>
          <span className="keyword-stat-label">All</span>
        </button>
        <button className={`keyword-stat-btn ${filter === "approved" ? "active" : ""}`} onClick={() => setFilter("approved")}>
          <span className="keyword-stat-value" style={{ color: "var(--accent)" }}>{stats.approved}</span>
          <span className="keyword-stat-label">Approved</span>
        </button>
        <button className={`keyword-stat-btn ${filter === "missing" ? "active" : ""}`} onClick={() => setFilter("missing")}>
          <span className="keyword-stat-value" style={{ color: "var(--danger)" }}>{stats.missing}</span>
          <span className="keyword-stat-label">Missing</span>
        </button>
        <button className={`keyword-stat-btn ${filter === "weak" ? "active" : ""}`} onClick={() => setFilter("weak")}>
          <span className="keyword-stat-value" style={{ color: "var(--warn)" }}>{stats.weak}</span>
          <span className="keyword-stat-label">Weak</span>
        </button>
      </div>

      {/* Search */}
      <div className="keyword-search">
        <input
          type="text"
          placeholder="Search keywords…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 12, padding: "6px 10px" }}
        />
      </div>

      {/* Category filter */}
      <div className="keyword-categories">
        <button
          className={`keyword-category-btn ${categoryFilter === null ? "active" : ""}`}
          onClick={() => setCategoryFilter(null)}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`keyword-category-btn ${categoryFilter === cat ? "active" : ""}`}
            onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
            style={{
              background: categoryFilter === cat ? CATEGORY_COLORS[cat] ?? "var(--accent-soft)" : undefined,
            }}
          >
            {CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      {/* Keyword list */}
      <div className="keyword-list">
        {filtered.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, textAlign: "center", padding: 20 }}>
            No keywords match this filter.
          </p>
        ) : (
          filtered.map((k) => {
            const status = getKeywordStatus(k);
            const mappedSections = keywordMap[k.keyword] ?? [];

            return (
              <div
                key={k.id}
                className={`keyword-item keyword-status-${status}`}
                style={{ background: getKeywordEvidenceBg(k) }}
              >
                <div className="keyword-item-header">
                  <div className="keyword-item-main">
                    <span className="keyword-importance">{getImportanceLabel(k)}</span>
                    <span
                      className="keyword-text"
                      onClick={() => onKeywordClick(k.keyword)}
                      title="Click to find in resume"
                    >
                      {k.keyword}
                    </span>
                    {k.category && (
                      <span
                        className="keyword-category-tag"
                        style={{ background: CATEGORY_COLORS[k.category] ?? "#f1f5f9" }}
                      >
                        {CATEGORY_LABELS[k.category] ?? k.category}
                      </span>
                    )}
                  </div>
                  <div className="keyword-item-evidence">
                    <span style={{ color: getKeywordEvidenceColor(k), fontSize: 10, fontWeight: 600 }}>
                      {k.evidence === "strong" ? "✓ Strong" : k.evidence === "weak" ? "⚠ Weak" : k.evidence === "missing" ? "✗ Missing" : "? Unknown"}
                    </span>
                  </div>
                </div>

                {mappedSections.length > 0 && (
                  <div className="keyword-mapped-sections">
                    <span className="keyword-mapped-label">In resume:</span>
                    {mappedSections.map((s) => (
                      <span key={s} className="keyword-mapped-section">{s}</span>
                    ))}
                  </div>
                )}

                <div className="keyword-actions">
                  {status === "pending" && (
                    <>
                      <button className="keyword-btn keyword-btn-approve" onClick={() => onApproveKeyword(k.id)}>
                        ✓ Approve
                      </button>
                      <button className="keyword-btn keyword-btn-reject" onClick={() => onRejectKeyword(k.id)}>
                        ✕ Reject
                      </button>
                    </>
                  )}
                  {status === "approved" && (
                    <button className="keyword-btn keyword-btn-reject" onClick={() => onRejectKeyword(k.id)}>
                      Change to Rejected
                    </button>
                  )}
                  {status === "rejected" && (
                    <button className="keyword-btn keyword-btn-approve" onClick={() => onApproveKeyword(k.id)}>
                      Change to Approved
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <style>{`
        .keyword-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .keyword-panel-header {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
        }
        .keyword-stats-strip {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
        }
        .keyword-stat-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 6px 4px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--surface);
          cursor: pointer;
          font-size: 11px;
          transition: all 0.15s ease;
        }
        .keyword-stat-btn:hover {
          background: var(--bg);
        }
        .keyword-stat-btn.active {
          border-color: var(--accent);
          background: var(--accent-soft);
          box-shadow: inset 0 0 0 1px var(--accent);
        }
        .keyword-stat-value {
          font-size: 16px;
          font-weight: 700;
          color: var(--ink);
        }
        .keyword-stat-label {
          font-size: 10px;
          color: var(--ink-soft);
          margin-top: 2px;
        }
        .keyword-search {
          padding: 8px 14px;
          border-bottom: 1px solid var(--border);
        }
        .keyword-categories {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          padding: 8px 14px;
          border-bottom: 1px solid var(--border);
          max-height: 80px;
          overflow-y: auto;
        }
        .keyword-category-btn {
          padding: 3px 8px;
          border-radius: 100px;
          border: 1px solid var(--border);
          background: var(--surface);
          font-size: 10px;
          font-weight: 600;
          color: var(--ink-soft);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .keyword-category-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .keyword-category-btn.active {
          border-color: var(--accent);
          color: var(--accent);
          font-weight: 700;
        }
        .keyword-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px 14px;
        }
        .keyword-item {
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--border);
          margin-bottom: 6px;
          transition: box-shadow 0.15s ease;
        }
        .keyword-item:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .keyword-item-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
        }
        .keyword-item-main {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .keyword-importance {
          font-size: 10px;
        }
        .keyword-text {
          font-size: 12px;
          font-weight: 600;
          color: var(--ink);
          cursor: pointer;
        }
        .keyword-text:hover {
          text-decoration: underline;
          color: var(--accent);
        }
        .keyword-category-tag {
          font-size: 9px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 100px;
          color: var(--ink-soft);
        }
        .keyword-item-evidence {
          white-space: nowrap;
        }
        .keyword-mapped-sections {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
          margin: 4px 0 6px;
        }
        .keyword-mapped-label {
          font-size: 10px;
          color: var(--ink-soft);
        }
        .keyword-mapped-section {
          font-size: 10px;
          padding: 1px 6px;
          border-radius: 100px;
          background: var(--accent-soft);
          color: var(--accent);
          font-weight: 600;
        }
        .keyword-actions {
          display: flex;
          gap: 6px;
          margin-top: 6px;
        }
        .keyword-btn {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          border: 1px solid;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .keyword-btn-approve {
          background: var(--accent-soft);
          color: var(--accent);
          border-color: var(--accent);
        }
        .keyword-btn-approve:hover {
          background: var(--accent);
          color: white;
        }
        .keyword-btn-reject {
          background: #fef2f2;
          color: var(--danger);
          border-color: var(--danger);
        }
        .keyword-btn-reject:hover {
          background: var(--danger);
          color: white;
        }
      `}</style>
    </div>
  );
}
