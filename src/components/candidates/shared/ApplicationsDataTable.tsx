"use client";

import { useState } from "react";
import StatusBadge from "./StatusBadge";
import { openFaloodStudio } from "@/lib/falood/openStudio";

interface DashboardApplication {
  application_id: string;
  candidate_id?: string;
  candidate_name?: string;
  status: string;
  applied_at: string | null;
  follow_up_at: string | null;
  job_id: string;
  job_title: string;
  company_name: string;
  company_website: string | null;
  job_source: string;
  source_url: string | null;
  location: string | null;
  fit_score: number | null;
  recommendation: string | null;
  tailored_resume_version_id: string | null;
  sharepoint_resume_url: string | null;
}

interface ApplicationsDataTableProps {
  applications: DashboardApplication[];
  onStatusChange?: (applicationId: string, newStatus: string) => void;
  onNotesOpen?: (applicationId: string) => void;
  readOnly?: boolean;
  totalCount?: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  sort: string;
  order: string;
  onSort: (column: string) => void;
}

function sourceLabel(source: string): string {
  if (!source) return "Unknown";
  var lower = source.toLowerCase();
  if (lower === "linkedin") return "LinkedIn";
  if (lower === "company_site") return "Company Site";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  // Render the stored date portion literally instead of going through
  // `new Date(...)`, which re-interprets the instant in the viewer's local
  // timezone and can shift the visible day by one for values written near
  // UTC midnight (and "date-only" legacy values parse as UTC midnight in
  // every western timezone). The DB value is the business truth.
  var iso = typeof dateStr === "string" ? dateStr : String(dateStr);
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "—";
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var monthIdx = parseInt(m[2], 10) - 1;
  var day = parseInt(m[3], 10);
  if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) return "—";
  return months[monthIdx] + " " + day + ", " + m[1];
}

function copyToClipboard(text: string, setFeedback: (v: string | null) => void) {
  navigator.clipboard.writeText(text).then(function () {
    setFeedback("Copied!");
    setTimeout(function () { setFeedback(null); }, 1500);
  }).catch(function () {
    setFeedback("Failed");
    setTimeout(function () { setFeedback(null); }, 1500);
  });
}

function openCopilot(application: DashboardApplication) {
  if (!application.source_url) return;
  var url = new URL(application.source_url, window.location.origin);
  url.hash = "talentos_application_id=" + encodeURIComponent(application.application_id);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

var TH_STYLE: React.CSSProperties = {
  padding: "10px 12px", fontSize: 10, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.5px",
  color: "var(--ink-soft)", borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap", background: "rgba(0,0,0,0.15)", cursor: "pointer", userSelect: "none",
};

export default function ApplicationsDataTable({
  applications, onStatusChange, onNotesOpen, readOnly,
  totalCount, page, pageSize, onPageChange, sort, order, onSort,
}: ApplicationsDataTableProps) {
  var [localStatusLoading, setLocalStatusLoading] = useState<Record<string, boolean>>({});
  var [copiedId, setCopiedId] = useState<string | null>(null);
  var [sharepointNoticeId, setSharepointNoticeId] = useState<string | null>(null);

  var totalPages = totalCount !== undefined ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
  var showCandidateColumn = applications.some(function (a) { return !!a.candidate_name; });

  if (applications.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 16px", color: "var(--ink-soft)", fontSize: 13 }}>
        <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.4 }}>📂</div>
        No matching applications found. Try adjusting your filters.
      </div>
    );
  }

  function handleStatusChange(applicationId: string, newStatus: string) {
    if (!onStatusChange) return;
    setLocalStatusLoading(function (prev) { var next: Record<string, boolean> = {}; for (var k in prev) next[k] = prev[k]; next[applicationId] = true; return next; });
    onStatusChange(applicationId, newStatus);
    setTimeout(function () {
      setLocalStatusLoading(function (prev) { var next: Record<string, boolean> = {}; for (var k in prev) next[k] = prev[k]; delete next[applicationId]; return next; });
    }, 2000);
  }

  function handleToggle(applicationId: string, currentStatus: string, targetStatus: string) {
    if (!onStatusChange) return;
    handleStatusChange(applicationId, currentStatus === targetStatus ? "applied" : targetStatus);
  }

  function renderSortIndicator(column: string) {
    if (sort !== column) return <span style={{ color: "var(--ink-soft)", fontSize: 9, marginLeft: 3, opacity: 0.5 }}>↕</span>;
    return <span style={{ color: "var(--accent)", fontSize: 9, marginLeft: 3 }}>{order === "asc" ? "▲" : "▼"}</span>;
  }

  return (
    <>
      <div className="table-shell" style={{ borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
        <table className="table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
          <thead>
            <tr>
              {showCandidateColumn && <th onClick={function () { onSort("candidate_name"); }} style={{ ...TH_STYLE, width: "12%" }}>Candidate {renderSortIndicator("candidate_name")}</th>}
              <th onClick={function () { onSort("company_name"); }} style={{ ...TH_STYLE, width: "14%" }}>Company {renderSortIndicator("company_name")}</th>
              <th onClick={function () { onSort("job_title"); }} style={{ ...TH_STYLE }}>Job Role {renderSortIndicator("job_title")}</th>
              <th style={{ ...TH_STYLE, cursor: "default", width: "9%" }}>Job ID</th>
              <th style={{ ...TH_STYLE, cursor: "default", width: "9%" }}>Source</th>
              <th style={{ ...TH_STYLE, cursor: "default", width: "12%" }}>Location</th>
              <th style={{ ...TH_STYLE, cursor: "default", textAlign: "center", width: "8%" }}>Resume</th>
              <th onClick={function () { onSort("status"); }} style={{ ...TH_STYLE, width: "14%" }}>Status {renderSortIndicator("status")}</th>
              <th onClick={function () { onSort("applied_at"); }} style={{ ...TH_STYLE, width: "9%" }}>Applied {renderSortIndicator("applied_at")}</th>
              {!readOnly && <th style={{ ...TH_STYLE, cursor: "default", textAlign: "center", width: "16%" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {applications.map(function (app) {
              var isScreening = app.status === "replied";
              var isInterview = app.status === "interview";
              var isLoading = localStatusLoading[app.application_id];

              return (
                <tr key={app.application_id} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.15s" }}>
                  {showCandidateColumn && (
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                      {app.candidate_id ? (
                        <a href={"/candidates/" + app.candidate_id} style={{ color: "var(--ink)", textDecoration: "none" }}>
                          {app.candidate_name}
                        </a>
                      ) : (app.candidate_name || "—")}
                    </td>
                  )}
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                    {app.company_website ? (
                      <a href={app.company_website} target="_blank" rel="noopener noreferrer"
                        style={{ color: "var(--accent)", textDecoration: "none" }}
                        title={"Visit " + app.company_name + " website"}
                      >{app.company_name}</a>
                    ) : (
                      <a href={"/jobs/" + app.job_id}
                        style={{ color: "var(--accent)", textDecoration: "none" }}
                      >{app.company_name}</a>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {app.source_url ? (
                      <a href={app.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)", textDecoration: "none" }}>{app.job_title}</a>
                    ) : <span style={{ color: "var(--ink)" }}>{app.job_title}</span>}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{
                      fontFamily: "var(--font-mono, monospace)", fontSize: 11,
                      background: "var(--bg)", padding: "3px 8px", borderRadius: 4,
                      border: "1px solid var(--border)", color: "var(--ink-soft)",
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
                      <a href={"/jobs/" + app.job_id} style={{ color: "var(--ink-soft)", textDecoration: "none" }}>
                        {app.job_id.length > 8 ? app.job_id.substring(0, 8) + "..." : app.job_id}
                      </a>
                      <button
                        onClick={function () { copyToClipboard(app.job_id, setCopiedId); }}
                        title="Copy Job ID"
                        style={{
                          background: "transparent", border: "none", cursor: "pointer",
                          color: "var(--ink-soft)", fontSize: 11, padding: 0, lineHeight: 1,
                          opacity: 0.6, transition: "opacity 0.15s",
                        }}
                        onMouseEnter={function (e) { (e.target as HTMLElement).style.opacity = "1"; }}
                        onMouseLeave={function (e) { (e.target as HTMLElement).style.opacity = "0.6"; }}
                      >
                        {copiedId === app.job_id ? "✓" : "📋"}
                      </button>
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ color: "var(--ink-soft)", fontSize: 12, fontWeight: 500 }}>{sourceLabel(app.job_source)}</span>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--ink-soft)" }}>{app.location || "—"}</td>
                  {/* Tailored Resume Column */}
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    {app.tailored_resume_version_id ? (
                      <div style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "stretch" }}>
                        <button
                          onClick={function () { openFaloodStudio("application_resume_version", app.tailored_resume_version_id!); }}
                          title="Open tailored resume in Falood Studio"
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                            padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                            background: "rgba(99,102,241,0.12)",
                            color: "var(--accent)",
                            border: "1px solid rgba(99,102,241,0.3)",
                            cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
                          }}
                          onMouseEnter={function (e) {
                            var el = e.currentTarget as HTMLButtonElement;
                            el.style.background = "rgba(99,102,241,0.22)";
                            el.style.borderColor = "var(--accent)";
                          }}
                          onMouseLeave={function (e) {
                            var el = e.currentTarget as HTMLButtonElement;
                            el.style.background = "rgba(99,102,241,0.12)";
                            el.style.borderColor = "rgba(99,102,241,0.3)";
                          }}
                        >
                          <span style={{ fontSize: 12 }}>📄</span> Studio
                        </button>
                        {app.sharepoint_resume_url ? (
                          <a
                            href={app.sharepoint_resume_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open the archived PDF in SharePoint"
                            style={{
                              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                              padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                              background: "rgba(16,185,129,0.10)",
                              color: "#10b981",
                              border: "1px solid rgba(16,185,129,0.3)",
                              cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap", textDecoration: "none",
                            }}
                            onMouseEnter={function (e) {
                              var el = e.currentTarget as HTMLAnchorElement;
                              el.style.background = "rgba(16,185,129,0.20)";
                              el.style.borderColor = "#10b981";
                            }}
                            onMouseLeave={function (e) {
                              var el = e.currentTarget as HTMLAnchorElement;
                              el.style.background = "rgba(16,185,129,0.10)";
                              el.style.borderColor = "rgba(16,185,129,0.3)";
                            }}
                          >
                            <span style={{ fontSize: 12 }}>☁️</span> SharePoint
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={function (e) {
                              e.preventDefault();
                              setSharepointNoticeId(app.application_id);
                              setTimeout(function () { setSharepointNoticeId(function (cur) { return cur === app.application_id ? null : cur; }); }, 1800);
                            }}
                            title="Not archived to SharePoint yet"
                            style={{
                              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                              padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                              background: "rgba(148,163,184,0.08)",
                              color: "var(--ink-soft)",
                              border: "1px dashed var(--border)",
                              cursor: "pointer", whiteSpace: "nowrap", opacity: 0.75,
                            }}
                          >
                            <span style={{ fontSize: 12 }}>☁️</span> SharePoint
                          </button>
                        )}
                        {sharepointNoticeId === app.application_id && (
                          <span style={{ fontSize: 10, color: "var(--ink-soft)", lineHeight: 1.3 }}>
                            Not stored on SharePoint yet
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--ink-soft)", opacity: 0.35 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {readOnly ? (
                      <StatusBadge status={app.status} />
                    ) : (
                      <select
                        value={app.status}
                        disabled={isLoading}
                        className={`badge badge-${app.status}`}
                        onChange={function (e) { handleStatusChange(app.application_id, e.target.value); }}
                        style={{
                          cursor: "pointer",
                          opacity: isLoading ? 0.5 : 1, outline: "none",
                          WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
                          paddingRight: "16px",
                          border: "none",
                          minWidth: "110px",
                          textAlign: "center"
                        }}
                        title="Click to change status"
                      >
                        <option value="assigned">Assigned</option>
                        <option value="stacked">Stacked</option>
                        <option value="in_progress">In Progress</option>
                        <option value="applied">Applied</option>
                        <option value="replied">Screening</option>
                        <option value="interview">Interview</option>
                        <option value="offer">Offer</option>
                        <option value="rejected">Rejected</option>
                        <option value="withdrawn">Withdrawn</option>
                      </select>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--ink-soft)" }}>{formatDate(app.applied_at)}</td>
                  {!readOnly && (
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        {app.source_url && (
                          <button
                            onClick={function () { openCopilot(app); }}
                            title="Open this application in TalentOS Copilot"
                            style={{
                              height: 28, borderRadius: 6, cursor: "pointer", padding: "0 8px",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              border: "1px solid rgba(16,185,129,0.35)", background: "rgba(16,185,129,0.10)",
                              color: "#10b981", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                            }}
                          >Copilot</button>
                        )}
                        <a href={"/applications/" + app.application_id} target="_blank" rel="noreferrer" title="Open application record in a new tab" style={{ height: 28, borderRadius: 6, padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--accent)", background: "rgba(99,102,241,0.12)", color: "var(--accent)", fontSize: 11, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>Open · {app.application_id.slice(0, 8)}</a>
                        <button
                          onClick={function () { handleToggle(app.application_id, app.status, "replied"); }}
                          disabled={isLoading}
                          title={isScreening ? "Remove Screening" : "Mark Screening"}
                          style={{
                            width: 28, height: 28, borderRadius: 6, cursor: isLoading ? "not-allowed" : "pointer",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            border: "1px solid " + (isScreening ? "#06b6d440" : "var(--border)"),
                            background: isScreening ? "#06b6d415" : "var(--bg)",
                            color: isScreening ? "#06b6d4" : "var(--ink-soft)",
                            fontSize: 14, opacity: isLoading ? 0.5 : 1, transition: "all 0.15s",
                          }}
                        >📞</button>
                        <button
                          onClick={function () { handleToggle(app.application_id, app.status, "interview"); }}
                          disabled={isLoading}
                          title={isInterview ? "Remove Interview" : "Mark Interview"}
                          style={{
                            width: 28, height: 28, borderRadius: 6, cursor: isLoading ? "not-allowed" : "pointer",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            border: "1px solid " + (isInterview ? "#a855f740" : "var(--border)"),
                            background: isInterview ? "#a855f715" : "var(--bg)",
                            color: isInterview ? "#a855f7" : "var(--ink-soft)",
                            fontSize: 14, opacity: isLoading ? 0.5 : 1, transition: "all 0.15s",
                          }}
                        >🎯</button>
                        <button
                          onClick={function () { if (onNotesOpen) onNotesOpen(app.application_id); }}
                          title="Notes"
                          style={{
                            width: 28, height: 28, borderRadius: 6, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            border: "1px solid var(--border)", background: "var(--bg)",
                            color: "var(--ink-soft)", fontSize: 14, transition: "all 0.15s",
                          }}
                        >📝</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>
          <span>{totalCount} total · Page {page} of {totalPages}</span>
          <div style={{ display: "flex", gap: 3 }}>
            <PageBtn label="« First" disabled={page <= 1} onClick={function () { onPageChange(1); }} />
            <PageBtn label="‹ Prev" disabled={page <= 1} onClick={function () { onPageChange(page - 1); }} />
            {Array.from({ length: Math.min(totalPages, 5) }, function (_, i) {
              var start = Math.max(1, Math.min(page - 2, totalPages - 4));
              var p = start + i;
              if (p > totalPages) return null;
              return <PageBtn key={p} label={String(p)} active={p === page} onClick={function () { onPageChange(p); }} />;
            })}
            <PageBtn label="Next ›" disabled={page >= totalPages} onClick={function () { onPageChange(page + 1); }} />
            <PageBtn label="Last »" disabled={page >= totalPages} onClick={function () { onPageChange(totalPages); }} />
          </div>
        </div>
      )}
    </>
  );
}

function PageBtn({ label, disabled, active, onClick }: { label: string; disabled?: boolean; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
        border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
        background: active ? "var(--accent)" : "var(--bg)",
        color: active ? "#fff" : disabled ? "var(--ink-soft)" : "var(--ink)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1, transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}
