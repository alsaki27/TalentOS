"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Profile = {
  id: string | null;
  base_resume_id: string;
  resume_name: string;
  resume_status: string;
  resume_updated_at: string;
  keywords: string[];
  keyword_states?: Array<{ term: string; status: "active" | "dismissed"; category?: string; evidence?: string; reason?: string; source?: string }>;
  additional_rules: string;
  profile_updated_at: string | null;
  generation_status?: string;
  last_generated_at?: string | null;
  last_generation_model?: string | null;
  last_generation_prompt_version?: string | null;
  last_generation_error?: string | null;
};

type KeywordState = NonNullable<Profile["keyword_states"]>[number];
type Draft = { keywordStates: KeywordState[]; additionalRules: string; newKeyword: string };

export default function CandidateJobSearchProfilesPage() {
  const params = useParams<{ id: string }>();
  const candidateId = params.id;
  const [candidateName, setCandidateName] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [candidateRes, profilesRes] = await Promise.all([
          fetch("/api/candidates/" + candidateId, { cache: "no-store" }),
          fetch("/api/candidates/" + candidateId + "/job-search-profiles", { cache: "no-store" }),
        ]);
        const candidate = await candidateRes.json();
        const data = await profilesRes.json();
        if (!candidateRes.ok || !profilesRes.ok) throw new Error(data.error || candidate.error || "Could not load search profiles");
        if (cancelled) return;
        const rows = (data.profiles ?? []) as Profile[];
        setCandidateName(candidate.candidate?.name ?? candidate.name ?? "Candidate");
        setCanEdit(Boolean(data.canEdit));
        setProfiles(rows);
        setDrafts(Object.fromEntries(rows.map((p) => [p.base_resume_id, {
          keywordStates: (p.keyword_states?.length ? p.keyword_states : p.keywords.map((term) => ({ term, status: "active" as const, source: "manual" }))),
          additionalRules: p.additional_rules ?? "",
          newKeyword: "",
        }])));
      } catch (error: any) {
        if (!cancelled) setMessage({ kind: "error", text: error.message || "Could not load search profiles" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [candidateId]);

  function updateRules(id: string, value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], additionalRules: value } }));
  }

  function addKeyword(id: string) {
    const draft = drafts[id];
    const term = draft?.newKeyword.trim();
    if (!term) return;
    const key = term.toLowerCase();
    if (draft.keywordStates.some((item) => item.status === "active" && item.term.toLowerCase() === key)) return;
    if (draft.keywordStates.filter((item) => item.status === "active").length >= 48) return;
    setDrafts((current) => ({ ...current, [id]: {
      ...current[id],
      keywordStates: [...current[id].keywordStates, { term, status: "active", source: "manual" }],
      newKeyword: "",
    } }));
  }

  function setKeywordStatus(id: string, term: string, status: "active" | "dismissed") {
    setDrafts((current) => ({ ...current, [id]: {
      ...current[id],
      keywordStates: current[id].keywordStates.map((item) => item.term === term ? { ...item, status, source: "manual" } : item),
    } }));
  }

  function updateDraft(id: string, field: "newKeyword", value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  }

  async function save(profile: Profile) {
    const draft = drafts[profile.base_resume_id] ?? { keywordStates: [], additionalRules: "", newKeyword: "" };
    const keywords = draft.keywordStates.filter((item) => item.status === "active").map((item) => item.term);
    setSaving(profile.base_resume_id);
    setMessage(null);
    try {
      const res = await fetch("/api/candidates/" + candidateId + "/job-search-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseResumeId: profile.base_resume_id, keywords, keywordStates: draft.keywordStates, additionalRules: draft.additionalRules }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save profile");
      setMessage({ kind: "success", text: "Saved " + profile.resume_name + "." });
      setProfiles((current) => current.map((row) => row.base_resume_id === profile.base_resume_id
        ? { ...row, id: data.profile.id, keywords, keyword_states: draft.keywordStates, additional_rules: draft.additionalRules, profile_updated_at: data.profile.updated_at, generation_status: "manual" }
        : row));
    } catch (error: any) {
      setMessage({ kind: "error", text: error.message || "Could not save profile" });
    } finally {
      setSaving(null);
    }
  }

  async function regenerate(profile: Profile) {
    setSaving(profile.base_resume_id);
    setMessage(null);
    setProfiles((current) => current.map((row) => row.base_resume_id === profile.base_resume_id
      ? { ...row, generation_status: "running", last_generation_error: null }
      : row));
    try {
      const res = await fetch("/api/admin/base-resume-keywords/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseResumeId: profile.base_resume_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI keyword generation failed");
      setMessage({ kind: "success", text: `Generated ${data.result.keywords.length} focused keywords for ${profile.resume_name}. Review and save any edits.` });
      const generated = data.result.profile;
      setProfiles((current) => current.map((row) => row.base_resume_id === profile.base_resume_id
        ? { ...row, ...generated, keywords: data.result.keywords, keyword_states: generated.keyword_states, additional_rules: data.result.rules.join("\n"), generation_status: "complete", last_generation_model: data.result.model, last_generation_prompt_version: data.result.promptVersion }
        : row));
      setDrafts((current) => ({ ...current, [profile.base_resume_id]: {
        keywordStates: generated.keyword_states ?? [],
        additionalRules: data.result.rules.join("\n"),
        newKeyword: "",
      } }));
    } catch (error: any) {
      setMessage({ kind: "error", text: error.message || "AI keyword generation failed" });
      setProfiles((current) => current.map((row) => row.base_resume_id === profile.base_resume_id
        ? { ...row, generation_status: "failed", last_generation_error: error.message || "AI keyword generation failed" }
        : row));
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="page-shell">
      <div className="page-header" style={{ alignItems: "flex-start" }}>
        <div>
          <Link href={"/candidates/" + candidateId} className="muted" style={{ fontSize: 13 }}>← Back to candidate</Link>
          <h1 style={{ marginBottom: 6 }}>Job search profiles</h1>
          <p className="muted" style={{ margin: 0 }}>
            {candidateName || "Active candidate"} · define the baseline search contract for each base resume.
          </p>
        </div>
      </div>

      <div className="alert" style={{ marginBottom: 16 }}>
        The {"BaseResume_TO_JobSearchKeyword"} agent generates 30–48 focused terms and rules from each resume. Managers and admins can dismiss individual terms, restore them, add terms, and edit the rules before ingestion uses them.
      </div>
      {!canEdit && <div className="alert" style={{ marginBottom: 16 }}>View-only: keyword review changes are limited to managers and admins.</div>}
      {message && <div className={"alert " + (message.kind === "error" ? "alert-error" : "alert-success")} style={{ marginBottom: 16 }}>{message.text}</div>}

      {loading ? <div className="loading-panel">Loading base resumes…</div> : profiles.length === 0 ? (
        <div className="empty-state">This active candidate has no base resumes yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {profiles.map((profile) => {
            const draft = drafts[profile.base_resume_id] ?? { keywordStates: [], additionalRules: "", newKeyword: "" };
            const activeKeywords = draft.keywordStates.filter((item) => item.status === "active");
            const dismissedKeywords = draft.keywordStates.filter((item) => item.status === "dismissed");
            const count = activeKeywords.length;
            return (
              <section className="card" key={profile.base_resume_id}>
                <div className="page-header" style={{ marginBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{profile.resume_name}</h2>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {profile.resume_status} · resume updated {new Date(profile.resume_updated_at).toLocaleDateString()} · {count}/48 active keywords · {profile.generation_status ?? "not generated"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {canEdit && <button className="btn-secondary" onClick={() => regenerate(profile)} disabled={saving === profile.base_resume_id}>{saving === profile.base_resume_id ? "Generating with Gemini…" : "Generate keywords with AI"}</button>}
                    {canEdit && <button className="btn-primary" onClick={() => save(profile)} disabled={saving === profile.base_resume_id}>{saving === profile.base_resume_id ? "Working…" : "Save review"}</button>}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
                  <div>
                    <label>Search keywords · cross out to dismiss</label>
                    <div style={{ minHeight: 180, padding: 10, border: "1px solid var(--border)", borderRadius: 8, display: "flex", flexWrap: "wrap", alignContent: "flex-start", gap: 7, background: "var(--surface-1)" }}>
                      {activeKeywords.map((item) => (
                        <span key={item.term} title={item.reason || item.evidence || "AI or manually added keyword"} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 8px", borderRadius: 999, background: "var(--accent-soft, #ede9fe)", color: "var(--ink)", fontSize: 12 }}>
                          {item.term}
                          {canEdit && <button type="button" aria-label={`Dismiss ${item.term}`} onClick={() => setKeywordStatus(profile.base_resume_id, item.term, "dismissed")} style={{ border: 0, background: "transparent", cursor: "pointer", fontWeight: 700, padding: 0 }}>×</button>}
                        </span>
                      ))}
                      {!activeKeywords.length && <span className="muted" style={{ fontSize: 13 }}>No active keywords yet. Generate with AI or add one below.</span>}
                    </div>
                    {canEdit && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <input className="input" value={draft.newKeyword} onChange={(e) => updateDraft(profile.base_resume_id, "newKeyword", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(profile.base_resume_id); } }} placeholder="Add keyword or title" />
                      <button className="btn-secondary" type="button" onClick={() => addKeyword(profile.base_resume_id)} disabled={count >= 48}>Add</button>
                    </div>}
                    {dismissedKeywords.length > 0 && <div style={{ marginTop: 10 }}><span className="muted" style={{ fontSize: 12 }}>Dismissed ({dismissedKeywords.length})</span><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>{dismissedKeywords.map((item) => <span key={item.term} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 999, background: "var(--surface-2, #f1f5f9)", color: "var(--muted)", textDecoration: "line-through", fontSize: 12 }}>{item.term}{canEdit && <button type="button" onClick={() => setKeywordStatus(profile.base_resume_id, item.term, "active")} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, textDecoration: "none" }}>Restore</button>}</span>)}</div></div>}
                    <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>AI proposals are capped at 48 active terms. Dismissed terms remain in review history and will not be resurrected by an AI rerun.</p>
                    {profile.last_generation_error && <p className="alert alert-error" style={{ marginTop: 8, fontSize: 12 }}>{profile.last_generation_error}</p>}
                  </div>
                  <div>
                    <label>Additional rules</label>
                    <textarea
                      className="input"
                      rows={12}
                      value={draft.additionalRules}
                      onChange={(e) => updateRules(profile.base_resume_id, e.target.value)}
                      placeholder="Example: Reject roles requiring more than 5 years of experience."
                      disabled={!canEdit}
                    />
                    <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Editable ingestion rules. Last AI model: {profile.last_generation_model ?? "—"} · prompt {profile.last_generation_prompt_version ?? "—"}.</p>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
