"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { exportAndDownloadResume } from "@/lib/falood/clientExport";
import A4Preview from "@/components/resume/A4Preview";
import SectionSidebar from "@/components/resume/SectionSidebar";
import KeywordPanel from "@/components/resume/KeywordPanel";

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
  const [bulkApplying, setBulkApplying] = useState(false);
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
  const [rightTab, setRightTab] = useState<"suggestions" | "draft" | "export" | "chat" | "packet" | "keywords">("keywords");

  /* Grammarly-style UI state */
  const [activePreviewSection, setActivePreviewSection] = useState<string | null>(null);
  const [aiActionLoading, setAiActionLoading] = useState<string | null>(null);

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

  /* ──────────── keyword map for Grammarly-style UI ──────────── */

  // Moved above keywordMap - it's referenced inside that useMemo (and in its
  // dependency array) but was declared further down the file, after this hook,
  // which is a real "used before declaration" error for a block-scoped const,
  // not just a style nit.
  const content = draftContent ?? appResume?.content;

  const keywordMap = useMemo(() => {
    if (!targetJob || !content) return {};
    const map: Record<string, string[]> = {};
    const text = JSON.stringify(content).toLowerCase();

    for (const k of targetJob.keywords) {
      const sections: string[] = [];
      const kw = k.keyword.toLowerCase();

      if (content.summary?.text?.toLowerCase().includes(kw)) sections.push("summary");
      if (content.skills.some((g) => g.skills.some((s) => s.toLowerCase().includes(kw)))) sections.push("skills");
      if (content.experience.some((exp) =>
        exp.title.toLowerCase().includes(kw) ||
        exp.company.toLowerCase().includes(kw) ||
        exp.bullets.some((b) => b.text.toLowerCase().includes(kw))
      )) sections.push("experience");
      if (content.education.some((edu) =>
        edu.degree.toLowerCase().includes(kw) ||
        edu.school.toLowerCase().includes(kw)
      )) sections.push("education");
      if ((content.certifications ?? []).some((c) => c.name.toLowerCase().includes(kw))) sections.push("certifications");
      if ((content.projects ?? []).some((p) =>
        p.title.toLowerCase().includes(kw) ||
        p.bullets.some((b) => b.text.toLowerCase().includes(kw))
      )) sections.push("projects");

      if (sections.length > 0) {
        map[k.keyword] = sections;
      }
    }
    return map;
  }, [targetJob, content]);

  const suggestionsBySection = useMemo(() => {
    const map: Record<string, { id: string; text: string; type: string; status: string }[]> = {};
    for (const s of suggestions) {
      const key = s.target_section;
      if (!map[key]) map[key] = [];
      map[key].push({
        id: s.id,
        text: s.proposed_text.slice(0, 80) + (s.proposed_text.length > 80 ? "…" : ""),
        type: s.suggestion_type.replace("_", " "),
        status: s.status,
      });
    }
    return map;
  }, [suggestions]);

  /* ──────────── editing helpers ──────────── */

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

  // Accepts and applies every pending, truth_status="verified" suggestion in one
  // action instead of clicking "Accept & Apply" once per suggestion - the other
  // top blocker (alongside bulk keyword approval) found in the volume-application
  // audit. truth_status is computed server-side against the evidence bank, not
  // self-reported by the model, so "verified" is a real safety gate here, not
  // just an AI confidence claim - fabrication_risk/unverified suggestions are
  // deliberately excluded and still need individual review.
  //
  // The accept step is batched into one PATCH call (the endpoint already
  // supports an updates array). The apply step runs sequentially, not in
  // parallel, because each apply reads-then-writes the same resume content -
  // applying multiple suggestions concurrently risks one overwriting another's
  // change instead of both landing.
  async function handleBulkAcceptAndApply() {
    if (!applicationResumeId) return;
    const eligible = suggestions.filter((s) => s.status === "pending" && s.truth_status === "verified");
    if (eligible.length === 0) return;

    setBulkApplying(true);
    try {
      await fetch(`/api/application-resume-versions/${applicationResumeId}/resume-suggestions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: eligible.map((s) => ({ id: s.id, status: "accepted" })) }),
      });

      for (const s of eligible) {
        await fetch(`/api/applications/${s.application_id}/resume-suggestions/${s.id}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume_version_id: applicationResumeId }),
        });
      }

      await refreshSuggestions();
      const arRes = await fetch(`/api/application-resume-versions/${applicationResumeId}`);
      if (arRes.ok) {
        const ar = await arRes.json();
        setAppResume(ar);
        setDraftContent(JSON.parse(JSON.stringify(ar.content)));
      }
    } finally {
      setBulkApplying(false);
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

  async function handleAISectionAction(section: string, action: string, prompt?: string) {
    if (!applicationResumeId) return;
    setAiActionLoading(`${section}:${action}`);
    setLog((prev) => [...prev, { role: "user", text: `[AI] ${action} for ${section}${prompt ? `: ${prompt}` : ""}` }]);

    try {
      const res = await fetch("/api/falood/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "application_resume_tailoring",
          applicationResumeId,
          candidateId: appResume?.candidate_id,
          conversationId,
          message: `For the ${section} section: ${prompt ?? action}`,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLog((prev) => [...prev, { role: "warning", text: `AI action failed: ${data.error ?? "unknown error"}` }]);
      } else {
        setConversationId(data.conversationId);
        setLog((prev) => [...prev, { role: "assistant", text: data.message }]);
        if (data.action?.type === "update_resume_document" && data.action.newContent) {
          setPendingAction(data.action);
        }
      }
    } catch (e: any) {
      setLog((prev) => [...prev, { role: "warning", text: `AI action error: ${e.message}` }]);
    } finally {
      setAiActionLoading(null);
    }
  }

  function handleSectionUpdate(section: string, value: any) {
    if (!draftContent) return;
    const next = { ...draftContent };
    switch (section) {
      case "header":
        next.header = { ...value };
        break;
      case "summary":
        next.summary = value.text ? { id: draftContent.summary?.id ?? uid(), text: value.text } : undefined;
        break;
      case "skills":
        next.skills = value.skills ?? value;
        break;
      case "experience":
        next.experience = value.experience ?? value;
        break;
      case "education":
        next.education = value.education ?? value;
        break;
      case "certifications":
        next.certifications = value.certifications ?? value;
        break;
      case "projects":
        next.projects = value.projects ?? value;
        break;
    }
    setDraftContent(next);
  }

  async function handleApproveKeyword(keywordId: string) {
    if (!candidateId) return;
    try {
      const res = await fetch("/api/keyword-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordId, candidateId, decision: "approved" }),
      });
      if (res.ok) {
        const kaRes = await fetch(`/api/keyword-approvals?candidateId=${candidateId}`);
        if (kaRes.ok) setKeywordApprovals(await kaRes.json());
      }
    } catch (e) {
      console.error("Failed to approve keyword", e);
    }
  }

  // One request approving every evidence-backed pending keyword at once, instead
  // of N individual clicks - this was the single biggest friction point found in
  // the volume-application audit: a 30-50 keyword JD meant 30-50 clicks before
  // suggestion generation could even start. The backend (/api/keyword-approvals)
  // does the approvals in one batched call; KeywordPanel only offers this for
  // keywords that already have supporting evidence, so it can't be used to
  // silently wave through an unsupported claim.
  async function handleBulkApproveKeywords(keywordIds: string[]) {
    if (!candidateId || keywordIds.length === 0) return;
    try {
      const res = await fetch("/api/keyword-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordIds, candidateId, decision: "approved" }),
      });
      if (res.ok) {
        const kaRes = await fetch(`/api/keyword-approvals?candidateId=${candidateId}`);
        if (kaRes.ok) setKeywordApprovals(await kaRes.json());
      }
    } catch (e) {
      console.error("Failed to bulk-approve keywords", e);
    }
  }

  async function handleRejectKeyword(keywordId: string) {
    if (!candidateId) return;
    try {
      const res = await fetch("/api/keyword-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordId, candidateId, decision: "rejected" }),
      });
      if (res.ok) {
        const kaRes = await fetch(`/api/keyword-approvals?candidateId=${candidateId}`);
        if (kaRes.ok) setKeywordApprovals(await kaRes.json());
      }
    } catch (e) {
      console.error("Failed to reject keyword", e);
    }
  }

  function handleKeywordClick(keyword: string) {
    const sections = keywordMap[keyword];
    if (sections && sections.length > 0) {
      setActivePreviewSection(sections[0]);
    }
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
          gridTemplateColumns: "320px 1fr 380px",
          gridTemplateRows: "calc(100vh - 140px)",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* ═══════ LEFT PANE: Section Sidebar ═══════ */}
        <div className="left-pane card" style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", overflow: "hidden" }}>
          <SectionSidebar
            content={content}
            activeSection={activePreviewSection}
            onSectionClick={(section) => setActivePreviewSection(section)}
            onUpdateContent={handleSectionUpdate}
            onAISectionAction={handleAISectionAction}
            keywordMap={keywordMap}
            suggestionsBySection={suggestionsBySection}
          />
        </div>

        {/* ═══════ CENTER PANE: A4 Preview ═══════ */}
        <div className="center-pane card" style={{ position: "relative", height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>Resume Preview</h3>
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
          <div style={{ flex: 1, overflow: "hidden" }}>
            <A4Preview
              content={content}
              highlights={targetJob?.keywords.map((k) => ({
                keyword: k.keyword,
                color: k.evidence === "strong" ? "#bbf7d0" : k.evidence === "weak" ? "#fef08a" : k.evidence === "missing" ? "#fecaca" : "#e2e8f0",
              })) ?? []}
              activeSection={activePreviewSection}
              onSectionClick={(section) => setActivePreviewSection(section)}
            />
          </div>
        </div>

        {/* ═══════ RIGHT PANE: Tabs ═══════ */}
        <div className="right-pane card" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, borderBottom: "1px solid var(--border)", paddingBottom: 8, flexShrink: 0 }}>
            <button className={rightTab === "keywords" ? "btn-primary" : "btn"} onClick={() => setRightTab("keywords")} style={{ flex: 1 }}>
              Keywords
            </button>
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

          {rightTab === "keywords" ? (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <KeywordPanel
                keywords={targetJob?.keywords ?? []}
                keywordApprovals={keywordApprovals}
                onApproveKeyword={handleApproveKeyword}
                onRejectKeyword={handleRejectKeyword}
                onBulkApprove={handleBulkApproveKeywords}
                onKeywordClick={handleKeywordClick}
                keywordMap={keywordMap}
              />
            </div>
          ) : rightTab === "suggestions" ? (
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

              {suggestions.filter((s) => s.status === "pending" && s.truth_status === "verified").length > 0 && (
                <button
                  className="btn-primary btn-compact"
                  style={{ width: "100%", marginBottom: 10 }}
                  onClick={handleBulkAcceptAndApply}
                  disabled={bulkApplying}
                  title="Accepts and applies every pending suggestion the system has already verified against the evidence bank. Fabrication-risk and unverified suggestions are left for individual review."
                >
                  {bulkApplying
                    ? "Applying…"
                    : `✓ Accept & Apply all verified (${suggestions.filter((s) => s.status === "pending" && s.truth_status === "verified").length})`}
                </button>
              )}

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
          .mobile-tab-editor .studio-grid .center-pane { display: flex !important; }
          .mobile-tab-falood .studio-grid .right-pane { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
