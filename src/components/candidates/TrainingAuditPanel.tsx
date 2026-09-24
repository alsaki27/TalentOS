"use client";
import { useEffect, useState } from "react";

interface AuditStudent {
  id: string;
  name: string;
  domain: string | null;
  target_role: string | null;
  joining_date: string | null;
  progress: number;
  mock_interviews: number;
  rating: string;
  placement_company: string | null;
  placement_role: string | null;
  placement_date: string | null;
}

interface StickyNote {
  id: string;
  date: string;
  content: string;
  category: string;
  author: string;
  accent: string;
  pinned: boolean;
}

interface TrainingAuditSummary {
  linked: boolean;
  staleLink?: boolean;
  student: AuditStudent | null;
  stickyNotes: StickyNote[];
  syncedAt?: string;
}

const RATING_LABELS: Record<string, string> = {
  placed: "Placed",
  excellent: "Excellent",
  good: "Good",
  needs_attention: "Needs Attention",
  bad: "At Risk",
};

export function TrainingAuditPanel({ candidateId }: { candidateId: string }) {
  const [summary, setSummary] = useState<TrainingAuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AuditStudent[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [searchError, setSearchError] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit`, { cache: "no-store" });
      if (!res.ok) {
        setSummary(null);
        setLoadError(true);
        return;
      }
      setSummary(await res.json());
    } catch {
      setSummary(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [candidateId]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/student-audit/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (!res.ok) {
          setSearchResults([]);
          setSearchError(true);
          return;
        }
        const data = await res.json();
        setSearchResults(data.results ?? []);
        setSearchError(false);
      } catch {
        setSearchResults([]);
        setSearchError(true);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  async function linkTo(studentId: string) {
    setLinking(studentId);
    const matched = searchResults.find((s) => s.id === studentId);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditStudentId: studentId }),
      });
      if (res.ok) {
        setSearchQuery("");
        setSearchResults([]);
        // Show the linked view immediately using what we already have from the
        // search result, instead of waiting on a second round trip for sticky
        // notes to load before the UI updates at all.
        if (matched) setSummary({ linked: true, student: matched, stickyNotes: [] });
        void load();
      }
    } finally {
      setLinking(null);
    }
  }

  async function unlink() {
    if (!confirm("Unlink this candidate from the student-audit record? This does not delete any student-audit data.")) return;
    const previous = summary;
    setSummary({ linked: false, student: null, stickyNotes: [] });
    try {
      const res = await fetch(`/api/candidates/${candidateId}/student-audit/link`, { method: "DELETE" });
      if (!res.ok) {
        setSummary(previous);
        return;
      }
      void load();
    } catch {
      setSummary(previous);
    }
  }

  if (loading) return <p className="muted">Loading training audit…</p>;

  if (loadError) {
    return (
      <div className="card" style={{ borderStyle: "dashed" }}>
        <p style={{ fontSize: 14, margin: "0 0 4px" }}><strong>Couldn&apos;t load training audit data</strong></p>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>Something went wrong loading this. Try again.</p>
        <button className="btn-compact btn-sm" onClick={load}>Retry</button>
      </div>
    );
  }

  if (!summary?.linked || !summary.student) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card" style={{ borderStyle: "dashed" }}>
          <p style={{ fontSize: 14, margin: "0 0 4px" }}><strong>No student-audit record linked</strong></p>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
            {summary?.staleLink
              ? "The previous link points at a record that no longer exists — search and link again."
              : "Search the Skarion Student Audit roster by name and link the matching record. Names and emails don't line up automatically between the two systems, so pick carefully."}
          </p>
          <input
            className="input"
            placeholder="Search student-audit roster by name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ maxWidth: 360 }}
          />
        </div>

        {searching && <p className="muted" style={{ fontSize: 13 }}>Searching…</p>}
        {searchError && <p style={{ color: "var(--danger)", fontSize: 13 }}>Search failed — try again.</p>}

        {searchResults.length > 0 && (
          <div className="table-shell">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Domain</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td className="muted">{s.domain ?? s.target_role ?? "—"}</td>
                    <td><span className="badge">{RATING_LABELS[s.rating] ?? s.rating}</span></td>
                    <td>
                      <button className="btn-compact btn-sm" onClick={() => linkTo(s.id)} disabled={linking === s.id}>
                        {linking === s.id ? "Linking…" : "Link"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const { student, stickyNotes, syncedAt } = summary;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-header">
        <h2 style={{ fontSize: 16, margin: 0 }}>Training &amp; mock interview audit</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge">{RATING_LABELS[student.rating] ?? student.rating}</span>
          <button className="btn-compact btn-sm" onClick={unlink}>Unlink</button>
        </div>
      </div>
      {syncedAt && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Synced from Skarion Student Audit as of {new Date(syncedAt).toLocaleString()}
        </p>
      )}

      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <div><label>Course progress</label><p style={{ margin: "2px 0 0", fontSize: 18 }}>{student.progress}%</p></div>
        <div><label>Mock interviews</label><p style={{ margin: "2px 0 0", fontSize: 18 }}>{student.mock_interviews}</p></div>
        <div><label>Domain / track</label><p className="muted" style={{ margin: "2px 0 0" }}>{student.domain ?? student.target_role ?? "—"}</p></div>
        <div><label>Joined</label><p className="muted" style={{ margin: "2px 0 0" }}>{student.joining_date ? new Date(student.joining_date).toLocaleDateString() : "—"}</p></div>
        {student.placement_company && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Placed</label>
            <p style={{ margin: "2px 0 0" }}>
              {student.placement_role} at {student.placement_company}
              {student.placement_date ? ` · ${new Date(student.placement_date).toLocaleDateString()}` : ""}
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: 12 }}>Audit log / sticky notes ({stickyNotes.length})</h3>
        {stickyNotes.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No notes recorded yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stickyNotes.map((n) => (
              <div key={n.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted" style={{ fontSize: 11 }}>{n.author} · {n.date} · {n.category}</span>
                  {n.pinned && <span className="badge badge-info" style={{ fontSize: 10 }}>Pinned</span>}
                </div>
                <p style={{ margin: "6px 0 0" }}>{n.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
