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
  additional_rules: string;
  profile_updated_at: string | null;
};

type Draft = { keywords: string; additionalRules: string };

export default function CandidateJobSearchProfilesPage() {
  const params = useParams<{ id: string }>();
  const candidateId = params.id;
  const [candidateName, setCandidateName] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
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
        setProfiles(rows);
        setDrafts(Object.fromEntries(rows.map((p) => [p.base_resume_id, {
          keywords: p.keywords.join("\n"),
          additionalRules: p.additional_rules ?? "",
        }])));
      } catch (error: any) {
        if (!cancelled) setMessage({ kind: "error", text: error.message || "Could not load search profiles" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [candidateId]);

  function updateDraft(id: string, field: keyof Draft, value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  }

  async function save(profile: Profile) {
    const draft = drafts[profile.base_resume_id] ?? { keywords: "", additionalRules: "" };
    const keywords = draft.keywords.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    setSaving(profile.base_resume_id);
    setMessage(null);
    try {
      const res = await fetch("/api/candidates/" + candidateId + "/job-search-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseResumeId: profile.base_resume_id, keywords, additionalRules: draft.additionalRules }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save profile");
      setMessage({ kind: "success", text: "Saved " + profile.resume_name + "." });
      setProfiles((current) => current.map((row) => row.base_resume_id === profile.base_resume_id
        ? { ...row, id: data.profile.id, keywords, additional_rules: draft.additionalRules, profile_updated_at: data.profile.updated_at }
        : row));
    } catch (error: any) {
      setMessage({ kind: "error", text: error.message || "Could not save profile" });
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
        These are reviewable baseline instructions for your developer. Saving them does not run ingestion or create applications.
      </div>
      {message && <div className={"alert " + (message.kind === "error" ? "alert-error" : "alert-success")} style={{ marginBottom: 16 }}>{message.text}</div>}

      {loading ? <div className="loading-panel">Loading base resumes…</div> : profiles.length === 0 ? (
        <div className="empty-state">This active candidate has no base resumes yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {profiles.map((profile) => {
            const draft = drafts[profile.base_resume_id] ?? { keywords: "", additionalRules: "" };
            const count = draft.keywords.split(/[\n,]/).map((v) => v.trim()).filter(Boolean).length;
            return (
              <section className="card" key={profile.base_resume_id}>
                <div className="page-header" style={{ marginBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{profile.resume_name}</h2>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {profile.resume_status} · resume updated {new Date(profile.resume_updated_at).toLocaleDateString()} · {count} keywords
                    </span>
                  </div>
                  <button className="btn-primary" onClick={() => save(profile)} disabled={saving === profile.base_resume_id}>
                    {saving === profile.base_resume_id ? "Saving…" : "Save baseline"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
                  <div>
                    <label>Search keywords</label>
                    <textarea
                      className="input"
                      rows={12}
                      value={draft.keywords}
                      onChange={(e) => updateDraft(profile.base_resume_id, "keywords", e.target.value)}
                      placeholder="One title or keyword per line"
                    />
                    <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Use one title or phrase per line. Commas are also accepted.</p>
                  </div>
                  <div>
                    <label>Additional rules</label>
                    <textarea
                      className="input"
                      rows={12}
                      value={draft.additionalRules}
                      onChange={(e) => updateDraft(profile.base_resume_id, "additionalRules", e.target.value)}
                      placeholder="Example: Reject roles requiring more than 5 years of experience."
                    />
                    <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Store constraints and exclusions here for the future ingestion pipeline.</p>
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
