"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { exportAndDownloadResume } from "@/lib/falood/clientExport";

/* ──────────── interfaces ──────────── */

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
  certifications?: { id: string; name: string; issuer?: string; date?: string }[];
  projects?: { id: string; title: string; description?: string; bullets: { id: string; text: string }[] }[];
}

interface ApplicationResumeVersion {
  id: string;
  candidate_id: string;
  base_resume_id: string;
  target_job_id: string;
  application_id?: string;
  status: "draft" | "in_review" | "approved" | "rejected";
  content: ResumeDocument;
  fit_score?: number | null;
  recommendation?: string | null;
  source_type?: string | null;
  updated_at: string;
  created_at: string;
}

interface TargetJob {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  keywords: {
    id: string;
    keyword: string;
    evidence: "strong" | "weak" | "missing" | null;
  }[];
}

interface KeywordApproval {
  id: string;
  keyword_id: string;
  decision: "approved" | "rejected" | "pending";
}

interface ResumeSuggestion {
  id: string;
  application_id: string;
  resume_version_id: string | null;
  keyword_id: string | null;
  suggestion_type: "content_change" | "format_improvement" | "truth_warning" | "keyword_injection" | "missing_evidence";
  target_section: "summary" | "skills" | "experience" | "education" | "certifications" | "projects" | "header";
  target_subsection_id: string | null;
  original_text: string | null;
  proposed_text: string;
  ai_reasoning: string | null;
  truth_status: "verified" | "unverified" | "fabrication_risk";
  truth_check_details: string | null;
  source_evidence: string | null;
  status: "pending" | "accepted" | "rejected" | "applied";
  user_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ResumeDraft {
  id: string;
  candidate_id: string;
  base_resume_id: string | null;
  target_job_id: string;
  title: string | null;
  version_label: string | null;
  status: string;
  source_type: string | null;
  created_at: string;
  updated_at: string;
}

interface ResumeExport {
  id: string;
  application_id: string;
  resume_version_id: string;
  export_type: "docx" | "pdf" | "markdown" | "text";
  file_name: string;
  file_path: string | null;
  storage_provider: string | null;
  file_size_bytes: number | null;
  status: "created" | "failed" | "deleted";
  error: string | null;
  created_by: string | null;
  created_at: string;
}

interface Candidate {
  id: string;
  name: string;
}

interface BaseResume {
  id: string;
  candidate_id: string;
  name: string;
}

interface FaloodAction {
  type: "update_resume_document" | "create_warning";
  newContent?: ResumeDocument;
  reason?: string;
  warningType?: string;
  message?: string;
}

interface LogEntry {
  role: "user" | "assistant" | "warning";
  text: string;
}

interface ApplicationPacketRow {
  id: string;
  application_id: string;
  packet_status: "draft" | "ready_for_review" | "approved" | "sent" | "archived";
  final_resume_version_id?: string | null;
  resume_export_id?: string | null;
  cover_letter?: string | null;
  recruiter_message?: string | null;
  final_notes?: string | null;
  created_at: string;
  updated_at: string;
}

interface PacketData {
  packet: ApplicationPacketRow | null;
  checklist: Record<string, "pass" | "warning" | "missing">;
  warnings: Array<{ type: string; severity: "warning" | "block"; message: string }>;
  summary: string;
  metadata: {
    candidateName?: string;
    jobTitle?: string;
    companyName?: string;
    approvedKeywordCount: number;
    rejectedKeywordCount: number;
    acceptedSuggestionCount: number;
    draftExists: boolean;
    exportExists: boolean;
  };
}

/* ──────────── helpers ──────────── */

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function estimatePages(content: ResumeDocument): number {
  const text = JSON.stringify(content);
  // Rough heuristic: ~2800 chars ≈ 1 page for a dense resume
  return Math.max(1, Math.round((text.length / 2800) * 10) / 10);
}

function pageStatus(content: ResumeDocument): { label: string; color: string } {
  const pages = estimatePages(content);
  if (pages <= 1) return { label: `1 page — good`, color: "var(--accent)" };
  if (pages <= 1.2) return { label: `${pages.toFixed(1)} pages — close`, color: "var(--warn)" };
  return { label: `${pages.toFixed(1)} pages — over`, color: "var(--danger)" };
}

const QUICK_COMMANDS = [
  "/suggest-edits",
  "/one-page",
  "/ats-check",
  "/shorten",
  "/truth-check",
  "/export",
];

/* ──────────── component ──────────── */

export default function ApplicationResumeStudioPage() {
  const params = useParams<{ applicationResumeId: string }>();
  const applicationResumeId = params?.applicationResumeId;
  const router = useRouter();

  /* core data */
  const [appResume, setAppResume] = useState<ApplicationResumeVersion | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [targetJob, setTargetJob] = useState<TargetJob | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [baseResume, setBaseResume] = useState<BaseResume | null>(null);
  const [keywordApprovals, setKeywordApprovals] = useState<KeywordApproval[]>([]);
  const [suggestions, setSuggestions] = useState<ResumeSuggestion[]>([]);
  const [drafts, setDrafts] = useState<ResumeDraft[]>([]);
  const [buildingDraft, setBuildingDraft] = useState(false);
  const [draftPreview, setDraftPreview] = useState<ResumeDraft | null>(null);
  const [draftBuildResult, setDraftBuildResult] = useState<{ applied: number; skipped: number; warnings: string[] } | null>(null);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [exports, setExports] = useState<ResumeExport[]>([]);
  const [exportingResume, setExportingResume] = useState(false);
  const [exportOptions, setExportOptions] = useState({ atsFriendly: true, onePage: false, includeProjects: true, includeSummary: true });

  /* UI state */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [fitting, setFitting] = useState(false);
  const [creatingPacket, setCreatingPacket] = useState(false);
  const [mobileTab, setMobileTab] = useState<"job" | "editor" | "falood">("editor");

  /* editing state */
  const [draftContent, setDraftContent] = useState<ResumeDocument | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editTemp, setEditTemp] = useState<Record<string, any>>({});

  /* right pane tabs */
  const [rightTab, setRightTab] = useState<"suggestions" | "draft" | "export" | "chat" | "packet">("suggestions");

  /* packet state */
  const [packet, setPacket] = useState<PacketData | null>(null);
  const [packetLoading, setPacketLoading] = useState(false);
  const [generatingCoverLetter, setGeneratingCoverLetter] = useState(false);
  const [generatingRecruiterMessage, setGeneratingRecruiterMessage] = useState(false);
  const [savingPacket, setSavingPacket] = useState(false);

  /* Falood CLI */
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<FaloodAction | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [cliError, setCliError] = useState("");

  /* ──────────── fetch ──────────── */

  const load = useCallback(async () => {
    if (!applicationResumeId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/application-resume-versions/${applicationResumeId}`);
      if (!res.ok) throw new Error("Failed to load application resume version");
      const ar: ApplicationResumeVersion = await res.json();
      setAppResume(ar);
      setApplicationId((ar as any).application_id || (ar as any).applicationId || null);
      setDraftContent(JSON.parse(JSON.stringify(ar.content)));

      const [jobRes, baseRes, candRes, kaRes, sugRes] = await Promise.all([
        fetch(`/api/target-jobs/${ar.target_job_id}`),
        fetch(`/api/base-resumes/${ar.base_resume_id}`),
        fetch(`/api/candidates/${ar.candidate_id}`),
        fetch(`/api/keyword-approvals?candidateId=${ar.candidate_id}`),
        fetch(`/api/application-resume-versions/${applicationResumeId}/resume-suggestions`),
      ]);

      if (jobRes.ok) setTargetJob(await jobRes.json());
      if (baseRes.ok) setBaseResume(await baseRes.json());
      if (candRes.ok) setCandidate(await candRes.json());
      if (kaRes.ok) setKeywordApprovals(await kaRes.json());
      if (sugRes.ok) {
        const sugData = await sugRes.json();
        setSuggestions(sugData.suggestions ?? []);
      }
      // Load drafts
      const draftRes = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-drafts`);
      if (draftRes.ok) {
        const draftData = await draftRes.json();
        setDrafts(draftData.drafts ?? []);
      }
      // Load exports - reusing the application_id already resolved into `ar`
      // above (the GET route enriches it via application_packets, since
      // application_resume_versions has no application_id column of its own) -
      // no need for a second fetch of the same endpoint just to read the same
      // field again.
      const exportAppId = (ar as any).application_id;
      if (exportAppId) {
        const historyRes = await fetch(`/api/applications/${exportAppId}/resume-exports`);
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          setExports(historyData.exports ?? []);
        }
      }
    } catch (e: any) {
      setError(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, [applicationResumeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { if (applicationId) loadPacket(); }, [applicationId]);

  async function refreshSuggestions() {
    if (!applicationResumeId) return;
    const res = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-suggestions`);
    if (res.ok) {
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    }
  }

  /* ──────────── packet ──────────── */

  async function loadPacket() {
    if (!applicationId) return;
    setPacketLoading(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/packet`);
      if (res.ok) {
        const data = await res.json();
        setPacket(data);
      }
    } catch (e) {
      console.error("Failed to load packet", e);
    } finally {
      setPacketLoading(false);
    }
  }

  async function buildPacket() {
    if (!applicationId) return;
    setPacketLoading(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/packet/build`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setPacket(data);
      }
    } catch (e) {
      console.error("Failed to build packet", e);
    } finally {
      setPacketLoading(false);
    }
  }

  async function generateCoverLetter() {
    if (!applicationId) return;
    if (packet?.packet?.cover_letter && !confirm("This will overwrite the existing cover letter. Continue?")) return;
    setGeneratingCoverLetter(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/packet/cover-letter`, { method: "POST" });
      if (res.ok) {
        await loadPacket();
      }
    } catch (e) {
      console.error("Failed to generate cover letter", e);
    } finally {
      setGeneratingCoverLetter(false);
    }
  }

  async function generateRecruiterMessage() {
    if (!applicationId) return;
    if (packet?.packet?.recruiter_message && !confirm("This will overwrite the existing recruiter message. Continue?")) return;
    setGeneratingRecruiterMessage(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/packet/recruiter-message`, { method: "POST" });
      if (res.ok) {
        await loadPacket();
      }
    } catch (e) {
      console.error("Failed to generate recruiter message", e);
    } finally {
      setGeneratingRecruiterMessage(false);
    }
  }

  async function savePacket(updates: { cover_letter?: string; recruiter_message?: string; final_notes?: string }) {
    if (!applicationId) return;
    setSavingPacket(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/packet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) await loadPacket();
    } catch (e) {
      console.error("Failed to save packet", e);
    } finally {
      setSavingPacket(false);
    }
  }

  async function savePacketStatus(status: string) {
    if (!applicationId) return;
    try {
      const res = await fetch(`/api/applications/${applicationId}/packet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packet_status: status }),
      });
      if (res.ok) await loadPacket();
    } catch (e) {
      console.error("Failed to update packet status", e);
    }
  }

  async function approvePacket() {
    if (!applicationId) return;
    if (!packet?.packet?.resume_export_id) {
      if (!confirm("No resume export is attached to this packet. Approve anyway?")) return;
    }
    try {
      const res = await fetch(`/api/applications/${applicationId}/packet/approve`, { method: "POST" });
      if (res.ok) await loadPacket();
    } catch (e) {
      console.error("Failed to approve packet", e);
    }
  }

  async function markSent() {
    if (!applicationId) return;
    try {
      const res = await fetch(`/api/applications/${applicationId}/packet/mark-sent`, { method: "POST" });
      if (res.ok) await loadPacket();
    } catch (e) {
      console.error("Failed to mark packet as sent", e);
    }
  }

  /* ──────────── derived keyword groups ──────────── */

  const keywordGroups = useMemo(() => {
    type Keyword = NonNullable<typeof targetJob>["keywords"][number];
    if (!targetJob) return { approved: [] as Keyword[], rejected: [] as Keyword[], pending: [] as Keyword[], warnings: [] as Keyword[] };
    const approved: Keyword[] = [];
    const rejected: Keyword[] = [];
    const pending: Keyword[] = [];
    const warnings: Keyword[] = [];

    for (const k of targetJob.keywords) {
      const decision = keywordApprovals.find((ka) => ka.keyword_id === k.id)?.decision ?? "pending";
      if (decision === "approved") approved.push(k);
      else if (decision === "rejected") rejected.push(k);
      else pending.push(k);

      if (k.evidence === "missing" || k.evidence === "weak") warnings.push(k);
    }
    return { approved, rejected, pending, warnings };
  }, [targetJob, keywordApprovals]);

  /* ──────────── editing helpers ──────────── */

  const content = draftContent ?? appResume?.content;

  function startEdit(section: string, initial: any) {
    setEditingSection(section);
    setEditTemp({ ...initial });
  }

  function cancelEdit() {
    setEditingSection(null);
    setEditTemp({});
  }

  function commitEdit(section: string) {
    if (!draftContent) return;
    const next = { ...draftContent };
    switch (section) {
      case "header":
        next.header = { ...editTemp, fullName: editTemp.fullName || draftContent.header.fullName };
        break;
      case "summary":
        next.summary = { id: draftContent.summary?.id ?? uid(), text: editTemp.text ?? "" };
        break;
      case "skills":
        next.skills = editTemp.skills ?? [];
        break;
      case "experience":
        next.experience = editTemp.experience ?? [];
        break;
      case "education":
        next.education = editTemp.education ?? [];
        break;
      case "certifications":
        next.certifications = editTemp.certifications ?? [];
        break;
      case "projects":
        next.projects = editTemp.projects ?? [];
        break;
    }
    setDraftContent(next);
    setEditingSection(null);
    setEditTemp({});
  }

  /* ──────────── save / submit / export ──────────── */

  async function saveDraft() {
    if (!applicationResumeId || !draftContent) return;
    setSaveStatus("saving");
    const res = await fetch(`/api/application-resume-versions/${applicationResumeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: draftContent }),
    });
    if (res.ok) {
      const updated = await res.json();
      setAppResume(updated);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2000);
    } else {
      setSaveStatus("error");
    }
  }

  async function submitForReview() {
    if (!applicationResumeId) return;
    setSaveStatus("saving");
    const res = await fetch(`/api/application-resume-versions/${applicationResumeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_review" }),
    });
    if (res.ok) {
      const updated = await res.json();
      setAppResume(updated);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2000);
    } else {
      setSaveStatus("error");
    }
  }

  async function downloadExport(format: "pdf" | "docx") {
    if (!applicationResumeId || !content) return;
    setExporting(format);
    try {
      // Generated entirely client-side (see clientExport.tsx) - this never hits the
      // Cloudflare Worker. Download happens immediately; saving a re-downloadable
      // copy to R2 happens best-effort in the background, so a slow/failed upload
      // never blocks the user from getting their file.
      await exportAndDownloadResume(
        content,
        format,
        applicationId ? { applicationId, resumeVersionId: applicationResumeId } : undefined
      );
    } catch (err: any) {
      setError(err?.message || `${format.toUpperCase()} export failed.`);
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() { await downloadExport("pdf"); }
  async function exportDocx() { await downloadExport("docx"); }

  async function runOnePageFit() {
    if (!applicationResumeId) return;
    setFitting(true);
    try {
      const res = await fetch(`/api/application-resume-versions/${applicationResumeId}/auto-fit`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLog((prev) => [...prev, { role: "warning", text: data.error ?? "Auto-fit failed." }]);
        return;
      }
      if (data.fitsOnePage && data.actionsApplied.length === 0) {
        setLog((prev) => [...prev, { role: "assistant", text: `Already fits on one page (${data.pages} page).` }]);
        return;
      }
      setPendingAction({
        type: "update_resume_document",
        newContent: data.content,
        reason: data.actionsApplied.join("; "),
      });
      setLog((prev) => [...prev, {
        role: "assistant",
        text: data.fitsOnePage
          ? `Now fits on one page. Applied: ${data.actionsApplied.join(", ")}. Review the proposed draft and click Apply.`
          : `Still ${data.pages} pages after formatting adjustments (${data.actionsApplied.join(", ") || "none possible"}) — getting to one page from here means shortening or removing content, which needs your decision, not an automatic one.`,
      }]);
    } finally {
      setFitting(false);
    }
  }

  async function createPacket() {
    if (!appResume) return;
    setCreatingPacket(true);
    try {
      // application_packets is a 1:1 companion to an existing applications ticket.
      // Create that ticket now if one doesn't already exist for this candidate+job
      // (status "in_progress" — not a manager-assignment ticket, so any application
      // worker can create it from here).
      const targetJobRes = await fetch(`/api/target-jobs/${appResume.target_job_id}`);
      const targetJobData = targetJobRes.ok ? await targetJobRes.json() : null;
      const jobId = targetJobData?.job_id ?? targetJobData?.jobId;
      if (!jobId) {
        setError("This target job isn't linked to a job in the masterlist — add it via the jobs list first.");
        return;
      }

      const createRes = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: appResume.candidate_id, job_id: jobId, status: "in_progress" }),
      });
      const createData = await createRes.json().catch(() => ({}));
      let applicationId: string | undefined = Array.isArray(createData) ? createData[0]?.id : createData?.id;

      if (!createRes.ok && createRes.status !== 409) {
        setError(createData.error || "Failed to create application ticket for this packet.");
        return;
      }
      if (!applicationId) {
        setError(
          createRes.status === 409
            ? "An application for this job already exists for this candidate — open it from the candidate's Applications tab to attach this packet there."
            : "Could not resolve an application ticket for this packet."
        );
        return;
      }

      const res = await fetch("/api/application-packets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          candidateId: appResume.candidate_id,
          targetJobId: appResume.target_job_id,
          baseResumeId: appResume.base_resume_id,
          finalResumeVersionId: appResume.id,
        }),
      });
      if (res.ok) {
        router.push(`/candidates/${appResume.candidate_id}`);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to create packet.");
      }
    } finally {
      setCreatingPacket(false);
    }
  }

  /* ──────────── suggestions ──────────── */

  async function handleSuggestionDecision(suggestionId: string, decision: "accept" | "reject") {
    const status = decision === "accept" ? "accepted" : "rejected";
    const res = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-suggestions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: [{ id: suggestionId, status }] }),
    });
    if (res.ok) {
      await refreshSuggestions();
    }
  }

  async function generateSuggestions() {
    if (!applicationResumeId) return;
    setGeneratingSuggestions(true);
    try {
      const res = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-suggestions/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Failed to generate suggestions");
      }
    } catch (e: any) {
      setError(e.message || "Failed to generate suggestions");
    } finally {
      setGeneratingSuggestions(false);
    }
  }

  async function applySuggestionToResume(suggestionId: string) {
    if (!applicationResumeId) return;
    const res = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-suggestions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: [{ id: suggestionId, status: "accepted" }] }),
    });
    if (!res.ok) return;
    // Now apply
    const applyRes = await fetch(`/api/applications/${suggestions.find(s => s.id === suggestionId)?.application_id}/resume-suggestions/${suggestionId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_version_id: applicationResumeId }),
    });
    if (applyRes.ok) {
      await refreshSuggestions();
      // Also reload the resume content
      const arRes = await fetch(`/api/application-resume-versions/${applicationResumeId}`);
      if (arRes.ok) {
        const ar = await arRes.json();
        setAppResume(ar);
        setDraftContent(JSON.parse(JSON.stringify(ar.content)));
      }
    }
  }

  /* ──────────── draft builder ──────────── */

  async function refreshDrafts() {
    if (!applicationResumeId) return;
    const res = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-drafts`);
    if (res.ok) {
      const data = await res.json();
      setDrafts(data.drafts ?? []);
    }
  }

  async function buildDraft(mode: "new_draft" | "update_existing_draft") {
    if (!applicationResumeId) return;
    setBuildingDraft(true);
    setDraftBuildResult(null);
    setDraftPreview(null);
    setError("");
    try {
      const res = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const data = await res.json();
        setDrafts((prev) => [data.resumeVersion, ...prev]);
        setDraftPreview(data.resumeVersion);
        setDraftBuildResult({
          applied: data.appliedSuggestions?.length ?? 0,
          skipped: data.skippedSuggestions?.length ?? 0,
          warnings: data.warnings ?? [],
        });
        setRightTab("draft");
        // Refresh suggestions to show updated applied status
        const sugRes = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-suggestions`);
        if (sugRes.ok) {
          const sugData = await sugRes.json();
          setSuggestions(sugData.suggestions ?? []);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Failed to build draft");
      }
    } catch (e: any) {
      setError(e.message || "Failed to build draft");
    } finally {
      setBuildingDraft(false);
    }
  }

  async function saveDraftVersion(resumeVersionId: string, newContent: ResumeDocument) {
    const res = await fetch(`/api/application-resume-versions/${resumeVersionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent }),
    });
    if (!res.ok) {
      setError("Failed to save draft");
      return false;
    }
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus(""), 2000);
    await refreshDrafts();
    return true;
  }

  async function attachDraftToPacket(resumeVersionId: string) {
    const applicationId = appResume?.id ?? null; // appResume is the version row, not the application
    // We need to find the application ID from the resume version
    const res = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-drafts`, {
      method: "GET",
    });
    if (!res.ok) return;
    const data = await res.json();
    const appId = data.applicationId;
    if (!appId) {
      setError("No application linked to this resume version");
      return;
    }
    const attachRes = await fetch(`/api/applications/${appId}/resume-drafts/${resumeVersionId}/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (attachRes.ok) {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2000);
    } else {
      setError("Failed to attach draft to application packet");
    }
  }

  /* ──────────── export handlers ──────────── */

  async function exportResume(exportType: "docx" | "pdf" | "markdown") {
    if (!applicationResumeId) return;
    setExportingResume(true);
    setError("");
    try {
      const res = await fetch(`/api/application-resume-versions/${applicationResumeId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          export_type: exportType,
          options: exportOptions,
        }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const fileName = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `resume.${exportType}`;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 2000);
        // Refresh export history
        const draftRes = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-drafts`);
        if (draftRes.ok) {
          const draftData = await draftRes.json();
          const appId = draftData.applicationId;
          if (appId) {
            const historyRes = await fetch(`/api/applications/${appId}/resume-exports`);
            if (historyRes.ok) {
              const historyData = await historyRes.json();
              setExports(historyData.exports ?? []);
            }
          }
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || `Failed to export ${exportType.toUpperCase()}`);
      }
    } catch (e: any) {
      setError(e.message || `Failed to export ${exportType.toUpperCase()}`);
    } finally {
      setExportingResume(false);
    }
  }

  async function downloadExportById(exportId: string) {
    const draftRes = await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-drafts`);
    if (!draftRes.ok) return;
    const draftData = await draftRes.json();
    const appId = draftData.applicationId;
    if (!appId) return;
    const res = await fetch(`/api/applications/${appId}/resume-exports/${exportId}/download`);
    if (res.ok) {
      const blob = await res.blob();
      const fileName = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "resume";
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    }
  }

  /* ──────────── Falood CLI ──────────── */

  async function sendCommand(commandOrMessage: string, isCommand: boolean) {
    if (!applicationResumeId || sending) return;
    setSending(true);
    setCliError("");
    setLog((prev) => [...prev, { role: "user", text: commandOrMessage }]);

    const res = await fetch("/api/falood/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "application_resume_tailoring",
        applicationResumeId,
        candidateId: appResume?.candidate_id,
        conversationId,
        ...(isCommand ? { command: commandOrMessage } : { message: commandOrMessage }),
      }),
    });

    if (res.status === 501) {
      setSending(false);
      setLog((prev) => [
        ...prev,
        { role: "assistant", text: "AI tailoring is not yet configured" },
      ]);
      return;
    }

    const data = await res.json().catch(() => ({}));
    setSending(false);

    if (!res.ok) {
      setCliError(data.error || "Falood command failed.");
      setLog((prev) => [...prev, { role: "assistant", text: `(error) ${data.error ?? "request failed"}` }]);
      return;
    }

    setConversationId(data.conversationId);
    setLog((prev) => [...prev, { role: "assistant", text: data.message }]);
    (data.warnings ?? []).forEach((w: string) => setLog((prev) => [...prev, { role: "warning", text: w }]));
    if (data.action?.type === "update_resume_document") {
      setPendingAction(data.action);
    } else if (data.action?.type === "create_warning") {
      setLog((prev) => [...prev, { role: "warning", text: data.action.message }]);
    }
    if (isCommand && (commandOrMessage === "/suggest-edits" || commandOrMessage === "/inject-approved-keywords")) {
      generateSuggestions();
    }
  }

  async function applyPendingAction() {
    if (!pendingAction?.newContent || !applicationResumeId) return;
    setDraftContent(pendingAction.newContent);
    setPendingAction(null);
    setLog((prev) => [...prev, { role: "assistant", text: "Applied to the draft. Remember to save!" }]);
  }

  /* ──────────── render guards ──────────── */

  if (loading) {
    return (
      <div className="page">
        <div className="loading-panel">Loading application resume studio…</div>
      </div>
    );
  }

  if (error || !appResume || !content) {
    return (
      <div className="page">
        <div className="toast toast-error">{error || "Unable to load resume data."}</div>
        <button className="btn" onClick={load}>Retry</button>
      </div>
    );
  }

  const pageInfo = pageStatus(content);
  const statusBadgeClass =
    appResume.status === "approved"
      ? "badge-review-approved"
      : appResume.status === "in_review"
      ? "badge-review-pending"
      : appResume.status === "rejected"
      ? "badge-review-changes_requested"
      : "badge";

  const candidateId = appResume.candidate_id;

  /* ──────────── sub-renderers ──────────── */

  const renderKeywordBadge = (k: TargetJob["keywords"][number], crossed?: boolean) => (
    <span
      key={k.id}
      className="badge"
      style={{
        margin: "2px 4px 2px 0",
        textDecoration: crossed ? "line-through" : undefined,
        opacity: crossed ? 0.6 : 1,
        background:
          k.evidence === "missing"
            ? "#fbeaea"
            : k.evidence === "weak"
            ? "#fff3e0"
            : undefined,
        color:
          k.evidence === "missing"
            ? "var(--danger)"
            : k.evidence === "weak"
            ? "var(--warn)"
            : undefined,
      }}
      title={k.evidence ? `Evidence: ${k.evidence}` : undefined}
    >
      {k.keyword}
    </span>
  );

  /* ──────────── page ──────────── */

  return (
    <div className={`page mobile-tab-${mobileTab}`} style={{ maxWidth: 1400 }}>
      {/* Top bar */}
      <div className="page-header" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Application Resume Studio</h1>
          <div className="page-kicker" style={{ marginTop: 4 }}>
            <Link href={`/candidates/${candidateId}`}>{candidate?.name ?? "Candidate"}</Link>
            {" → "}
            <Link href={`/falood/studio/base/${appResume.base_resume_id}`}>{baseResume?.name ?? "Base Resume"}</Link>
            {" → "}
            <span>{targetJob?.title ?? "Job"}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className={`badge ${statusBadgeClass}`}>{appResume.status}</span>
          <span className="badge" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>
            Source: {(appResume.source_type ?? "Legacy").replaceAll("_", " ")}
          </span>
          <span
            className="badge"
            style={{
              background: pageInfo.color === "var(--accent)" ? "var(--accent-soft)" : pageInfo.color === "var(--warn)" ? "#fff3e0" : "#fbeaea",
              color: pageInfo.color,
            }}
          >
            {pageInfo.label}
          </span>
          {saveStatus === "saving" && <span className="muted" style={{ fontSize: 12 }}>Saving…</span>}
          {saveStatus === "saved" && <span className="form-success" style={{ fontSize: 12 }}>Saved</span>}
          {saveStatus === "error" && <span className="form-error" style={{ fontSize: 12 }}>Error</span>}
          <button className="btn" onClick={() => router.push(`/candidates/${candidateId}`)}>Save & Exit</button>
          <Link className="btn" href={`/falood/cli-editor?type=application&id=${appResume.id}`}>CLI Editor</Link>
          <button
            className="btn-primary"
            onClick={createPacket}
            disabled={appResume.status !== "approved" || creatingPacket}
            title={appResume.status !== "approved" ? "Status must be approved" : undefined}
          >
            {creatingPacket ? "Creating…" : "Create Packet"}
          </button>
        </div>
      </div>

      {/* Mobile tab switcher */}
      <div className="mobile-tabs" style={{ marginBottom: 16 }}>
        {(["job", "editor", "falood"] as const).map((t) => (
          <button
            key={t}
            className={mobileTab === t ? "btn-primary" : "btn"}
            onClick={() => setMobileTab(t)}
            style={{ flex: 1 }}
          >
            {t === "job" ? "Job" : t === "editor" ? "Editor" : "Falood"}
          </button>
        ))}
      </div>

      {/* 3-pane grid */}
      <div
        className="studio-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr 340px",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* ═══════ LEFT PANE: Job + Keywords ═══════ */}
        <div className="left-pane card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Target Job</h3>
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{targetJob?.title}</p>
            <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
              {targetJob?.company} {targetJob?.location ? `· ${targetJob.location}` : ""}
            </p>
            {appResume.fit_score !== null && appResume.fit_score !== undefined && (
              <p style={{ fontSize: 12, margin: "6px 0 0" }}>
                Fit score: <strong>{appResume.fit_score}%</strong>
              </p>
            )}
            {appResume.recommendation && (
              <span className="badge" style={{ marginTop: 6, display: "inline-block" }}>
                {appResume.recommendation}
              </span>
            )}
          </div>

          <div>
            <h4 style={{ fontSize: 12, margin: "0 0 6px", color: "var(--ink-soft)" }}>Approved keywords</h4>
            {keywordGroups.approved.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>None approved yet.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {keywordGroups.approved.map((k) => renderKeywordBadge(k))}
              </div>
            )}
          </div>

          <div>
            <h4 style={{ fontSize: 12, margin: "0 0 6px", color: "var(--ink-soft)" }}>Rejected keywords</h4>
            {keywordGroups.rejected.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>None rejected.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {keywordGroups.rejected.map((k) => renderKeywordBadge(k, true))}
              </div>
            )}
          </div>

          <div>
            <h4 style={{ fontSize: 12, margin: "0 0 6px", color: "var(--ink-soft)" }}>Pending keywords</h4>
            {keywordGroups.pending.length === 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>No pending keywords.</p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {keywordGroups.pending.map((k) => renderKeywordBadge(k))}
              </div>
            )}
          </div>

          {keywordGroups.warnings.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <h4 style={{ fontSize: 12, margin: "0 0 6px", color: "var(--danger)" }}>⚠ Evidence warnings</h4>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {keywordGroups.warnings.map((k) => renderKeywordBadge(k))}
              </div>
            </div>
          )}
        </div>

        {/* ═══════ CENTER PANE: Resume Editor ═══════ */}
        <div className="center-pane card" style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>Resume Editor</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={saveDraft}>Save Draft</button>
              <button className="btn" onClick={submitForReview} disabled={appResume.status === "in_review" || appResume.status === "approved"}>
                Submit for Review
              </button>
              <button className="btn" onClick={runOnePageFit} disabled={fitting}>
                {fitting ? "Fitting…" : "Fit to One Page"}
              </button>
              <button className="btn" onClick={exportPdf} disabled={exporting === "pdf"}>
                {exporting === "pdf" ? "Exporting…" : "Export PDF"}
              </button>
              <button className="btn" onClick={exportDocx} disabled={exporting === "docx"}>
                {exporting === "docx" ? "Exporting…" : "Export DOCX"}
              </button>
            </div>
          </div>

          {/* Page break indicator */}
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              top: 52 + 1050, // approximate 1-page mark in px
              borderTop: "2px dashed var(--border)",
              pointerEvents: "none",
            }}
            title="Approximate 1-page boundary"
          />

          {/* HEADER */}
          <div style={{ marginBottom: 16 }}>
            {editingSection === "header" ? (
              <div className="field-group">
                <input value={editTemp.fullName ?? ""} onChange={(e) => setEditTemp({ ...editTemp, fullName: e.target.value })} placeholder="Full name" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  <input value={editTemp.location ?? ""} onChange={(e) => setEditTemp({ ...editTemp, location: e.target.value })} placeholder="Location" />
                  <input value={editTemp.phone ?? ""} onChange={(e) => setEditTemp({ ...editTemp, phone: e.target.value })} placeholder="Phone" />
                  <input value={editTemp.email ?? ""} onChange={(e) => setEditTemp({ ...editTemp, email: e.target.value })} placeholder="Email" />
                  <input value={editTemp.linkedin ?? ""} onChange={(e) => setEditTemp({ ...editTemp, linkedin: e.target.value })} placeholder="LinkedIn" />
                  <input value={editTemp.github ?? ""} onChange={(e) => setEditTemp({ ...editTemp, github: e.target.value })} placeholder="GitHub" />
                  <input value={editTemp.portfolio ?? ""} onChange={(e) => setEditTemp({ ...editTemp, portfolio: e.target.value })} placeholder="Portfolio" />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-primary" onClick={() => commitEdit("header")}>Save</button>
                  <button className="btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => startEdit("header", content.header)} style={{ cursor: "pointer" }}>
                <h2 style={{ margin: "0 0 4px" }}>{content.header.fullName}</h2>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  {[content.header.location, content.header.phone, content.header.email, content.header.linkedin, content.header.portfolio].filter(Boolean).join(" · ")}
                </p>
              </div>
            )}
          </div>

          {/* SUMMARY */}
          <div style={{ marginBottom: 16 }}>
            {editingSection === "summary" ? (
              <div className="field-group">
                <textarea
                  rows={4}
                  value={editTemp.text ?? ""}
                  onChange={(e) => setEditTemp({ text: e.target.value })}
                  placeholder="Professional summary…"
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-primary" onClick={() => commitEdit("summary")}>Save</button>
                  <button className="btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => startEdit("summary", { text: content.summary?.text ?? "" })} style={{ cursor: "pointer" }}>
                <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{content.summary?.text ?? <span className="muted">No summary — click to add</span>}</p>
              </div>
            )}
          </div>

          {/* SKILLS */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, margin: "0 0 8px" }}>Technical Skills</h4>
            {editingSection === "skills" ? (
              <div>
                {(editTemp.skills ?? []).map((s: any, idx: number) => (
                  <div key={s.id} style={{ marginBottom: 8, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                    <input
                      value={s.title}
                      onChange={(e) => {
                        const next = [...(editTemp.skills ?? [])];
                        next[idx] = { ...s, title: e.target.value };
                        setEditTemp({ ...editTemp, skills: next });
                      }}
                      placeholder="Category title"
                      style={{ marginBottom: 6 }}
                    />
                    <input
                      value={s.skills.join(", ")}
                      onChange={(e) => {
                        const next = [...(editTemp.skills ?? [])];
                        next[idx] = { ...s, skills: e.target.value.split(",").map((x: string) => x.trim()).filter(Boolean) };
                        setEditTemp({ ...editTemp, skills: next });
                      }}
                      placeholder="Comma-separated skills"
                    />
                    <button
                      className="btn-danger btn-compact"
                      style={{ marginTop: 6 }}
                      onClick={() => {
                        const next = (editTemp.skills ?? []).filter((_: any, i: number) => i !== idx);
                        setEditTemp({ ...editTemp, skills: next });
                      }}
                    >
                      Remove category
                    </button>
                  </div>
                ))}
                <button
                  className="btn btn-compact"
                  onClick={() =>
                    setEditTemp({
                      ...editTemp,
                      skills: [...(editTemp.skills ?? []), { id: uid(), title: "", skills: [] }],
                    })
                  }
                >
                  + Add category
                </button>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-primary" onClick={() => commitEdit("skills")}>Save</button>
                  <button className="btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => startEdit("skills", { skills: content.skills })} style={{ cursor: "pointer" }}>
                {content.skills.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>No skills — click to add</p>
                ) : (
                  content.skills.map((s) => (
                    <p key={s.id} style={{ fontSize: 12, margin: "2px 0" }}>
                      <strong>{s.title}:</strong> {s.skills.join(", ")}
                    </p>
                  ))
                )}
              </div>
            )}
          </div>

          {/* EXPERIENCE */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, margin: "0 0 8px" }}>Professional Experience</h4>
            {editingSection === "experience" ? (
              <div>
                {(editTemp.experience ?? []).map((exp: any, idx: number) => (
                  <div key={exp.id} style={{ marginBottom: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                      <input value={exp.title} onChange={(e) => { const next = [...(editTemp.experience ?? [])]; next[idx] = { ...exp, title: e.target.value }; setEditTemp({ ...editTemp, experience: next }); }} placeholder="Title" />
                      <input value={exp.company} onChange={(e) => { const next = [...(editTemp.experience ?? [])]; next[idx] = { ...exp, company: e.target.value }; setEditTemp({ ...editTemp, experience: next }); }} placeholder="Company" />
                      <input value={exp.location ?? ""} onChange={(e) => { const next = [...(editTemp.experience ?? [])]; next[idx] = { ...exp, location: e.target.value }; setEditTemp({ ...editTemp, experience: next }); }} placeholder="Location" />
                      <div style={{ display: "flex", gap: 8 }}>
                        <input value={exp.startDate} onChange={(e) => { const next = [...(editTemp.experience ?? [])]; next[idx] = { ...exp, startDate: e.target.value }; setEditTemp({ ...editTemp, experience: next }); }} placeholder="Start" />
                        <input value={exp.endDate ?? ""} onChange={(e) => { const next = [...(editTemp.experience ?? [])]; next[idx] = { ...exp, endDate: e.target.value || undefined }; setEditTemp({ ...editTemp, experience: next }); }} placeholder="End (or blank)" />
                      </div>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      {(exp.bullets ?? []).map((b: any, bIdx: number) => (
                        <div key={b.id} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                          <input
                            style={{ flex: 1 }}
                            value={b.text}
                            onChange={(e) => {
                              const next = [...(editTemp.experience ?? [])];
                              const bullets = [...(exp.bullets ?? [])];
                              bullets[bIdx] = { ...b, text: e.target.value };
                              next[idx] = { ...exp, bullets };
                              setEditTemp({ ...editTemp, experience: next });
                            }}
                            placeholder="Bullet point"
                          />
                          <button
                            className="btn-danger btn-compact"
                            onClick={() => {
                              const next = [...(editTemp.experience ?? [])];
                              const bullets = (exp.bullets ?? []).filter((_: any, i: number) => i !== bIdx);
                              next[idx] = { ...exp, bullets };
                              setEditTemp({ ...editTemp, experience: next });
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        className="btn btn-compact"
                        onClick={() => {
                          const next = [...(editTemp.experience ?? [])];
                          const bullets = [...(exp.bullets ?? []), { id: uid(), text: "" }];
                          next[idx] = { ...exp, bullets };
                          setEditTemp({ ...editTemp, experience: next });
                        }}
                      >
                        + Bullet
                      </button>
                    </div>
                    <button
                      className="btn-danger btn-compact"
                      onClick={() => {
                        const next = (editTemp.experience ?? []).filter((_: any, i: number) => i !== idx);
                        setEditTemp({ ...editTemp, experience: next });
                      }}
                    >
                      Remove entry
                    </button>
                  </div>
                ))}
                <button
                  className="btn btn-compact"
                  onClick={() =>
                    setEditTemp({
                      ...editTemp,
                      experience: [
                        ...(editTemp.experience ?? []),
                        { id: uid(), title: "", company: "", startDate: "", bullets: [] },
                      ],
                    })
                  }
                >
                  + Add experience
                </button>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-primary" onClick={() => commitEdit("experience")}>Save</button>
                  <button className="btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => startEdit("experience", { experience: content.experience })} style={{ cursor: "pointer" }}>
                {content.experience.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>No experience — click to add</p>
                ) : (
                  content.experience.map((exp) => (
                    <div key={exp.id} style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>
                        {exp.title} — {exp.company} {exp.location ? `(${exp.location})` : ""}
                      </p>
                      <p className="muted" style={{ fontSize: 11, margin: "2px 0 4px" }}>
                        {exp.startDate} – {exp.endDate ?? "Present"}
                      </p>
                      <ul style={{ fontSize: 12, margin: 0, paddingLeft: 16 }}>
                        {exp.bullets.map((b) => (
                          <li key={b.id}>{b.text}</li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* PROJECTS */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, margin: "0 0 8px" }}>Projects</h4>
            {editingSection === "projects" ? (
              <div>
                {(editTemp.projects ?? []).map((proj: any, idx: number) => (
                  <div key={proj.id} style={{ marginBottom: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 6 }}>
                    <input value={proj.title} onChange={(e) => { const next = [...(editTemp.projects ?? [])]; next[idx] = { ...proj, title: e.target.value }; setEditTemp({ ...editTemp, projects: next }); }} placeholder="Project title" style={{ marginBottom: 6 }} />
                    <input value={proj.description ?? ""} onChange={(e) => { const next = [...(editTemp.projects ?? [])]; next[idx] = { ...proj, description: e.target.value }; setEditTemp({ ...editTemp, projects: next }); }} placeholder="Description (optional)" />
                    <div style={{ marginTop: 6 }}>
                      {(proj.bullets ?? []).map((b: any, bIdx: number) => (
                        <div key={b.id} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                          <input style={{ flex: 1 }} value={b.text} onChange={(e) => { const next = [...(editTemp.projects ?? [])]; const bullets = [...(proj.bullets ?? [])]; bullets[bIdx] = { ...b, text: e.target.value }; next[idx] = { ...proj, bullets }; setEditTemp({ ...editTemp, projects: next }); }} placeholder="Bullet point" />
                          <button className="btn-danger btn-compact" onClick={() => { const next = [...(editTemp.projects ?? [])]; const bullets = (proj.bullets ?? []).filter((_: any, i: number) => i !== bIdx); next[idx] = { ...proj, bullets }; setEditTemp({ ...editTemp, projects: next }); }}>×</button>
                        </div>
                      ))}
                      <button className="btn btn-compact" onClick={() => { const next = [...(editTemp.projects ?? [])]; const bullets = [...(proj.bullets ?? []), { id: uid(), text: "" }]; next[idx] = { ...proj, bullets }; setEditTemp({ ...editTemp, projects: next }); }}>+ Bullet</button>
                    </div>
                    <button className="btn-danger btn-compact" style={{ marginTop: 6 }} onClick={() => { const next = (editTemp.projects ?? []).filter((_: any, i: number) => i !== idx); setEditTemp({ ...editTemp, projects: next }); }}>Remove project</button>
                  </div>
                ))}
                <button className="btn btn-compact" onClick={() => setEditTemp({ ...editTemp, projects: [...(editTemp.projects ?? []), { id: uid(), title: "", bullets: [] }] })}>+ Add project</button>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-primary" onClick={() => commitEdit("projects")}>Save</button>
                  <button className="btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => startEdit("projects", { projects: content.projects ?? [] })} style={{ cursor: "pointer" }}>
                {(content.projects ?? []).length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>No projects — click to add</p>
                ) : (
                  (content.projects ?? []).map((proj) => (
                    <div key={proj.id} style={{ marginBottom: 8 }}>
                      <p style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>{proj.title}</p>
                      {proj.description && <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>{proj.description}</p>}
                      <ul style={{ fontSize: 12, margin: "4px 0 0", paddingLeft: 16 }}>
                        {proj.bullets.map((b) => <li key={b.id}>{b.text}</li>)}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* EDUCATION */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, margin: "0 0 8px" }}>Education</h4>
            {editingSection === "education" ? (
              <div>
                {(editTemp.education ?? []).map((edu: any, idx: number) => (
                  <div key={edu.id} style={{ marginBottom: 8, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input value={edu.degree} onChange={(e) => { const next = [...(editTemp.education ?? [])]; next[idx] = { ...edu, degree: e.target.value }; setEditTemp({ ...editTemp, education: next }); }} placeholder="Degree" />
                      <input value={edu.school} onChange={(e) => { const next = [...(editTemp.education ?? [])]; next[idx] = { ...edu, school: e.target.value }; setEditTemp({ ...editTemp, education: next }); }} placeholder="School" />
                      <input value={edu.graduationDate ?? ""} onChange={(e) => { const next = [...(editTemp.education ?? [])]; next[idx] = { ...edu, graduationDate: e.target.value || undefined }; setEditTemp({ ...editTemp, education: next }); }} placeholder="Graduation date" />
                    </div>
                    <button className="btn-danger btn-compact" style={{ marginTop: 6 }} onClick={() => { const next = (editTemp.education ?? []).filter((_: any, i: number) => i !== idx); setEditTemp({ ...editTemp, education: next }); }}>Remove</button>
                  </div>
                ))}
                <button className="btn btn-compact" onClick={() => setEditTemp({ ...editTemp, education: [...(editTemp.education ?? []), { id: uid(), degree: "", school: "" }] })}>+ Add education</button>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-primary" onClick={() => commitEdit("education")}>Save</button>
                  <button className="btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => startEdit("education", { education: content.education })} style={{ cursor: "pointer" }}>
                {content.education.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>No education — click to add</p>
                ) : (
                  content.education.map((edu) => (
                    <p key={edu.id} style={{ fontSize: 12, margin: "2px 0" }}>
                      {edu.degree} — {edu.school} {edu.graduationDate ? `(${edu.graduationDate})` : ""}
                    </p>
                  ))
                )}
              </div>
            )}
          </div>

          {/* CERTIFICATIONS */}
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, margin: "0 0 8px" }}>Certifications</h4>
            {editingSection === "certifications" ? (
              <div>
                {(editTemp.certifications ?? []).map((cert: any, idx: number) => (
                  <div key={cert.id} style={{ marginBottom: 8, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input value={cert.name} onChange={(e) => { const next = [...(editTemp.certifications ?? [])]; next[idx] = { ...cert, name: e.target.value }; setEditTemp({ ...editTemp, certifications: next }); }} placeholder="Certification name" />
                      <input value={cert.issuer ?? ""} onChange={(e) => { const next = [...(editTemp.certifications ?? [])]; next[idx] = { ...cert, issuer: e.target.value }; setEditTemp({ ...editTemp, certifications: next }); }} placeholder="Issuer" />
                      <input value={cert.date ?? ""} onChange={(e) => { const next = [...(editTemp.certifications ?? [])]; next[idx] = { ...cert, date: e.target.value }; setEditTemp({ ...editTemp, certifications: next }); }} placeholder="Date" />
                    </div>
                    <button className="btn-danger btn-compact" style={{ marginTop: 6 }} onClick={() => { const next = (editTemp.certifications ?? []).filter((_: any, i: number) => i !== idx); setEditTemp({ ...editTemp, certifications: next }); }}>Remove</button>
                  </div>
                ))}
                <button className="btn btn-compact" onClick={() => setEditTemp({ ...editTemp, certifications: [...(editTemp.certifications ?? []), { id: uid(), name: "" }] })}>+ Add certification</button>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-primary" onClick={() => commitEdit("certifications")}>Save</button>
                  <button className="btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div onClick={() => startEdit("certifications", { certifications: content.certifications ?? [] })} style={{ cursor: "pointer" }}>
                {(content.certifications ?? []).length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>No certifications — click to add</p>
                ) : (
                  (content.certifications ?? []).map((cert) => (
                    <p key={cert.id} style={{ fontSize: 12, margin: "2px 0" }}>
                      {cert.name} {cert.issuer ? `— ${cert.issuer}` : ""} {cert.date ? `(${cert.date})` : ""}
                    </p>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* ═══════ RIGHT PANE: Falood ═══════ */}
        <div className="right-pane card" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            <button className={rightTab === "suggestions" ? "btn-primary" : "btn"} onClick={() => setRightTab("suggestions")} style={{ flex: 1 }}>
              Suggestions
            </button>
            <button className={rightTab === "draft" ? "btn-primary" : "btn"} onClick={() => setRightTab("draft")} style={{ flex: 1 }}>
              Draft
            </button>
            <button className={rightTab === "export" ? "btn-primary" : "btn"} onClick={() => setRightTab("export")} style={{ flex: 1 }}>
              Export
            </button>
            <button className={rightTab === "chat" ? "btn-primary" : "btn"} onClick={() => setRightTab("chat")} style={{ flex: 1 }}>
              Chat
            </button>
            <button className={rightTab === "packet" ? "btn-primary" : "btn"} onClick={() => setRightTab("packet")} style={{ flex: 1 }}>
              Packet
            </button>
          </div>

          {rightTab === "suggestions" ? (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                <button
                  className="btn-primary btn-compact"
                  onClick={generateSuggestions}
                  disabled={generatingSuggestions}
                  style={{ flex: 1, minWidth: 120 }}
                >
                  {generatingSuggestions ? "Generating…" : "Generate Suggestions"}
                </button>
                <button className="btn btn-compact" onClick={refreshSuggestions} disabled={generatingSuggestions}>
                  Refresh
                </button>
              </div>

              {suggestions.length === 0 ? (
                <p className="muted" style={{ fontSize: 12 }}>
                  {generatingSuggestions
                    ? "AI is analyzing approved keywords and generating suggestions…"
                    : "No suggestions yet. Generate suggestions after approving keywords in the JD Keywords panel."}
                </p>
              ) : (
                suggestions.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      marginBottom: 10,
                      padding: 10,
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                      background: s.truth_status === "fabrication_risk" ? "#fef2f2" : undefined,
                    }}
                  >
                    <div style={{ marginBottom: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="badge" style={{ fontSize: 10, textTransform: "capitalize" }}>
                        {s.target_section}
                      </span>
                      <span
                        className="badge"
                        style={{
                          fontSize: 10,
                          textTransform: "capitalize",
                          background:
                            s.suggestion_type === "keyword_injection"
                              ? "#e0f2fe"
                              : s.suggestion_type === "truth_warning"
                              ? "#fef2f2"
                              : s.suggestion_type === "missing_evidence"
                              ? "#fff7ed"
                              : s.suggestion_type === "format_improvement"
                              ? "#f0fdf4"
                              : "#eef1f5",
                          color:
                            s.suggestion_type === "keyword_injection"
                              ? "#0369a1"
                              : s.suggestion_type === "truth_warning"
                              ? "var(--danger)"
                              : s.suggestion_type === "missing_evidence"
                              ? "#c2410c"
                              : s.suggestion_type === "format_improvement"
                              ? "#15803d"
                              : "#4a5568",
                        }}
                      >
                        {s.suggestion_type.replace("_", " ")}
                      </span>
                      <span
                        className="badge"
                        style={{
                          fontSize: 10,
                          background:
                            s.truth_status === "verified"
                              ? "#f0fdf4"
                              : s.truth_status === "fabrication_risk"
                              ? "#fef2f2"
                              : "#fffbeb",
                          color:
                            s.truth_status === "verified"
                              ? "#15803d"
                              : s.truth_status === "fabrication_risk"
                              ? "var(--danger)"
                              : "#a16207",
                        }}
                      >
                        {s.truth_status === "verified" ? "✓ Verified" : s.truth_status === "fabrication_risk" ? "⚠ Fabrication Risk" : "? Unverified"}
                      </span>
                      {s.status !== "pending" && (
                        <span className="badge" style={{ fontSize: 10, background: "#e2e8f0", color: "#475569" }}>
                          {s.status}
                        </span>
                      )}
                    </div>
                    {s.original_text && (
                      <p style={{ margin: "4px 0", textDecoration: "line-through", color: "var(--ink-soft)" }}>
                        {s.original_text}
                      </p>
                    )}
                    <p style={{ margin: "4px 0", fontWeight: 600 }}>{s.proposed_text}</p>
                    {s.ai_reasoning && <p className="muted" style={{ margin: "4px 0" }}>{s.ai_reasoning}</p>}
                    {s.source_evidence && (
                      <p style={{ margin: "4px 0", fontSize: 11, color: "#15803d" }}>
                        <strong>Evidence:</strong> {s.source_evidence}
                      </p>
                    )}
                    {s.truth_check_details && s.truth_status === "fabrication_risk" && (
                      <p style={{ margin: "4px 0", fontSize: 11, color: "var(--danger)" }}>
                        <strong>Truth check:</strong> {s.truth_check_details}
                      </p>
                    )}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      <button
                        className="btn-primary btn-compact"
                        onClick={() => applySuggestionToResume(s.id)}
                        disabled={s.status !== "pending" || s.suggestion_type === "truth_warning" || s.suggestion_type === "missing_evidence"}
                      >
                        Accept & Apply
                      </button>
                      <button className="btn btn-compact" onClick={() => handleSuggestionDecision(s.id, "accept")} disabled={s.status !== "pending"}>
                        Accept Only
                      </button>
                      <button className="btn btn-compact" onClick={() => handleSuggestionDecision(s.id, "reject")} disabled={s.status !== "pending"}>
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : rightTab === "draft" ? (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {/* Draft info */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                  <span className="badge" style={{ fontSize: 10, textTransform: "capitalize" }}>
                    Source: {appResume?.source_type ?? "base_resume"}
                  </span>
                  <span className="badge" style={{ fontSize: 10 }}>
                    {drafts.filter((d) => d.status === "draft").length} draft(s)
                  </span>
                  <span className="badge" style={{ fontSize: 10, background: "#f0fdf4", color: "#15803d" }}>
                    {suggestions.filter((s) => s.status === "accepted").length} accepted
                  </span>
                </div>

                {suggestions.filter((s) => s.status === "accepted" && s.truth_status === "fabrication_risk").length > 0 && (
                  <div style={{ padding: 8, border: "1px solid var(--danger)", borderRadius: 6, background: "#fef2f2", marginBottom: 8 }}>
                    <p style={{ fontSize: 12, color: "var(--danger)", margin: 0 }}>
                      ⚠ {suggestions.filter((s) => s.status === "accepted" && s.truth_status === "fabrication_risk").length} accepted suggestion(s) have fabrication risk. Review before building.
                    </p>
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  <button
                    className="btn-primary btn-compact"
                    onClick={() => buildDraft("new_draft")}
                    disabled={buildingDraft}
                    style={{ flex: 1, minWidth: 120 }}
                  >
                    {buildingDraft ? "Building…" : "Build New Draft"}
                  </button>
                  <button className="btn btn-compact" onClick={() => buildDraft("update_existing_draft")} disabled={buildingDraft}>
                    Update Current Draft
                  </button>
                </div>

                {draftBuildResult && (
                  <div style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 6, background: "var(--accent-soft)", marginBottom: 10 }}>
                    <p style={{ fontSize: 12, margin: "0 0 4px" }}>
                      <strong>Draft built:</strong> {draftBuildResult.applied} applied, {draftBuildResult.skipped} skipped
                    </p>
                    {draftBuildResult.warnings.length > 0 && (
                      <div>
                        <p style={{ fontSize: 11, margin: "4px 0 0", color: "var(--danger)" }}>Warnings:</p>
                        {draftBuildResult.warnings.map((w, i) => (
                          <p key={i} style={{ fontSize: 11, margin: "2px 0", color: "var(--danger)" }}>• {w}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Draft list */}
              {drafts.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Existing Drafts</p>
                  {drafts.map((d) => (
                    <div
                      key={d.id}
                      style={{
                        padding: 8,
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        marginBottom: 6,
                        fontSize: 12,
                        cursor: "pointer",
                        background: draftPreview?.id === d.id ? "var(--accent-soft)" : "transparent",
                      }}
                      onClick={() => setDraftPreview(d.id === draftPreview?.id ? null : d)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 600 }}>{d.title ?? "Untitled Draft"}</span>
                        <span className="badge" style={{ fontSize: 10 }}>{d.status}</span>
                      </div>
                      <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                        {d.version_label ?? "draft"} — {new Date(d.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Draft preview / editor */}
              {draftPreview && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, marginBottom: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 8px" }}>
                    Draft Preview: {draftPreview.title ?? "Untitled"}
                  </p>
                  <p style={{ fontSize: 11, margin: "0 0 8px", color: "var(--ink-soft)" }}>
                    Diff review will come in the export/finalization chunk.
                  </p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    <button
                      className="btn-primary btn-compact"
                      onClick={() => attachDraftToPacket(draftPreview.id)}
                    >
                      Attach to Packet
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : rightTab === "export" ? (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 8px" }}>Export Resume</p>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                  <span className="badge" style={{ fontSize: 10, textTransform: "capitalize" }}>
                    Source: {appResume?.source_type ?? "base_resume"}
                  </span>
                  <span className="badge" style={{ fontSize: 10 }}>
                    {exports.length} export(s)
                  </span>
                </div>

                {/* Export options */}
                <div style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Options</p>
                  <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    <input type="checkbox" checked={exportOptions.atsFriendly} onChange={(e) => setExportOptions((o) => ({ ...o, atsFriendly: e.target.checked }))} />
                    ATS-friendly (remove buzzwords)
                  </label>
                  <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    <input type="checkbox" checked={exportOptions.includeSummary} onChange={(e) => setExportOptions((o) => ({ ...o, includeSummary: e.target.checked }))} />
                    Include summary
                  </label>
                  <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                    <input type="checkbox" checked={exportOptions.includeProjects} onChange={(e) => setExportOptions((o) => ({ ...o, includeProjects: e.target.checked }))} />
                    Include projects
                  </label>
                </div>

                {/* Export buttons */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  <button className="btn-primary btn-compact" onClick={() => exportResume("docx")} disabled={exportingResume} style={{ flex: 1, minWidth: 100 }}>
                    {exportingResume ? "Exporting…" : "Export DOCX"}
                  </button>
                  <button className="btn btn-compact" onClick={() => exportResume("pdf")} disabled={exportingResume} style={{ flex: 1, minWidth: 100 }}>
                    Export PDF
                  </button>
                  <button className="btn btn-compact" onClick={() => exportResume("markdown")} disabled={exportingResume} style={{ flex: 1, minWidth: 100 }}>
                    Preview Markdown
                  </button>
                </div>
              </div>

              {/* Export history */}
              {exports.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Export History</p>
                  {exports.map((ex) => (
                    <div
                      key={ex.id}
                      style={{
                        padding: 8,
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        marginBottom: 6,
                        fontSize: 12,
                        background: ex.status === "failed" ? "#fef2f2" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 600, textTransform: "uppercase" }}>{ex.export_type}</span>
                        <span className="badge" style={{ fontSize: 10, background: ex.status === "failed" ? "#fecaca" : "#e2e8f0", color: ex.status === "failed" ? "var(--danger)" : "#475569" }}>
                          {ex.status}
                        </span>
                      </div>
                      <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                        {ex.file_name} {ex.file_size_bytes ? `(${(ex.file_size_bytes / 1024).toFixed(1)} KB)` : ""}
                      </p>
                      <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                        {new Date(ex.created_at).toLocaleDateString()} {new Date(ex.created_at).toLocaleTimeString()}
                      </p>
                      {ex.status === "failed" && ex.error && (
                        <p style={{ fontSize: 11, color: "var(--danger)", margin: "4px 0 0" }}>{ex.error}</p>
                      )}
                      {ex.status !== "failed" && (
                        <button className="btn btn-compact" style={{ marginTop: 6 }} onClick={() => downloadExportById(ex.id)}>
                          Download
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : rightTab === "packet" ? (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {packetLoading && <p className="muted" style={{ fontSize: 12 }}>Loading packet…</p>}
              {!packetLoading && !packet && (
                <div>
                  <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                    No packet found for this application. Build a packet to get started.
                  </p>
                  <button className="btn-primary btn-compact" onClick={buildPacket} disabled={packetLoading}>
                    {packetLoading ? "Building…" : "Build Packet"}
                  </button>
                </div>
              )}
              {packet && (
                <div>
                  {/* Status Badge */}
                  <div style={{ marginBottom: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="badge" style={{
                      fontSize: 10,
                      background: packet.packet?.packet_status === "approved" ? "#f0fdf4"
                        : packet.packet?.packet_status === "sent" ? "#e0f2fe"
                        : packet.packet?.packet_status === "ready_for_review" ? "#fffbeb"
                        : "#e2e8f0",
                      color: packet.packet?.packet_status === "approved" ? "#15803d"
                        : packet.packet?.packet_status === "sent" ? "#0369a1"
                        : packet.packet?.packet_status === "ready_for_review" ? "#a16207"
                        : "#475569",
                    }}>
                      {packet.packet?.packet_status?.replace(/_/g, " ") ?? "draft"}
                    </span>
                  </div>

                  {/* Selected Resume Draft */}
                  {packet.packet?.final_resume_version_id && (
                    <div style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 4px" }}>Selected Resume Draft</p>
                      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                        Version ID: {packet.packet.final_resume_version_id}
                      </p>
                      <Link href={`/falood/studio/application/${packet.packet.final_resume_version_id}`} style={{ fontSize: 11 }}>
                        View draft →
                      </Link>
                    </div>
                  )}

                  {/* Latest Export */}
                  {packet.packet?.resume_export_id && (
                    <div style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 4px" }}>Latest Export</p>
                      <button className="btn btn-compact" onClick={() => downloadExportById(packet.packet!.resume_export_id!)}>
                        Download Export
                      </button>
                    </div>
                  )}

                  {/* Checklist */}
                  <div style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Checklist</p>
                    {Object.entries(packet.checklist).map(([key, status]) => (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 12 }}>
                        <span style={{
                          color: status === "pass" ? "#15803d" : status === "warning" ? "#a16207" : "var(--danger)",
                          fontWeight: 600,
                        }}>
                          {status === "pass" ? "✓" : status === "warning" ? "⚠" : "✗"}
                        </span>
                        <span style={{ textTransform: "capitalize" }}>{key.replace(/([A-Z])/g, " $1").trim()}</span>
                      </div>
                    ))}
                  </div>

                  {/* Warnings */}
                  {packet.warnings.length > 0 && (
                    <div style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Warnings</p>
                      {packet.warnings.map((w, i) => (
                        <div key={i} style={{
                          marginBottom: 4,
                          padding: 6,
                          borderRadius: 4,
                          background: w.severity === "block" ? "#fef2f2" : "#fffbeb",
                          fontSize: 12,
                          color: w.severity === "block" ? "var(--danger)" : "#a16207",
                        }}>
                          <strong>{w.type}:</strong> {w.message}
                        </div>
                      ))}
                      {packet.warnings.some((w) => w.severity === "block") && (
                        <p style={{ fontSize: 11, color: "var(--danger)", margin: "6px 0 0", fontWeight: 600 }}>
                          Cannot approve — resolve block-level warnings first.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Cover Letter Editor */}
                  <div style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Cover Letter</p>
                    <textarea
                      value={packet.packet?.cover_letter ?? ""}
                      onChange={(e) => {
                        if (!packet) return;
                        setPacket({
                          ...packet,
                          packet: packet.packet ? { ...packet.packet, cover_letter: e.target.value } : null,
                        });
                      }}
                      placeholder="Enter or generate cover letter…"
                      rows={4}
                      style={{ width: "100%", fontSize: 12, marginBottom: 6 }}
                    />
                    <button
                      className="btn btn-compact"
                      onClick={generateCoverLetter}
                      disabled={generatingCoverLetter}
                    >
                      {generatingCoverLetter ? "Generating…" : "Generate Cover Letter"}
                    </button>
                  </div>

                  {/* Recruiter Message Editor */}
                  <div style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Recruiter Message</p>
                    <textarea
                      value={packet.packet?.recruiter_message ?? ""}
                      onChange={(e) => {
                        if (!packet) return;
                        setPacket({
                          ...packet,
                          packet: packet.packet ? { ...packet.packet, recruiter_message: e.target.value } : null,
                        });
                      }}
                      placeholder="Enter or generate recruiter message…"
                      rows={4}
                      style={{ width: "100%", fontSize: 12, marginBottom: 6 }}
                    />
                    <button
                      className="btn btn-compact"
                      onClick={generateRecruiterMessage}
                      disabled={generatingRecruiterMessage}
                    >
                      {generatingRecruiterMessage ? "Generating…" : "Generate Recruiter Message"}
                    </button>
                  </div>

                  {/* Final Notes */}
                  <div style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Final Notes</p>
                    <textarea
                      value={packet.packet?.final_notes ?? ""}
                      onChange={(e) => {
                        if (!packet) return;
                        setPacket({
                          ...packet,
                          packet: packet.packet ? { ...packet.packet, final_notes: e.target.value } : null,
                        });
                      }}
                      placeholder="Add any final notes for the reviewer…"
                      rows={3}
                      style={{ width: "100%", fontSize: 12 }}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    <button className="btn btn-compact" onClick={buildPacket} disabled={packetLoading}>
                      {packetLoading ? "Refreshing…" : "Build / Refresh Packet"}
                    </button>
                    <button
                      className="btn-primary btn-compact"
                      onClick={() => {
                        if (!packet?.packet) return;
                        savePacket({
                          cover_letter: packet.packet.cover_letter ?? undefined,
                          recruiter_message: packet.packet.recruiter_message ?? undefined,
                          final_notes: packet.packet.final_notes ?? undefined,
                        });
                      }}
                      disabled={savingPacket}
                    >
                      {savingPacket ? "Saving…" : "Save Packet"}
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    <button
                      className="btn btn-compact"
                      onClick={() => {
                        if (!applicationId) return;
                        if (!confirm("Mark this packet as ready for review?")) return;
                        savePacketStatus("ready_for_review");
                      }}
                    >
                      Mark Ready for Review
                    </button>
                    <button
                      className="btn-primary btn-compact"
                      onClick={approvePacket}
                      disabled={packet.warnings.some((w) => w.severity === "block")}
                    >
                      Approve Packet
                    </button>
                    <button
                      className="btn btn-compact"
                      onClick={markSent}
                    >
                      Mark Sent
                    </button>
                  </div>

                  {/* Links */}
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 6px" }}>Links</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <Link href={`/candidates/${appResume?.candidate_id}`} style={{ fontSize: 12 }}>
                        View Candidate →
                      </Link>
                      <Link href={`/jobs/${appResume?.target_job_id}`} style={{ fontSize: 12 }}>
                        View Job →
                      </Link>
                      <Link href="/application-queue" style={{ fontSize: 12 }}>
                        View Application Queue →
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {QUICK_COMMANDS.map((c) => (
                  <button
                    key={c}
                    className="btn btn-compact"
                    onClick={() => (c === "/one-page" ? runOnePageFit() : c === "/export" ? exportPdf() : sendCommand(c, true))}
                    disabled={sending || fitting}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: "auto", marginBottom: 8, fontSize: 12 }}>
                {log.length === 0 && <p className="muted">Type a command or message to start.</p>}
                {log.map((entry, i) => (
                  <p
                    key={i}
                    style={{
                      margin: "4px 0",
                      color: entry.role === "warning" ? "var(--danger)" : undefined,
                      fontWeight: entry.role === "user" ? 600 : 400,
                    }}
                  >
                    {entry.role === "user" ? "> " : entry.role === "warning" ? "⚠ " : ""}
                    {entry.text}
                  </p>
                ))}
                {sending && <p className="muted">Falood is thinking…</p>}
              </div>
              {cliError && <p className="form-error" style={{ marginBottom: 6 }}>{cliError}</p>}
              {pendingAction && (
                <div style={{ marginBottom: 8, padding: 8, border: "1px solid var(--accent)", borderRadius: 6, background: "var(--accent-soft)" }}>
                  <p style={{ fontSize: 12, margin: "0 0 6px" }}>Pending action: {pendingAction.reason ?? "Update resume"}</p>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn-primary btn-compact" onClick={applyPendingAction}>Apply</button>
                    <button className="btn btn-compact" onClick={() => setPendingAction(null)}>Discard</button>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type a command or instruction…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && input.trim()) {
                      sendCommand(input.trim(), input.trim().startsWith("/"));
                      setInput("");
                    }
                  }}
                />
                <button
                  className="btn-primary"
                  disabled={sending || !input.trim()}
                  onClick={() => {
                    sendCommand(input.trim(), input.trim().startsWith("/"));
                    setInput("");
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (min-width: 1025px) {
          .mobile-tabs { display: none !important; }
        }
        @media (max-width: 1024px) {
          .mobile-tabs { display: flex !important; gap: 8px; }
          .studio-grid {
            grid-template-columns: 1fr !important;
          }
          .studio-grid .left-pane,
          .studio-grid .center-pane,
          .studio-grid .right-pane {
            display: none !important;
          }
        }
      `}</style>
      <style>{`
        @media (max-width: 1024px) {
          .mobile-tab-job .studio-grid .left-pane { display: flex !important; }
          .mobile-tab-editor .studio-grid .center-pane { display: block !important; }
          .mobile-tab-falood .studio-grid .right-pane { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
