"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TableSkeleton } from "../Skeleton";

function initials(name: string): string {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export default function AtsScorePage() {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [baseResumes, setBaseResumes] = useState<any[]>([]);
  const [tailoredResumes, setTailoredResumes] = useState<any[]>([]);
  
  const [selectedResumeId, setSelectedResumeId] = useState("");
  const [selectedResumeType, setSelectedResumeType] = useState<"base" | "tailored" | "">("");
  const [selectedJobId, setSelectedJobId] = useState("");

  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  
  const [latestResult, setLatestResult] = useState<any>(null);
  const [viewingResult, setViewingResult] = useState<any>(null);

  const [jobSearchOpen, setJobSearchOpen] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [jobSearchResults, setJobSearchResults] = useState<any[]>([]);
  const [jobSearching, setJobSearching] = useState(false);
  const [linkingJob, setLinkingJob] = useState(false);

  useEffect(() => {
    fetch("/api/candidates?pageSize=100")
      .then(r => r.json())
      .then(d => setCandidates(d.items || []));
  }, []);

  useEffect(() => {
    if (!selectedCandidateId) {
      setBaseResumes([]);
      setTailoredResumes([]);
      setHistory([]);
      setJobs([]);
      return;
    }
    
    fetch(`/api/base-resumes?candidateId=${selectedCandidateId}`)
      .then(r => r.json())
      .then(d => setBaseResumes(Array.isArray(d) ? d : (d.data || [])));
      
    fetch(`/api/application-resume-versions?candidateId=${selectedCandidateId}`)
      .then(r => r.json())
      .then(d => setTailoredResumes(Array.isArray(d) ? d : (d.data || [])));
      
    fetch(`/api/candidates/${selectedCandidateId}`)
      .then(r => r.json())
      .then(d => {
        if (d.applications) {
          const appointedJobs = d.applications.map((app: any) => app.jobs).filter(Boolean);
          setJobs(appointedJobs);
        } else {
          setJobs([]);
        }
      });
      
    // Quick fetch for history
    loadHistory(selectedCandidateId);
  }, [selectedCandidateId]);
  
  function loadHistory(candidateId: string) {
    setLoadingHistory(true);
    fetch(`/api/ats-score/list?candidate_id=${candidateId}`)
      .then(r => r.json())
      .then(d => setHistory(d.data || []))
      .finally(() => setLoadingHistory(false));
  }

  async function handleAnalyze() {
    if (!selectedCandidateId || !selectedResumeId || !selectedResumeType) return;
    setAnalyzing(true);
    setLatestResult(null);
    try {
      const res = await fetch("/api/ats-score/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_id: selectedCandidateId,
          resume_id: selectedResumeId,
          resume_type: selectedResumeType,
          job_id: selectedJobId || null
        })
      });
      const data = await res.json();
      if (data.success) {
        setLatestResult(data.data);
        loadHistory(selectedCandidateId);
      } else {
        alert("Analysis failed: " + data.error);
      }
    } catch(err: any) {
      alert("Error: " + err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function searchJobs(query: string) {
    setJobSearchQuery(query);
    if (query.length < 2) { setJobSearchResults([]); return; }
    setJobSearching(true);
    try {
      const res = await fetch(`/api/jobs?search=${encodeURIComponent(query)}&pageSize=10`);
      const data = await res.json();
      setJobSearchResults(data.jobs || []);
    } catch {
      setJobSearchResults([]);
    } finally {
      setJobSearching(false);
    }
  }

  async function linkJobToCandidate(job: any) {
    setLinkingJob(true);
    try {
      const res = await fetch("/api/target-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: selectedCandidateId,
          jobId: job.id,
          rawDescription: job.description_text || job.title || "",
          sourceUrl: job.source_url || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to link job");
      const data = await res.json();
      setJobs((prev) => {
        const exists = prev.some((j) => j.id === job.id);
        return exists ? prev : [...prev, { id: job.id, title: job.title, company: job.company }];
      });
      setSelectedJobId(job.id);
      setJobSearchOpen(false);
      setJobSearchQuery("");
      setJobSearchResults([]);
    } catch (err: any) {
      alert("Could not link job: " + (err.message || "unknown error"));
    } finally {
      setLinkingJob(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>ATS Score Analysis & Visualization</h1>
          <div className="page-kicker">Rigorously analyze candidate resumes against job descriptions.</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        
        {/* Left Panel: Selectors */}
        <div style={{ flex: "0 0 320px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 20 }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>Configuration</h3>
          
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>Candidate</label>
            <select 
              value={selectedCandidateId} 
              onChange={e => { setSelectedCandidateId(e.target.value); setSelectedResumeId(""); setSelectedResumeType(""); }}
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)" }}
            >
              <option value="">-- Select Candidate --</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>Resume to Analyze</label>
            <select 
              value={selectedResumeId} 
              onChange={e => {
                const val = e.target.value;
                setSelectedResumeId(val);
                if (val) {
                  const isBase = baseResumes.find(b => b.id === val);
                  setSelectedResumeType(isBase ? "base" : "tailored");
                } else {
                  setSelectedResumeType("");
                }
              }}
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)" }}
              disabled={!selectedCandidateId}
            >
              <option value="">-- Select Resume --</option>
              {baseResumes.length > 0 && <optgroup label="Base Resumes">
                {baseResumes.map(br => (
                  <option key={br.id} value={br.id}>{br.name || "Untitled Base Resume"} ({new Date(br.created_at).toLocaleDateString()})</option>
                ))}
              </optgroup>}
              {tailoredResumes.length > 0 && <optgroup label="Tailored Resumes">
                {tailoredResumes.map(tr => (
                  <option key={tr.id} value={tr.id}>Tailored Resume ({new Date(tr.created_at).toLocaleDateString()})</option>
                ))}
              </optgroup>}
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>Target Job (Optional)</label>
            <select 
              value={selectedJobId} 
              onChange={e => {
                if (e.target.value === "__search__") {
                  setJobSearchOpen(true);
                  return;
                }
                setSelectedJobId(e.target.value);
              }}
              style={{ width: "100%", padding: 8, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)" }}
            >
              <option value="">-- No Job (General Analysis) --</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.title} at {j.company}</option>)}
              <option value="__search__" style={{ color: "var(--accent)", fontWeight: 600 }}>+ Search jobs...</option>
            </select>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4 }}>
              Leaving this blank will score formatting and general best practices only.
            </div>

            {jobSearchOpen && (
              <div style={{ marginTop: 10, padding: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    placeholder="Search jobs by title or company..."
                    value={jobSearchQuery}
                    onChange={(e) => searchJobs(e.target.value)}
                    style={{ flex: 1, padding: "6px 10px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" }}
                    autoFocus
                  />
                  <button onClick={() => { setJobSearchOpen(false); setJobSearchQuery(""); }} style={{ fontSize: 11, padding: "4px 8px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", color: "var(--ink)" }}>Close</button>
                </div>
                {jobSearching && <p className="muted" style={{ fontSize: 11 }}>Searching...</p>}
                {!jobSearching && jobSearchQuery.length >= 2 && jobSearchResults.length === 0 && (
                  <p className="muted" style={{ fontSize: 11 }}>No jobs found.</p>
                )}
                {jobSearchResults.length > 0 && (
                  <div style={{ maxHeight: 180, overflowY: "auto" }}>
                    {jobSearchResults.map((job: any) => (
                      <div
                        key={job.id}
                        onClick={() => !linkingJob && linkJobToCandidate(job)}
                        style={{
                          padding: "6px 8px",
                          cursor: linkingJob ? "wait" : "pointer",
                          fontSize: 12,
                          borderBottom: "1px solid var(--border)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          opacity: linkingJob ? 0.5 : 1,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>{job.title}</div>
                          <div style={{ fontSize: 10, color: "var(--ink-soft)" }}>{job.company} {job.location ? `· ${job.location}` : ""}</div>
                        </div>
                        <span style={{ fontSize: 10, color: "var(--accent)" }}>+ Add</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button 
            className="btn-primary" 
            style={{ width: "100%", padding: "10px 0", display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}
            onClick={handleAnalyze}
            disabled={!selectedResumeId || analyzing}
          >
            {analyzing ? "Analyzing with AI..." : "Run ATS Analysis"}
          </button>
        </div>

        {/* Right Panel: Latest Result & History */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24 }}>
          
          {latestResult && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24, boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
              <h2 style={{ margin: "0 0 20px 0", fontSize: 18, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>Analysis Result</h2>
              
              {(() => {
                const breakdown = typeof latestResult.deterministic_breakdown === "string" ? JSON.parse(latestResult.deterministic_breakdown) : latestResult.deterministic_breakdown;
                const narrative = typeof latestResult.narrative_feedback === "string" ? JSON.parse(latestResult.narrative_feedback) : latestResult.narrative_feedback;
                
                return (
                  <div>
                    {/* Top Stats */}
                    <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 30 }}>
                      <div style={{ 
                        width: 100, height: 100, borderRadius: "50%", 
                        background: breakdown.overallScore >= 75 ? "rgba(16, 185, 129, 0.1)" : breakdown.overallScore >= 50 ? "rgba(245, 158, 11, 0.1)" : "rgba(239, 68, 68, 0.1)",
                        border: `4px solid ${breakdown.overallScore >= 75 ? "#10B981" : breakdown.overallScore >= 50 ? "#F59E0B" : "#EF4444"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 32, fontWeight: "bold",
                        color: breakdown.overallScore >= 75 ? "#10B981" : breakdown.overallScore >= 50 ? "#F59E0B" : "#EF4444"
                      }}>
                        {breakdown.overallScore}
                      </div>
                      
                      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                        <div style={{ background: "var(--bg)", padding: 12, borderRadius: 6 }}>
                          <div style={{ fontSize: 12, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Hard Skills</div>
                          <div style={{ fontSize: 20, fontWeight: 600 }}>{breakdown.hardSkillsScore}%</div>
                        </div>
                        <div style={{ background: "var(--bg)", padding: 12, borderRadius: 6 }}>
                          <div style={{ fontSize: 12, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Experience</div>
                          <div style={{ fontSize: 20, fontWeight: 600 }}>{breakdown.experienceScore}%</div>
                        </div>
                        <div style={{ background: "var(--bg)", padding: 12, borderRadius: 6 }}>
                          <div style={{ fontSize: 12, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Education</div>
                          <div style={{ fontSize: 20, fontWeight: 600 }}>{breakdown.educationScore}%</div>
                        </div>
                        <div style={{ background: "var(--bg)", padding: 12, borderRadius: 6 }}>
                          <div style={{ fontSize: 12, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Parseability</div>
                          <div style={{ fontSize: 20, fontWeight: 600 }}>{breakdown.parseabilityScore}%</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                      <div>
                        <h4 style={{ margin: "0 0 10px 0", color: "#10B981", display: "flex", alignItems: "center", gap: 6 }}>
                          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path></svg>
                          Strengths
                        </h4>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--ink)" }}>
                          {narrative?.strengths?.map((s: string, i: number) => <li key={i} style={{ marginBottom: 6 }}>{s}</li>)}
                        </ul>
                      </div>
                      <div>
                        <h4 style={{ margin: "0 0 10px 0", color: "#F59E0B", display: "flex", alignItems: "center", gap: 6 }}>
                          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                          Suggestions
                        </h4>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--ink)" }}>
                          {narrative?.improvementSuggestions?.map((s: string, i: number) => <li key={i} style={{ marginBottom: 6 }}>{s}</li>)}
                        </ul>
                      </div>
                    </div>

                    {narrative?.missingKeywords?.length > 0 && (
                      <div style={{ marginTop: 20 }}>
                        <h4 style={{ margin: "0 0 10px 0", color: "#EF4444", fontSize: 13 }}>Missing Keywords</h4>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {narrative.missingKeywords.map((k: string, i: number) => (
                            <span key={i} style={{ background: "rgba(239, 68, 68, 0.1)", color: "#EF4444", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>
                              {k}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Evaluation History</h3>
            </div>
            
            {!selectedCandidateId ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>Select a candidate to view history.</div>
            ) : loadingHistory ? (
              <div style={{ padding: 20 }}><TableSkeleton /></div>
            ) : history.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>No past evaluations found for this candidate.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)", textAlign: "left", color: "var(--ink-soft)" }}>
                      <th style={{ padding: "12px 20px", fontWeight: 500 }}>Candidate</th>
                      <th style={{ padding: "12px 20px", fontWeight: 500 }}>Resume Type</th>
                      <th style={{ padding: "12px 20px", fontWeight: 500 }}>Target Job</th>
                      <th style={{ padding: "12px 20px", fontWeight: 500 }}>Score</th>
                      <th style={{ padding: "12px 20px", fontWeight: 500 }}>Date</th>
                      <th style={{ padding: "12px 20px", fontWeight: 500 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(item => {
                      const cand = candidates.find(c => c.id === item.candidate_id);
                      const name = cand?.name || "Unknown";
                      const narrative = typeof item.narrative_feedback === "string" ? JSON.parse(item.narrative_feedback) : item.narrative_feedback;
                      const suggestionsText = (narrative?.improvementSuggestions || []).join("\n• ");
                      const tooltipText = `Strengths:\n• ${(narrative?.strengths || []).join("\n• ")}\n\nSuggestions:\n• ${suggestionsText}`;

                      return (
                        <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "12px 20px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "var(--ink-soft)", border: "1px solid var(--border)" }}>
                                {initials(name)}
                              </div>
                              <span style={{ fontWeight: 500 }}>{name}</span>
                            </div>
                          </td>
                          <td style={{ padding: "12px 20px", color: "var(--ink-soft)", textTransform: "capitalize" }}>
                            {item.resume_type}
                          </td>
                          <td style={{ padding: "12px 20px" }}>
                            {item.job_title ? (
                              <div>
                                <div style={{ fontWeight: 500 }}>{item.job_title}</div>
                                <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{item.job_company}</div>
                              </div>
                            ) : (
                              <span style={{ color: "var(--ink-soft)", fontStyle: "italic" }}>General Analysis</span>
                            )}
                          </td>
                          <td style={{ padding: "12px 20px" }}>
                            <div 
                              title={tooltipText}
                              style={{ 
                                display: "inline-flex",
                                padding: "4px 10px", 
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "help",
                                background: item.overall_score >= 75 ? "rgba(16, 185, 129, 0.1)" : item.overall_score >= 50 ? "rgba(245, 158, 11, 0.1)" : "rgba(239, 68, 68, 0.1)",
                                color: item.overall_score >= 75 ? "#10B981" : item.overall_score >= 50 ? "#F59E0B" : "#EF4444"
                              }}
                            >
                              {item.overall_score}
                            </div>
                          </td>
                          <td style={{ padding: "12px 20px", color: "var(--ink-soft)" }}>
                            {new Date(item.created_at).toLocaleDateString()}
                          </td>
                          <td style={{ padding: "12px 20px" }}>
                            <button 
                              onClick={() => setViewingResult(item)}
                              style={{ padding: "6px 12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12, cursor: "pointer", color: "var(--ink)" }}
                            >
                              View Report
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          
        </div>
      </div>

      {/* Modal for viewing past report */}
      {viewingResult && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 32, width: "100%", maxWidth: 800, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 25px rgba(0,0,0,0.1)", position: "relative" }}>
            <button 
              onClick={() => setViewingResult(null)}
              style={{ position: "absolute", top: 20, right: 20, background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", fontSize: 24, lineHeight: 1 }}
            >
              &times;
            </button>
            <h2 style={{ margin: "0 0 24px 0", fontSize: 20, borderBottom: "1px solid var(--border)", paddingBottom: 16 }}>
              Evaluation Report
              <div style={{ fontSize: 13, color: "var(--ink-soft)", fontWeight: 400, marginTop: 4 }}>
                {viewingResult.job_title ? `Target Job: ${viewingResult.job_title}` : "General Analysis"} • {new Date(viewingResult.created_at).toLocaleDateString()}
              </div>
            </h2>
            
            {(() => {
              const breakdown = typeof viewingResult.deterministic_breakdown === "string" ? JSON.parse(viewingResult.deterministic_breakdown) : viewingResult.deterministic_breakdown;
              const narrative = typeof viewingResult.narrative_feedback === "string" ? JSON.parse(viewingResult.narrative_feedback) : viewingResult.narrative_feedback;
              
              return (
                <div>
                  {/* Top Stats */}
                  <div style={{ display: "flex", alignItems: "center", gap: 32, marginBottom: 32 }}>
                    <div style={{ 
                      width: 120, height: 120, borderRadius: "50%", 
                      background: breakdown.overallScore >= 75 ? "rgba(16, 185, 129, 0.1)" : breakdown.overallScore >= 50 ? "rgba(245, 158, 11, 0.1)" : "rgba(239, 68, 68, 0.1)",
                      border: `4px solid ${breakdown.overallScore >= 75 ? "#10B981" : breakdown.overallScore >= 50 ? "#F59E0B" : "#EF4444"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 40, fontWeight: "bold",
                      color: breakdown.overallScore >= 75 ? "#10B981" : breakdown.overallScore >= 50 ? "#F59E0B" : "#EF4444"
                    }}>
                      {breakdown.overallScore}
                    </div>
                    
                    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <div style={{ background: "var(--bg)", padding: 16, borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 12, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Hard Skills</div>
                        <div style={{ fontSize: 24, fontWeight: 600 }}>{breakdown.hardSkillsScore}%</div>
                      </div>
                      <div style={{ background: "var(--bg)", padding: 16, borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 12, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Experience</div>
                        <div style={{ fontSize: 24, fontWeight: 600 }}>{breakdown.experienceScore}%</div>
                      </div>
                      <div style={{ background: "var(--bg)", padding: 16, borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 12, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Education</div>
                        <div style={{ fontSize: 24, fontWeight: 600 }}>{breakdown.educationScore}%</div>
                      </div>
                      <div style={{ background: "var(--bg)", padding: 16, borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 12, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Parseability</div>
                        <div style={{ fontSize: 24, fontWeight: 600 }}>{breakdown.parseabilityScore}%</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
                    <div>
                      <h4 style={{ margin: "0 0 12px 0", color: "#10B981", display: "flex", alignItems: "center", gap: 6, fontSize: 15 }}>
                        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path></svg>
                        Strengths
                      </h4>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "var(--ink)", lineHeight: 1.6 }}>
                        {narrative?.strengths?.map((s: string, i: number) => <li key={i} style={{ marginBottom: 8 }}>{s}</li>)}
                      </ul>
                    </div>
                    <div>
                      <h4 style={{ margin: "0 0 12px 0", color: "#F59E0B", display: "flex", alignItems: "center", gap: 6, fontSize: 15 }}>
                        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        Suggestions
                      </h4>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "var(--ink)", lineHeight: 1.6 }}>
                        {narrative?.improvementSuggestions?.map((s: string, i: number) => <li key={i} style={{ marginBottom: 8 }}>{s}</li>)}
                      </ul>
                    </div>
                  </div>

                  {narrative?.missingKeywords?.length > 0 && (
                    <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
                      <h4 style={{ margin: "0 0 12px 0", color: "#EF4444", fontSize: 14 }}>Missing Keywords</h4>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {narrative.missingKeywords.map((k: string, i: number) => (
                          <span key={i} style={{ background: "rgba(239, 68, 68, 0.1)", color: "#EF4444", padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
