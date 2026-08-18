// src/app/candidates/[id]/page.tsx
"use client";

import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ApplicationResumeAttach, TailorResumeModal } from "@/components/TailorResumeModal";
import { buildResumeDocumentFromParsedResume } from "@/lib/falood/seedFromParsedResume";
import { openFaloodStudio, resolveFaloodStudioUrl } from "@/lib/falood/openStudio";
import { SourceOfTruthPanel } from "@/components/candidates/SourceOfTruthPanel";
import { CandidateNotesPanel } from "@/components/candidates/CandidateNotesPanel";
import { AuditPanel } from "@/components/candidates/AuditPanel";
import CandidateApplicationsDashboard from "@/components/candidates/CandidateApplicationsDashboard";

interface BaseResumeSummary {
  id: string;
  name: string;
  target_industry: string | null;
  target_roles: string[] | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Application {
  id: string;
  status: string;
  applied_at: string;
  resume_filename: string | null;
  follow_up_at: string | null;
  next_action: string | null;
  assigned_by: string | null;
  assigned_to: string | null;
  assignment_note: string | null;
  assignment_due_at: string | null;
  source_type: string | null;
  adhoc_job_data: unknown | null;
  adhoc_job_raw_text: string | null;
  jobs: { id: string; title: string; company: string; location: string; role_tier: string | null } | null;
}

interface Resume {
  id: string;
  label: string;
  kind: string;
  file_url: string;
  filename: string;
  created_at: string;
  parsed_json: any | null;
  is_original_upload: boolean;
}

interface Evidence {
  id: string;
  source_type: string;
  title: string;
  description: string | null;
  related_skills: string[] | null;
  proof_url: string | null;
  confidence_score: number | null;
  created_at: string;
}

interface CandidateDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  target_tier: string | null;
  notes: string | null;
  resume_url: string | null;
  resume_filename: string | null;
  avatar_url: string | null;
  target_roles: string | null;
  preferred_locations: string | null;
  salary_expectation: string | null;
  work_authorization: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  visa_status: string | null;
  target_industries: string[] | null;
  verified_skills: string[] | null;
  location_preference: string | null;
  work_mode_preference: string | null;
  available_start_date: string | null;
  eeo_gender?: string | null;
  eeo_race?: string | null;
  eeo_veteran?: string | null;
  eeo_disability?: string | null;
  portal_token: string;
  account_created_at: string | null;
  account_email: string | null;
  last_login_at: string | null;
  applications: Application[];
  resumes: Resume[];
}

interface ApplicationComment {
  id: string;
  commenter_name: string;
  body: string;
  visible_to_candidate: boolean;
  created_at: string;
}

interface ApplicationEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
}

interface TailoredResumeEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  name?: string | null;
  jobDescription: string | null;
  companyName: string | null;
  skills: string[];
  resumeData: any;
  chatHistory: any;
  // AI-generated resume versions from application_resume_versions
  isAiGenerated?: boolean;
  sourceType?: string | null;
  atsScore?: number | null;
  applicationId?: string | null;
  applicationStatus?: string | null;
  applicationStage?: string | null;
  proofUrl?: string | null;
  proofFilename?: string | null;
  appliedAt?: string | null;
  pdfAvailable?: boolean;
  pdfStorageUrl?: string | null;
  pdfStorageItemId?: string | null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

function formatAppliedDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return "—";
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var monthIdx = parseInt(m[2], 10) - 1;
  var day = parseInt(m[3], 10);
  if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) return "—";
  return months[monthIdx] + " " + day + ", " + m[1];
}

function tailoredResumeDisplayName(t: TailoredResumeEntry): string {
  if (t.name && t.name.trim()) return t.name.trim();
  const jd = (t.jobDescription || "").trim();
  const firstLine = jd.split("\n")[0] || "";
  if (firstLine.toLowerCase().startsWith("title:")) return firstLine.replace(/^title:\s*/i, "").trim();
  return t.isAiGenerated ? "AI-Tailored Resume" : "Tailored resume";
}

interface RowAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

// Rendered via a portal into document.body with viewport-fixed coordinates
// rather than position: absolute inside the row. This table sits in a
// .table-shell (overflow-x: auto, which per spec forces overflow-y: auto too)
// — a plain absolutely-positioned dropdown is a DOM descendant of that
// scroll container and gets silently clipped no matter what position value
// it uses, unless it's moved out of that subtree entirely.
function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onOutsideEvent(e: MouseEvent | Event) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onOutsideEvent);
    window.addEventListener("scroll", onOutsideEvent, true);
    window.addEventListener("resize", onOutsideEvent);
    return () => {
      document.removeEventListener("mousedown", onOutsideEvent);
      window.removeEventListener("scroll", onOutsideEvent, true);
      window.removeEventListener("resize", onOutsideEvent);
    };
  }, [open]);

  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: rect.right });
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={buttonRef}
        className="btn-compact btn-sm"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More actions"
        onClick={toggle}
      >
        ⋯
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="dropdown-menu"
          style={{ position: "fixed", top: coords.top, left: coords.left, transform: "translateX(-100%)" }}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              className={`dropdown-item${a.danger ? " dropdown-item-danger" : ""}`}
              disabled={a.disabled}
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
            >
              {a.loading ? "⟳ Working…" : a.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function NamePromptModal({
  title,
  description,
  label,
  initialValue,
  confirmLabel,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  saving: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {description && (
          <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>{description}</p>
        )}
        <div className="field-group">
          <label>{label}</label>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
            }}
          />
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => onConfirm(value.trim())}
            disabled={saving || !value.trim()}
          >
            {saving ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({
  title,
  message,
  confirmLabel = "Delete",
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  saving: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 380 }}>
        <h2>{title}</h2>
        <p className="muted" style={{ marginTop: -6 }}>{message}</p>
        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="btn-danger" onClick={onConfirm} disabled={saving}>
            {saving ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CandidateProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [comments, setComments] = useState<ApplicationComment[]>([]);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [passwordResetting, setPasswordResetting] = useState(false);
  const [passwordResetMessage, setPasswordResetMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"Applications" | "Profile Overview" | "Source of Truth" | "Evidence Bank" | "Base Resumes" | "Tailored Resumes" | "Notes & Caveats" | "Audit">("Applications");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [showAddEvidence, setShowAddEvidence] = useState(false);
  const [parsedReview, setParsedReview] = useState<Resume | null>(null);
  const [acceptingParsed, setAcceptingParsed] = useState(false);
  const [generatingEvidence, setGeneratingEvidence] = useState(false);
  const [baseResumes, setBaseResumes] = useState<BaseResumeSummary[]>([]);
  const [baseResumesLoading, setBaseResumesLoading] = useState(false);
  const [showCreateBaseResume, setShowCreateBaseResume] = useState(false);
  const [tailoredResumes, setTailoredResumes] = useState<TailoredResumeEntry[]>([]);
  const [tailoredResumesLoading, setTailoredResumesLoading] = useState(false);
  const [resumeActionLoading, setResumeActionLoading] = useState<string | null>(null);
  const [resumeNameModal, setResumeNameModal] = useState<
    | { kind: "base"; mode: "rename" | "duplicate"; item: BaseResumeSummary; error?: string }
    | { kind: "tailored"; mode: "rename" | "duplicate"; item: TailoredResumeEntry; error?: string }
    | null
  >(null);
  const [resumeDeleteModal, setResumeDeleteModal] = useState<
    | { kind: "base"; item: BaseResumeSummary; error?: string }
    | { kind: "tailored"; item: TailoredResumeEntry; error?: string }
    | null
  >(null);
  const [tailorContext, setTailorContext] = useState<{ jobId?: string; applicationId?: string } | null>(null);
  const [showParseModal, setShowParseModal] = useState(false);
  const [parseModalText, setParseModalText] = useState("");
  const [parseModalResumeId, setParseModalResumeId] = useState("");
  const [parsingMarkitdown, setParsingMarkitdown] = useState(false);
  const [markitdownResult, setMarkitdownResult] = useState<{ parsed: any; parseStatus?: any; markdown?: string } | null>(null);
  const [markitdownAvailable, setMarkitdownAvailable] = useState<boolean | null>(null);
  const [me, setMe] = useState<{ profile?: { role?: string } } | null>(null);
  const isManager = ["admin", "manager"].includes(me?.profile?.role ?? "");

  async function resetCandidatePassword() {
    if (!confirm("Reset this candidate's portal password and issue a temporary password?")) return;
    setPasswordResetting(true); setPasswordResetMessage("");
    const res = await fetch(`/api/candidates/${id}/password-reset`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setPasswordResetting(false);
    setPasswordResetMessage(res.ok ? (data.emailSent ? "Temporary password emailed." : `Temporary password: ${data.temporaryPassword}`) : (data.error || "Reset failed."));
  }

  async function load() {
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/candidates/${id}`);
    setCandidate(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    fetch("/api/markitdown/parse")
      .then(r => r.json())
      .then(d => setMarkitdownAvailable(d.available ?? false))
      .catch(() => setMarkitdownAvailable(false));
  }, []);

  useEffect(() => {
    if (activeTab === "Evidence Bank" && id) {
      loadEvidence();
    }
    if (activeTab === "Base Resumes" && id) {
      loadBaseResumes();
    }
    if (activeTab === "Tailored Resumes" && id) {
      loadTailoredResumes();
    }
  }, [activeTab, id, candidate?.name]);

  async function loadEvidence() {
    if (!id) return;
    setEvidenceLoading(true);
    const res = await fetch(`/api/candidates/${id}/evidence`);
    setEvidence(res.ok ? await res.json() : []);
    setEvidenceLoading(false);
  }

  async function loadBaseResumes() {
    if (!id) return;
    setBaseResumesLoading(true);
    const res = await fetch(`/api/base-resumes?candidateId=${id}`);
    setBaseResumes(res.ok ? await res.json() : []);
    setBaseResumesLoading(false);
  }

  async function setBaseResumeStatus(baseResumeId: string, status: string) {
    const res = await fetch(`/api/base-resumes/${baseResumeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) loadBaseResumes();
  }

  async function submitBaseResumeRename(b: BaseResumeSummary, name: string) {
    setResumeActionLoading(`${b.id}:rename`);
    try {
      const res = await fetch(`/api/base-resumes/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await loadBaseResumes();
        setResumeNameModal(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setResumeNameModal((m) => (m ? { ...m, error: data?.error || "Failed to rename base resume" } : m));
      }
    } finally {
      setResumeActionLoading(null);
    }
  }

  async function submitBaseResumeDuplicate(b: BaseResumeSummary, name: string) {
    if (!candidate) return;
    setResumeActionLoading(`${b.id}:duplicate`);
    try {
      const res = await fetch("/api/base-resumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.id,
          name,
          startingSource: "duplicate",
          sourceBaseResumeId: b.id,
        }),
      });
      if (res.ok) {
        await loadBaseResumes();
        setResumeNameModal(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setResumeNameModal((m) => (m ? { ...m, error: data?.error || "Failed to duplicate base resume" } : m));
      }
    } finally {
      setResumeActionLoading(null);
    }
  }

  async function submitBaseResumeDelete(b: BaseResumeSummary) {
    setResumeActionLoading(`${b.id}:delete`);
    try {
      const res = await fetch(`/api/base-resumes/${b.id}`, { method: "DELETE" });
      if (res.ok) {
        await loadBaseResumes();
        setResumeDeleteModal(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setResumeDeleteModal((m) => (m ? { ...m, error: data?.error || "Failed to delete base resume" } : m));
      }
    } finally {
      setResumeActionLoading(null);
    }
  }

  async function loadTailoredResumes() {
    if (!id) return;
    setTailoredResumesLoading(true);
    try {
      // Source 1: Falood Tailor system (falood_saved_applications)
      const res = await fetch("/api/falood/applications", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      const rows: TailoredResumeEntry[] = json?.success ? (json.data ?? []) : [];

      const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      const candidateName = candidate?.name ? normalize(candidate.name) : "";

      const isForCandidate = (app: TailoredResumeEntry) => {
        const history = Array.isArray(app.chatHistory)
          ? app.chatHistory
          : typeof app.chatHistory === "string"
            ? (() => {
                try { return JSON.parse(app.chatHistory); } catch { return []; }
              })()
            : [];
        if (history.some((m: any) => m?.candidateId === id)) return true;

        const fullName = app?.resumeData?.personalInfo?.fullName;
        if (candidateName && typeof fullName === "string" && normalize(fullName) === candidateName) return true;

        return false;
      };

      const faloodTailored = rows
        .filter((a) => (a.jobDescription || "").trim().length > 0)
        .filter(isForCandidate);

      // Source 2: AI pipeline (application_resume_versions, source_type = 'ai_agent')
      // The 4-agent workflow finalizes into this table. The Falood Tailor
      // system above writes to a separate table and never intersects — so
      // without this merge, AI-completed resumes are invisible in this tab.
      const aiRes = await fetch(`/api/application-resume-versions?candidateId=${id}`, { cache: "no-store" });
      const aiVersions: any[] = aiRes.ok ? (await aiRes.json()) : [];

      const aiTailored: TailoredResumeEntry[] = aiVersions
        .filter((v: any) => v.source_type === "ai_agent" || v.source_type === "base_resume")
        .map((v: any) => ({
          id: v.id,
          createdAt: v.created_at,
          updatedAt: v.updated_at,
          name: v.title ?? null,
          jobDescription: v.target_jobs?.jobs?.title ?? null,
          companyName: v.target_jobs?.jobs?.company ?? null,
          skills: [],
          resumeData: null,
          chatHistory: [],
          isAiGenerated: v.source_type === "ai_agent",
          sourceType: v.source_type,
          atsScore: v.ats_score,
          applicationId: v.application_id ?? null,
          applicationStatus: v.applications?.status ?? null,
          applicationStage: v.applications?.stage ?? null,
          proofUrl: v.applications?.proof_url ?? null,
          proofFilename: v.applications?.proof_filename ?? null,
          appliedAt: v.applications?.applied_at ?? null,
          pdfAvailable: Boolean(v.pdf_available),
          pdfStorageUrl: v.pdf_storage_url ?? null,
          pdfStorageItemId: v.pdf_storage_item_id ?? null,
        }));

      const merged = [...faloodTailored, ...aiTailored]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      setTailoredResumes(merged);
    } catch {
      setTailoredResumes([]);
    } finally {
      setTailoredResumesLoading(false);
    }
  }

  async function markResumeApplied(t: TailoredResumeEntry) {
    if (!t.applicationId) return;
    setResumeActionLoading(`${t.id}:applied`);
    try {
      const res = await fetch(`/api/applications/${t.applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "applied", applied_at: new Date().toISOString() }),
      });
      if (res.ok) await loadTailoredResumes();
    } finally {
      setResumeActionLoading(null);
    }
  }

  function uploadProofForResume(t: TailoredResumeEntry) {
    if (!t.applicationId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setResumeActionLoading(`${t.id}:proof`);
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch(`/api/applications/${t.applicationId}/proof`, { method: "POST", body: fd });
        if (res.ok) await loadTailoredResumes();
      } finally {
        setResumeActionLoading(null);
      }
    };
    input.click();
  }

  async function submitTailoredResumeRename(t: TailoredResumeEntry, name: string) {
    setResumeActionLoading(`${t.id}:rename`);
    try {
      const res = t.isAiGenerated
        ? await fetch(`/api/application-resume-versions/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: name }),
          })
        : await fetch(`/api/falood/applications?id=${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
      if (res.ok) {
        await loadTailoredResumes();
        setResumeNameModal(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setResumeNameModal((m) => (m ? { ...m, error: data?.error || "Failed to rename tailored resume" } : m));
      }
    } finally {
      setResumeActionLoading(null);
    }
  }

  async function submitTailoredResumeDuplicate(t: TailoredResumeEntry, name: string) {
    setResumeActionLoading(`${t.id}:duplicate`);
    try {
      if (t.isAiGenerated) {
        const res = await fetch(`/api/application-resume-versions/${t.id}/duplicate`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setResumeNameModal((m) => (m ? { ...m, error: data?.error || "Failed to duplicate tailored resume" } : m));
          return;
        }
      } else {
        const getRes = await fetch(`/api/falood/applications?id=${t.id}`, { cache: "no-store" });
        const getJson = await getRes.json().catch(() => ({}));
        if (!getRes.ok || !getJson?.success) {
          setResumeNameModal((m) => (m ? { ...m, error: getJson?.error || "Failed to load tailored resume to duplicate" } : m));
          return;
        }
        const source = getJson.data;
        const res = await fetch("/api/falood/applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            jobDescription: source.jobDescription,
            companyName: source.companyName,
            skills: source.skills,
            resumeData: source.resumeData,
            chatHistory: source.chatHistory,
            candidateId: source.candidateId ?? id,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setResumeNameModal((m) => (m ? { ...m, error: data?.error || "Failed to duplicate tailored resume" } : m));
          return;
        }
      }
      await loadTailoredResumes();
      setResumeNameModal(null);
    } finally {
      setResumeActionLoading(null);
    }
  }

  async function submitTailoredResumeDelete(t: TailoredResumeEntry) {
    setResumeActionLoading(`${t.id}:delete`);
    try {
      const res = t.isAiGenerated
        ? await fetch(`/api/application-resume-versions/${t.id}`, { method: "DELETE" })
        : await fetch(`/api/falood/applications?id=${t.id}`, { method: "DELETE" });
      if (res.ok) {
        await loadTailoredResumes();
        setResumeDeleteModal(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setResumeDeleteModal((m) => (m ? { ...m, error: data?.error || "Failed to delete tailored resume" } : m));
      }
    } finally {
      setResumeActionLoading(null);
    }
  }

  function handleResumeNameModalConfirm(name: string) {
    if (!resumeNameModal) return;
    if (resumeNameModal.kind === "base") {
      if (resumeNameModal.mode === "rename") submitBaseResumeRename(resumeNameModal.item, name);
      else submitBaseResumeDuplicate(resumeNameModal.item, name);
    } else {
      if (resumeNameModal.mode === "rename") submitTailoredResumeRename(resumeNameModal.item, name);
      else submitTailoredResumeDuplicate(resumeNameModal.item, name);
    }
  }

  function handleResumeDeleteModalConfirm() {
    if (!resumeDeleteModal) return;
    if (resumeDeleteModal.kind === "base") submitBaseResumeDelete(resumeDeleteModal.item);
    else submitTailoredResumeDelete(resumeDeleteModal.item);
  }

  async function parseWithMarkitdown(resumeId: string) {
    if (!candidate) return;
    setParsingMarkitdown(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/parse-markitdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_id: resumeId }),
      });
      const data = await res.json();

      // If the API needs manual text input (PDF extraction failed)
      if (data.needsManualText) {
        setParseModalResumeId(resumeId);
        setParseModalText("");
        setShowParseModal(true);
        return;
      }

      if (!res.ok) {
        alert(data.error || "Failed to parse resume");
        return;
      }

      setMarkitdownResult(data);
      // After successful parse, create a base resume
      await createBaseResumeFromParsed(data.parsed);
    } catch (err: any) {
      alert(err.message || "Failed to parse resume");
    } finally {
      setParsingMarkitdown(false);
    }
  }

  async function submitManualParse() {
    if (!candidate || !parseModalText.trim() || !parseModalResumeId) return;
    setParsingMarkitdown(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/parse-markitdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_id: parseModalResumeId, resume_text: parseModalText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to parse resume text");
        return;
      }
      setMarkitdownResult(data);
      setShowParseModal(false);
      await createBaseResumeFromParsed(data.parsed);
    } catch (err: any) {
      alert(err.message || "Failed to parse resume text");
    } finally {
      setParsingMarkitdown(false);
    }
  }

  async function createBaseResumeFromParsed(parsed: any) {
    if (!candidate) return;
    const createRes = await fetch("/api/base-resumes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId: candidate.id,
        name: `${candidate.name} — Base Resume`,
        startingSource: "uploaded_resume",
      }),
    });
    if (createRes.ok) {
      const baseResume = await createRes.json();
      // Apply the parsed content to the new base resume
      await fetch(`/api/base-resumes/${baseResume.id}/apply-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newContent: buildResumeDocumentFromParsed(parsed) }),
      });
      router.push(await resolveFaloodStudioUrl("base_resume", baseResume.id));
    }
  }

  function buildResumeDocumentFromParsed(parsed: any) {
    return buildResumeDocumentFromParsedResume(
      parsed,
      {
        name: candidate?.name ?? "",
        email: candidate?.email,
        phone: candidate?.phone,
        linkedin_url: candidate?.linkedin_url,
        github_url: candidate?.github_url,
        portfolio_url: candidate?.portfolio_url,
      },
      {
        styleId: "skarion_compact_professional",
        pageFormat: "a4",
        fontFamily: "Calibri",
        fontSize: 10.5,
        marginTop: 0.5,
        marginRight: 0.5,
        marginBottom: 0.5,
        marginLeft: 0.5,
        sectionSpacing: 8,
        bulletSpacing: 2,
        lineHeight: 1.15,
      },
    );
  }

  const [uploadError, setUploadError] = useState<string | null>(null);
  async function handleResumeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/candidates/${id}/resume`, { method: "POST", body: formData });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: "Upload failed" }));
      setUploadError(errorData.error || `Upload failed (${res.status})`);
      setUploading(false);
      return;
    }
    const data: Resume = await res.json();
    setUploading(false);
    load();
    if (data?.parsed_json) {
      setParsedReview(data);
    }
  }

  async function acceptParsedData(resume: Resume) {
    if (!candidate) return;
    setAcceptingParsed(true);
    const p = resume.parsed_json;
    const res = await fetch(`/api/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: p.name ?? candidate.name,
        email: p.email ?? candidate.email,
        phone: p.phone ?? candidate.phone,
        linkedin_url: p.linkedin_url ?? candidate.linkedin_url,
        github_url: p.github_url ?? candidate.github_url,
        portfolio_url: p.portfolio_url ?? candidate.portfolio_url,
        location_preference: p.location ?? candidate.location_preference,
      }),
    });
    setAcceptingParsed(false);
    if (res.ok) {
      setParsedReview(null);
      load();
    }
  }

  async function generateEvidenceFromResume(resumeId: string) {
    if (!candidate) return;
    setGeneratingEvidence(true);
    await fetch(`/api/candidates/${candidate.id}/evidence/from-resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_id: resumeId }),
    });
    setGeneratingEvidence(false);
    loadEvidence();
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    const formData = new FormData();
    formData.append("file", file);
    await fetch(`/api/candidates/${id}/photo`, { method: "POST", body: formData });
    setUploadingPhoto(false);
    load();
  }

  async function deleteVariant(resumeId: string) {
    await fetch(`/api/candidates/${id}/resumes/${resumeId}`, { method: "DELETE" });
    load();
  }

  async function updateFollowUp(applicationId: string, value: string) {
    await fetch(`/api/applications/${applicationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follow_up_at: value || null }),
    });
    load();
  }

  async function toggleHistory(applicationId: string) {
    if (expandedAppId === applicationId) {
      setExpandedAppId(null);
      return;
    }
    setExpandedAppId(applicationId);
    const [eventsRes, commentsRes] = await Promise.all([
      fetch(`/api/applications/${applicationId}/events`),
      fetch(`/api/applications/${applicationId}/comments`),
    ]);
    setEvents(await eventsRes.json());
    setComments(commentsRes.ok ? await commentsRes.json() : []);
  }

  async function loadComments(applicationId: string) {
    const res = await fetch(`/api/applications/${applicationId}/comments`);
    if (res.ok) setComments(await res.json());
  }

  function copyPortalLink() {
    // Invite link: candidate sets a password and/or connects Google to create a
    // real login. The old anonymous read-only link (/portal/<token>) still works
    // on its own if ever needed, but this button now drives account creation.
    const url = `${window.location.origin}/portal/invite/${candidate?.portal_token}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function sendPortalInvite() {
    setInviteSending(true);
    setInviteMessage("");
    try {
      const res = await fetch(`/api/candidates/${candidate?.id}/invite`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setInviteMessage(data.error || "Could not send invite.");
        return;
      }
      if (data.emailSent) {
        setInviteMessage("Invite email sent.");
      } else {
        navigator.clipboard.writeText(data.link);
        setInviteMessage(
          data.emailError && data.emailError !== "No recipient address provided" && data.emailError !== "No email on file for this candidate."
            ? "Email delivery isn't configured yet — link copied to clipboard instead."
            : "No email on file — invite link copied to clipboard instead."
        );
      }
    } finally {
      setInviteSending(false);
    }
  }

  function toggleAppSelected(id: string) {
    setSelectedApps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function deleteApplication(id: string) {
    if (!confirm("Delete this application? This also removes its status history.")) return;
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    load();
  }

  async function deleteSelectedApplications() {
    if (!confirm(`Delete ${selectedApps.size} selected application(s)?`)) return;
    await Promise.all(Array.from(selectedApps).map((id) => fetch(`/api/applications/${id}`, { method: "DELETE" })));
    setSelectedApps(new Set());
    load();
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (!candidate) return <p className="muted">Candidate not found.</p>;

  const primaryResume = candidate.resumes.find((r) => r.is_original_upload) ?? candidate.resumes[0] ?? null;

  return (
    <>
      <div className="page-header">
        <h1>{candidate.name}</h1>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {candidate.account_created_at ? (
              <span className="muted" style={{ fontSize: 12 }}>
                Portal active since {new Date(candidate.account_created_at).toLocaleDateString()}
                {candidate.last_login_at ? ` · last login ${new Date(candidate.last_login_at).toLocaleDateString()}` : " · never logged in"}
              </span>
            ) : (
              <>
                <button onClick={sendPortalInvite} disabled={inviteSending}>
                  {inviteSending ? "Inviting..." : "Invite to portal"}
                </button>
                <button onClick={copyPortalLink}>{linkCopied ? "Copied!" : "Copy invite link"}</button>
              </>
            )}
            {candidate.status === "active" && (
              <Link href={"/candidates/" + candidate.id + "/job-search-profiles"}>
                <button>Job search profiles</button>
              </Link>
            )}
            <button onClick={() => setShowEdit(true)}>Edit profile</button>
            {isManager && candidate.account_created_at && <button onClick={resetCandidatePassword} disabled={passwordResetting}>{passwordResetting ? "Resetting..." : "Reset portal password"}</button>}
          </div>
          {inviteMessage && <span className="muted" style={{ fontSize: 12 }}>{inviteMessage}</span>}
          {passwordResetMessage && <span className="muted" style={{ fontSize: 12 }}>{passwordResetMessage}</span>}
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {(["Applications", "Profile Overview", "Source of Truth", "Evidence Bank", "Base Resumes", "Tailored Resumes", "Notes & Caveats", "Audit"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "10px 18px",
              borderBottom: activeTab === tab ? "2px solid var(--primary)" : "2px solid transparent",
              color: activeTab === tab ? "var(--primary)" : "inherit",
              fontWeight: activeTab === tab ? 600 : 400,
              background: "none",
              borderRadius: 0,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Profile Overview" && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              {candidate.avatar_url ? (
                <img className="avatar-circle" style={{ width: 56, height: 56, fontSize: 18 }} src={candidate.avatar_url} alt={candidate.name} />
              ) : (
                <span className="avatar-circle" style={{ width: 56, height: 56, fontSize: 18 }}>{initials(candidate.name)}</span>
              )}
              <div>
                <label>Profile picture</label>
                <input type="file" accept="image/*" onChange={handlePhotoUpload} disabled={uploadingPhoto} />
                {uploadingPhoto && <span className="muted" style={{ fontSize: 12 }}> Uploading…</span>}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label>Email</label>
                <p>{candidate.email || "—"}</p>
              </div>
              <div>
                <label>Phone</label>
                <p>{candidate.phone || "—"}</p>
              </div>
              <div>
                <label>Status</label>
                <p>{candidate.status}</p>
              </div>
              <div>
                <label>Target tier</label>
                <p>{candidate.target_tier ? <span className="badge">{candidate.target_tier}</span> : "—"}</p>
              </div>
              <div>
                <label>Target roles</label>
                <p>{candidate.target_roles || "—"}</p>
              </div>
              <div>
                <label>Preferred locations</label>
                <p>{candidate.preferred_locations || "—"}</p>
              </div>
              <div>
                <label>Salary expectation</label>
                <p>{candidate.salary_expectation || "—"}</p>
              </div>
              <div>
                <label>Work authorization</label>
                <p>{candidate.work_authorization || "—"}</p>
              </div>
              <div>
                <label>LinkedIn</label>
                <p>{candidate.linkedin_url ? <a href={candidate.linkedin_url} target="_blank" rel="noreferrer">{candidate.linkedin_url}</a> : "—"}</p>
              </div>
              <div>
                <label>GitHub</label>
                <p>{candidate.github_url ? <a href={candidate.github_url} target="_blank" rel="noreferrer">{candidate.github_url}</a> : "—"}</p>
              </div>
              <div>
                <label>Portfolio</label>
                <p>{candidate.portfolio_url ? <a href={candidate.portfolio_url} target="_blank" rel="noreferrer">{candidate.portfolio_url}</a> : "—"}</p>
              </div>
              <div>
                <label>Visa status</label>
                <p>{candidate.visa_status || "—"}</p>
              </div>
              <div>
                <label>Target industries</label>
                <p>{candidate.target_industries?.length ? candidate.target_industries.join(", ") : "—"}</p>
              </div>
              <div>
                <label>Verified skills</label>
                <p>{candidate.verified_skills?.length ? candidate.verified_skills.join(", ") : "—"}</p>
              </div>
              <div>
                <label>Location preference</label>
                <p>{candidate.location_preference || "—"}</p>
              </div>
              <div>
                <label>Work mode preference</label>
                <p>{candidate.work_mode_preference || "—"}</p>
              </div>
              <div>
                <label>Available start date</label>
                <p>{candidate.available_start_date ? new Date(candidate.available_start_date).toLocaleDateString() : "—"}</p>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label>Primary resume</label>
              {primaryResume ? (
                <p>
                  <a href={primaryResume.file_url} target="_blank" rel="noreferrer">{primaryResume.filename}</a>
                </p>
              ) : (
                <p className="muted">No resume uploaded yet.</p>
              )}
              <input type="file" accept=".pdf,.doc,.docx" onChange={handleResumeUpload} disabled={uploading} />
              {uploading && <p className="muted">Uploading…</p>}
              {uploadError && (
                <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>
                  ⚠ {uploadError}
                </p>
              )}

              {primaryResume && (
                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => parseWithMarkitdown(primaryResume.id)}
                    disabled={parsingMarkitdown || markitdownAvailable === false}
                    className="btn-primary"
                    title={
                      markitdownAvailable === null
                        ? "Checking markitdown service status..."
                        : markitdownAvailable
                          ? "Parse resume via markitdown service (higher accuracy)"
                          : "Markitdown service not deployed — parsing will use AI fallback. See docs/cloudflare-known-limitations.md for deployment instructions."
                    }
                  >
                    {parsingMarkitdown ? "Parsing…" : markitdownAvailable === false ? "Parse with AI & Create Base Resume" : "Parse with markitdown & Create Base Resume"}
                  </button>
                  <button onClick={() => setShowCreateBaseResume(true)}>
                    + Create blank base resume
                  </button>
                </div>
              )}

              {markitdownResult && (
                <div className="card" style={{ marginTop: 12, background: "var(--bg)" }}>
                  <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Parsed Resume</h3>
                  {markitdownResult.parseStatus && (
                    <div style={{ fontSize: 12, marginBottom: 10, display: "flex", flexWrap: "wrap", gap: "6px 12px" }}>
                      <span className={markitdownResult.parseStatus.hasName ? "badge" : "badge-closed"}>Name</span>
                      <span className={markitdownResult.parseStatus.hasEmail ? "badge" : "badge-closed"}>Email</span>
                      <span className={markitdownResult.parseStatus.hasPhone ? "badge" : "badge-closed"}>Phone</span>
                      <span className={markitdownResult.parseStatus.hasSummary ? "badge" : "badge-closed"}>Summary</span>
                      <span className={markitdownResult.parseStatus.skillsCount > 0 ? "badge" : "badge-closed"}>Skills ({markitdownResult.parseStatus.skillsCount})</span>
                      <span className={markitdownResult.parseStatus.experienceCount > 0 ? "badge" : "badge-closed"}>Jobs ({markitdownResult.parseStatus.experienceCount})</span>
                      <span className={markitdownResult.parseStatus.educationCount > 0 ? "badge" : "badge-closed"}>Education ({markitdownResult.parseStatus.educationCount})</span>
                      <span className={markitdownResult.parseStatus.certificationsCount > 0 ? "badge" : "badge-closed"}>Certs ({markitdownResult.parseStatus.certificationsCount})</span>
                      <span className={markitdownResult.parseStatus.totalBulletPoints > 0 ? "badge" : "badge-closed"}>Bullets ({markitdownResult.parseStatus.totalBulletPoints})</span>
                    </div>
                  )}
                  <p className="muted" style={{ fontSize: 12 }}>Skills: {markitdownResult.parsed.skills?.join(", ") || "—"}</p>
                  <p className="muted" style={{ fontSize: 12 }}>Experience: {markitdownResult.parsed.experience?.length || 0} entries</p>
                  <p className="muted" style={{ fontSize: 12 }}>Education: {markitdownResult.parsed.education?.length || 0} entries</p>
                </div>
              )}

              {primaryResume?.parsed_json && (
                <div className="card" style={{ marginTop: 12, background: "var(--bg)" }}>
                  <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Parsed Results</h3>
                  <ParsedResults parsed={primaryResume.parsed_json} />
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button onClick={() => acceptParsedData(primaryResume)} disabled={acceptingParsed}>
                      {acceptingParsed ? "Accepting…" : "Accept parsed data into profile"}
                    </button>
                    <button onClick={() => generateEvidenceFromResume(primaryResume.id)} disabled={generatingEvidence}>
                      {generatingEvidence ? "Generating…" : "Generate evidence from resume"}
                    </button>
                    <button
                      onClick={() => parseWithMarkitdown(primaryResume.id)}
                      disabled={parsingMarkitdown}
                      style={{ marginLeft: "auto" }}
                    >
                      {parsingMarkitdown ? "Parsing…" : "Re-parse"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="page-header">
            <h2 style={{ fontSize: 16, margin: 0 }}>Resume variants ({candidate.resumes.length})</h2>
            <button onClick={() => setShowAddVariant(true)}>+ Add variant</button>
          </div>

          {candidate.resumes.length === 0 ? (
            <div className="empty" style={{ marginBottom: 20 }}>
              No tailored resumes or cover letters yet.
            </div>
          ) : (
            <div className="table-shell" style={{ marginBottom: 20 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Kind</th>
                    <th>File</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.resumes.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.label}</strong></td>
                      <td><span className="badge">{r.kind}</span></td>
                      <td><a href={r.file_url} target="_blank" rel="noreferrer">{r.filename}</a></td>
                      <td><button onClick={() => deleteVariant(r.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === "Source of Truth" && (
        <SourceOfTruthPanel candidateId={candidate.id} verifiedSkills={candidate.verified_skills || []} />
      )}

      {activeTab === "Notes & Caveats" && (
        <CandidateNotesPanel candidateId={candidate.id} />
      )}

      {activeTab === "Audit" && (
        <AuditPanel candidateId={candidate.id} />
      )}

      {activeTab === "Evidence Bank" && (
        <div>
          <div className="page-header">
            <h2 style={{ fontSize: 16, margin: 0 }}>Evidence Bank ({evidence.length})</h2>
            <button onClick={() => setShowAddEvidence(true)}>+ Add evidence</button>
          </div>

          {evidenceLoading ? (
            <p className="muted">Loading evidence…</p>
          ) : evidence.length === 0 ? (
            <div className="empty">
              No evidence yet. Upload a resume to auto-generate, or add manually.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {evidence.map((ev) => (
                <div key={ev.id} className="card" style={{ marginBottom: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span className="badge">{ev.source_type}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{new Date(ev.created_at).toLocaleDateString()}</span>
                  </div>
                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>{ev.title}</h3>
                  {ev.description && <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{ev.description}</p>}
                  {ev.related_skills && ev.related_skills.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {ev.related_skills.map((s) => (
                        <span key={s} className="badge">{s}</span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Confidence: {ev.confidence_score !== null ? `${Math.round(ev.confidence_score * 100)}%` : "—"}
                    </span>
                    {ev.proof_url && <a href={ev.proof_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Proof</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "Base Resumes" && (
        <div>
          <div className="page-header">
            <h2 style={{ fontSize: 16, margin: 0 }}>Base resumes ({baseResumes.length})</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setTailorContext({})}>Tailor resume for job</button>
              <button onClick={() => setShowCreateBaseResume(true)}>+ Create base resume</button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
            Reusable, structured starting points built with the Falood CLI — not job-specific
            exports. Use one of these as the base when tailoring an application later.
          </p>
          {baseResumesLoading ? (
            <p className="muted">Loading…</p>
          ) : baseResumes.length === 0 ? (
            <div className="card" style={{ borderStyle: "dashed", borderColor: "var(--warn)" }}>
              <p style={{ fontSize: 14, margin: "0 0 8px" }}><strong>No base resumes yet</strong></p>
              <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
                You need a base resume to build tailored applications with Falood AI. Choose how to start:
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn-primary" onClick={() => setShowCreateBaseResume(true)}>
                  + Create blank base resume
                </button>
                <Link href={`/candidates/${candidate.id}`} onClick={() => setActiveTab("Profile Overview")}>
                  <button>Upload resume first</button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="table-shell">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Target industry</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {baseResumes.map((b) => (
                    <tr key={b.id}>
                      <td><strong>{b.name}</strong></td>
                      <td className="muted">{b.target_industry ?? "—"}</td>
                      <td>
                        {isManager ? (
                          <select
                            className="input"
                            style={{ padding: "2px 6px", fontSize: 12, width: "auto" }}
                            value={b.status}
                            onChange={(e) => setBaseResumeStatus(b.id, e.target.value)}
                          >
                            <option value="draft">draft</option>
                            <option value="approved">approved</option>
                          </select>
                        ) : (
                          <span className="badge">{b.status}</span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{new Date(b.updated_at).toLocaleDateString()}</td>
                      <td style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button
                          className="row-link"
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                          onClick={() => openFaloodStudio("base_resume", b.id)}
                        >
                          Open in studio
                        </button>
                        <RowActionsMenu
                          actions={[
                            {
                              label: "Rename",
                              loading: resumeActionLoading === `${b.id}:rename`,
                              onClick: () => setResumeNameModal({ kind: "base", mode: "rename", item: b }),
                            },
                            {
                              label: "Duplicate",
                              loading: resumeActionLoading === `${b.id}:duplicate`,
                              onClick: () => setResumeNameModal({ kind: "base", mode: "duplicate", item: b }),
                            },
                            ...(isManager
                              ? [{
                                  label: "Delete",
                                  danger: true,
                                  loading: resumeActionLoading === `${b.id}:delete`,
                                  onClick: () => setResumeDeleteModal({ kind: "base", item: b }),
                                }]
                              : []),
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "Tailored Resumes" && (
        <div>
          <div className="page-header">
            <h2 style={{ fontSize: 16, margin: 0 }}>Tailored resumes ({tailoredResumes.length})</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setTailorContext({})}>+ New tailored resume</button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
            Job-specific resumes created from this candidate&apos;s base resume, editable in the Falood studio.
          </p>

          {tailoredResumesLoading ? (
            <p className="muted">Loading…</p>
          ) : tailoredResumes.length === 0 ? (
            <div className="empty">
              No tailored resumes found for this candidate yet. Create one from the Base Resumes tab.
            </div>
          ) : (
            <div className="table-shell">
              <table className="table">
                <thead>
                  <tr>
                    <th>Target job</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tailoredResumes.map((t) => {
                    const title = tailoredResumeDisplayName(t);
                    const company = t.companyName || "—";
                    return (
                      <tr key={t.id}>
                        <td>
                          <strong>{title || "Tailored resume"}</strong>
                          {t.isAiGenerated && (
                            <span className="badge" style={{ marginLeft: 6, fontSize: 10, background: "var(--accent)", color: "var(--surface)" }}>AI</span>
                          )}
                          {t.atsScore != null && (
                            // ats_score is a 0-100 composite (see computeDeterministicScore in
                            // src/lib/atsScoring.ts, and the unlabeled 0-100 display convention
                            // already used on the ATS Score Analysis page) - "/10" here was wrong
                            // from the day this line was added (be7bb7d), not a regression.
                            <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>ATS {t.atsScore}%</span>
                          )}
                        </td>
                        <td className="muted">{company}</td>
                        <td>
                          {t.applicationId ? (
                            <>
                              <span className={`badge badge-${t.applicationStage ?? t.applicationStatus}`}>{t.applicationStage ?? t.applicationStatus ?? "assigned"}</span>
                              {t.appliedAt && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>Applied {formatAppliedDate(t.appliedAt)}</span>}
                              {t.proofUrl && (
                                <a href={t.proofUrl} target="_blank" rel="noreferrer" className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                                  📎 {t.proofFilename || "proof"}
                                </a>
                              )}
                            </>
                          ) : (
                            <span className="muted" style={{ fontSize: 11 }}>Not linked to an application</span>
                          )}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>{new Date(t.updatedAt).toLocaleDateString()}</td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <button
                            className="row-link"
                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                            onClick={() => t.isAiGenerated ? openFaloodStudio("application_resume_version", t.id) : window.open(`/falood/studio/tailor/${t.id}`, "_blank")}
                          >
                            Open in studio
                          </button>
                          {t.applicationId && (
                            <>
                              {t.pdfAvailable && <a className="btn-compact btn-sm" href={`/api/applications/${t.applicationId}/resume-pdf`} target="_blank" rel="noreferrer">View PDF</a>}
                              {t.pdfStorageUrl && <a className="btn-compact btn-sm" href={t.pdfStorageUrl} target="_blank" rel="noreferrer">Open SharePoint</a>}
                              <button
                                className="btn-compact btn-sm"
                                onClick={() => uploadProofForResume(t)}
                                disabled={resumeActionLoading === `${t.id}:proof`}
                              >
                                {resumeActionLoading === `${t.id}:proof` ? "⟳" : "📎 Proof"}
                              </button>
                              <button
                                className="btn-primary btn-sm"
                                onClick={() => markResumeApplied(t)}
                                disabled={resumeActionLoading === `${t.id}:applied` || t.applicationStatus === "applied"}
                              >
                                {resumeActionLoading === `${t.id}:applied` ? "⟳" : t.applicationStatus === "applied" ? "✅ Applied" : "Mark Applied"}
                              </button>
                            </>
                          )}
                          <RowActionsMenu
                            actions={[
                              {
                                label: "Rename",
                                loading: resumeActionLoading === `${t.id}:rename`,
                                onClick: () => setResumeNameModal({ kind: "tailored", mode: "rename", item: t }),
                              },
                              {
                                label: "Duplicate",
                                loading: resumeActionLoading === `${t.id}:duplicate`,
                                onClick: () => setResumeNameModal({ kind: "tailored", mode: "duplicate", item: t }),
                              },
                              ...(isManager
                                ? [{
                                    label: "Delete",
                                    danger: true,
                                    loading: resumeActionLoading === `${t.id}:delete`,
                                    onClick: () => setResumeDeleteModal({ kind: "tailored", item: t }),
                                  }]
                                : []),
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "Applications" && (
        <Suspense fallback={<div style={{ padding: 20, color: "var(--ink-soft)" }}>Loading dashboard...</div>}>
          <CandidateApplicationsDashboard candidateId={candidate.id} />
        </Suspense>
      )}

      {showEdit && (
        <EditProfileModal
          candidate={candidate}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}
      {showAddVariant && (
        <AddVariantModal
          candidateId={candidate.id}
          onClose={() => setShowAddVariant(false)}
          onAdded={() => { setShowAddVariant(false); load(); }}
        />
      )}
      {showAddEvidence && (
        <AddEvidenceModal
          candidateId={candidate.id}
          onClose={() => setShowAddEvidence(false)}
          onAdded={() => { setShowAddEvidence(false); loadEvidence(); }}
        />
      )}
      {showCreateBaseResume && (
        <CreateBaseResumeModal
          candidateId={candidate.id}
          candidateName={candidate.name}
          hasUploadedResume={candidate.resumes.some((resume) => resume.kind === "resume")}
          onClose={() => setShowCreateBaseResume(false)}
          onCreated={async (id) => {
            setShowCreateBaseResume(false);
            if (id) {
              router.push(await resolveFaloodStudioUrl("base_resume", id));
            } else {
              loadBaseResumes();
            }
          }}
        />
      )}
      {showParseModal && (
        <ParseResumeModal
          onClose={() => setShowParseModal(false)}
          onSubmit={submitManualParse}
          text={parseModalText}
          setText={setParseModalText}
          loading={parsingMarkitdown}
        />
      )}
      {resumeNameModal && (
        <NamePromptModal
          title={resumeNameModal.mode === "rename" ? "Rename resume" : "Duplicate resume"}
          description={resumeNameModal.mode === "duplicate" ? "Creates a new, independent copy with this name." : undefined}
          label="Name"
          initialValue={
            resumeNameModal.mode === "rename"
              ? resumeNameModal.kind === "base"
                ? resumeNameModal.item.name
                : tailoredResumeDisplayName(resumeNameModal.item)
              : `${resumeNameModal.kind === "base" ? resumeNameModal.item.name : tailoredResumeDisplayName(resumeNameModal.item)} (Copy)`
          }
          confirmLabel={resumeNameModal.mode === "rename" ? "Save" : "Duplicate"}
          saving={resumeActionLoading === `${resumeNameModal.item.id}:${resumeNameModal.mode}`}
          error={resumeNameModal.error}
          onCancel={() => setResumeNameModal(null)}
          onConfirm={handleResumeNameModalConfirm}
        />
      )}
      {resumeDeleteModal && (
        <ConfirmDeleteModal
          title={resumeDeleteModal.kind === "base" ? "Delete base resume" : "Delete tailored resume"}
          message={`Delete "${resumeDeleteModal.kind === "base" ? resumeDeleteModal.item.name : tailoredResumeDisplayName(resumeDeleteModal.item)}"? This cannot be undone.`}
          saving={resumeActionLoading === `${resumeDeleteModal.item.id}:delete`}
          error={resumeDeleteModal.error}
          onCancel={() => setResumeDeleteModal(null)}
          onConfirm={handleResumeDeleteModalConfirm}
        />
      )}
      {tailorContext && (
        <TailorResumeModal
          candidateId={candidate.id}
          initialJobId={tailorContext.jobId}
          initialApplicationId={tailorContext.applicationId}
          onClose={() => setTailorContext(null)}
          onSaved={() => load()}
        />
      )}
      {parsedReview && parsedReview.parsed_json && (
        <div className="modal-overlay" onClick={() => setParsedReview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>Review parsed resume</h2>
            <ParsedResults parsed={parsedReview.parsed_json} />
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => acceptParsedData(parsedReview)} disabled={acceptingParsed}>
                {acceptingParsed ? "Accepting…" : "Accept parsed data into profile"}
              </button>
              <button onClick={() => generateEvidenceFromResume(parsedReview.id)} disabled={generatingEvidence}>
                {generatingEvidence ? "Generating…" : "Generate evidence from resume"}
              </button>
              <button onClick={() => setParsedReview(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ParsedResults({ parsed }: { parsed: any }) {
  const skills = parsed?.skills ?? [];
  const experience = parsed?.experience ?? [];
  const education = parsed?.education ?? [];
  const certifications = parsed?.certifications ?? [];

  if (parsed?.parse_error || (!skills.length && !experience.length && !education.length && !certifications.length && !parsed?.name && !parsed?.email)) {
    return (
      <div>
        {parsed?.parse_error ? (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(211, 38, 30, 0.12)", fontSize: 13 }}>
            <strong>Parsing failed:</strong> {parsed.parse_error}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 14 }}>No structured data was extracted from this resume.</p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
      <div><label>Name</label><p className="muted">{parsed?.name || "—"}</p></div>
      <div><label>Email</label><p className="muted">{parsed?.email || "—"}</p></div>
      <div><label>Phone</label><p className="muted">{parsed?.phone || "—"}</p></div>
      <div><label>Location</label><p className="muted">{parsed?.location || "—"}</p></div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label>Skills</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {skills.length ? skills.map((s: string) => <span key={s} className="badge">{s}</span>) : <span className="muted">—</span>}
        </div>
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label>Experience</label>
        {experience.length ? (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {experience.map((exp: any, i: number) => (
              <li key={i} className="muted">{exp.company} — {exp.title}</li>
            ))}
          </ul>
        ) : <p className="muted">—</p>}
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label>Education</label>
        {education.length ? (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {education.map((edu: any, i: number) => (
              <li key={i} className="muted">{edu.school} — {edu.degree}</li>
            ))}
          </ul>
        ) : <p className="muted">—</p>}
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label>Certifications</label>
        {certifications.length ? (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {certifications.map((cert: any, i: number) => (
              <li key={i} className="muted">{cert.name || cert}</li>
            ))}
          </ul>
        ) : <p className="muted">—</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function SourceTypeBadge({ sourceType }: { sourceType: string | null }) {
  const label = sourceType || "Legacy";
  const colorMap: Record<string, string> = {
    base_resume: "badge-info",
    original_resume: "badge-success",
    blank: "badge-warning",
    manual: "badge-secondary",
    Legacy: "badge-muted",
  };
  return <span className={`badge ${colorMap[label] || "badge-muted"}`}>{label.replaceAll("_", " ")}</span>;
}

function ApplicationComments({ applicationId, comments, onCommented }: { applicationId: string; comments: ApplicationComment[]; onCommented: () => void }) {
  const [commenterName, setCommenterName] = useState("");
  const [body, setBody] = useState("");
  const [visibleToCandidate, setVisibleToCandidate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCommenterName(localStorage.getItem("skarion_commenter_name") ?? "");
  }, []);

  async function submit() {
    if (!commenterName.trim()) { setError("Add your name."); return; }
    if (!body.trim()) { setError("Write a log entry first."); return; }

    setSaving(true);
    setError("");
    const res = await fetch(`/api/applications/${applicationId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commenter_name: commenterName, body, visible_to_candidate: visibleToCandidate }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Could not save log entry.");
      return;
    }

    localStorage.setItem("skarion_commenter_name", commenterName.trim());
    setBody("");
    setVisibleToCandidate(false);
    onCommented();
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <label style={{ display: "block", marginBottom: 6 }}>Activity log</label>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10, alignItems: "start", marginBottom: 8 }}>
        <input
          value={commenterName}
          onChange={(e) => setCommenterName(e.target.value)}
          placeholder="Your name"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="e.g. Recruiter called, interview scheduled for Tuesday..."
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: comments.length ? 16 : 0 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={visibleToCandidate} onChange={(e) => setVisibleToCandidate(e.target.checked)} />
          Share with candidate
        </label>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving ? "Posting..." : "Add log entry"}
        </button>
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      {comments.length === 0 ? (
        <p className="muted" style={{ marginBottom: 0 }}>No log entries yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {comments.map((comment) => (
            <div key={comment.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                <strong>{comment.commenter_name}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(comment.created_at).toLocaleString()}
                  {comment.visible_to_candidate && <span className="badge" style={{ marginLeft: 8 }}>visible to candidate</span>}
                </span>
              </div>
              <p style={{ whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.5 }}>{comment.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditProfileModal({ candidate, onClose, onSaved }: { candidate: CandidateDetail; onClose: () => void; onSaved: () => void }) {
  const [targetRoles, setTargetRoles] = useState(candidate.target_roles ?? "");
  const [preferredLocations, setPreferredLocations] = useState(candidate.preferred_locations ?? "");
  const [salaryExpectation, setSalaryExpectation] = useState(candidate.salary_expectation ?? "");
  const [workAuthorization, setWorkAuthorization] = useState(candidate.work_authorization ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(candidate.linkedin_url ?? "");
  const [githubUrl, setGithubUrl] = useState(candidate.github_url ?? "");
  const [portfolioUrl, setPortfolioUrl] = useState(candidate.portfolio_url ?? "");
  const [visaStatus, setVisaStatus] = useState(candidate.visa_status ?? "");
  const [targetIndustries, setTargetIndustries] = useState(candidate.target_industries?.join(", ") ?? "");
  const [verifiedSkills, setVerifiedSkills] = useState(candidate.verified_skills?.join(", ") ?? "");
  const [locationPreference, setLocationPreference] = useState(candidate.location_preference ?? "");
  const [workModePreference, setWorkModePreference] = useState(candidate.work_mode_preference ?? "");
  const [availableStartDate, setAvailableStartDate] = useState(candidate.available_start_date ?? "");
  const [eeoGender, setEeoGender] = useState(candidate.eeo_gender ?? "");
  const [eeoRace, setEeoRace] = useState(candidate.eeo_race ?? "");
  const [eeoVeteran, setEeoVeteran] = useState(candidate.eeo_veteran ?? "");
  const [eeoDisability, setEeoDisability] = useState(candidate.eeo_disability ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_roles: targetRoles || null,
        preferred_locations: preferredLocations || null,
        salary_expectation: salaryExpectation || null,
        work_authorization: workAuthorization || null,
        linkedin_url: linkedinUrl || null,
        github_url: githubUrl || null,
        portfolio_url: portfolioUrl || null,
        visa_status: visaStatus || null,
        target_industries: targetIndustries ? targetIndustries.split(",").map((s) => s.trim()).filter(Boolean) : null,
        verified_skills: verifiedSkills ? verifiedSkills.split(",").map((s) => s.trim()).filter(Boolean) : [],
        location_preference: locationPreference || null,
        work_mode_preference: workModePreference || null,
        available_start_date: availableStartDate || null,
        eeo_gender: eeoGender || null,
        eeo_race: eeoRace || null,
        eeo_veteran: eeoVeteran || null,
        eeo_disability: eeoDisability || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit profile</h2>
        <div className="field-group">
          <label>Target roles</label>
          <input value={targetRoles} onChange={(e) => setTargetRoles(e.target.value)} placeholder="e.g. OSP Designer, Telecom PM" />
        </div>
        <div className="field-group">
          <label>Preferred locations</label>
          <input value={preferredLocations} onChange={(e) => setPreferredLocations(e.target.value)} placeholder="e.g. Remote, Atlanta GA" />
        </div>
        <div className="field-group">
          <label>Salary expectation</label>
          <input value={salaryExpectation} onChange={(e) => setSalaryExpectation(e.target.value)} placeholder="e.g. $90k-$110k" />
        </div>
        <div className="field-group">
          <label>Work authorization</label>
          <input value={workAuthorization} onChange={(e) => setWorkAuthorization(e.target.value)} placeholder="e.g. US Citizen, H1B" />
        </div>
        <div className="field-group">
          <label>LinkedIn URL</label>
          <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/..." />
        </div>
        <div className="field-group">
          <label>GitHub URL</label>
          <input value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/..." />
        </div>
        <div className="field-group">
          <label>Portfolio URL</label>
          <input value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="field-group">
          <label>Visa status</label>
          <input value={visaStatus} onChange={(e) => setVisaStatus(e.target.value)} placeholder="e.g. H1B, Green Card" />
        </div>
        <div className="field-group">
          <label>Target industries (comma-separated)</label>
          <input value={targetIndustries} onChange={(e) => setTargetIndustries(e.target.value)} placeholder="e.g. Telecom, SaaS, Finance" />
        </div>
        <div className="field-group">
          <label>Verified skills (comma-separated)</label>
          <input value={verifiedSkills} onChange={(e) => setVerifiedSkills(e.target.value)} placeholder="e.g. Vetro FiberMap, Katapult, PE License" />
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            Recruiter-confirmed skills the AI resume pipeline can use even if the base resume text doesn't mention them.
          </p>
        </div>
        <div className="field-group">
          <label>Location preference</label>
          <input value={locationPreference} onChange={(e) => setLocationPreference(e.target.value)} placeholder="e.g. Remote, NYC" />
        </div>
        <div className="field-group">
          <label>Work mode preference</label>
          <input value={workModePreference} onChange={(e) => setWorkModePreference(e.target.value)} placeholder="e.g. Remote, Hybrid, Onsite" />
        </div>
        <div className="field-group">
          <label>Available start date</label>
          <input type="date" value={availableStartDate} onChange={(e) => setAvailableStartDate(e.target.value)} />
        </div>

        <h3 style={{ marginTop: 24, marginBottom: 12, fontSize: 16 }}>Equal Employment Opportunity (EEO)</h3>
        <div className="field-group">
          <label>Gender</label>
          <input value={eeoGender} onChange={(e) => setEeoGender(e.target.value)} placeholder="e.g. Male, Female, Decline to self-identify" />
        </div>
        <div className="field-group">
          <label>Race / Ethnicity</label>
          <input value={eeoRace} onChange={(e) => setEeoRace(e.target.value)} placeholder="e.g. Asian, White, Hispanic" />
        </div>
        <div className="field-group">
          <label>Veteran Status</label>
          <input value={eeoVeteran} onChange={(e) => setEeoVeteran(e.target.value)} placeholder="e.g. Protected Veteran, Not a Veteran" />
        </div>
        <div className="field-group">
          <label>Disability Status</label>
          <input value={eeoDisability} onChange={(e) => setEeoDisability(e.target.value)} placeholder="e.g. Yes, No, Decline to answer" />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddVariantModal({ candidateId, onClose, onAdded }: { candidateId: string; onClose: () => void; onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("resume");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!label.trim()) { setError("Label is required."); return; }
    if (!file) { setError("Choose a file."); return; }
    setSaving(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("label", label);
    formData.append("kind", kind);
    const res = await fetch(`/api/candidates/${candidateId}/resumes`, { method: "POST", body: formData });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    onAdded();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add resume variant</h2>
        <div className="field-group">
          <label>Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. OSP-tailored resume" />
        </div>
        <div className="field-group">
          <label>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="resume">Resume</option>
            <option value="cover_letter">Cover letter</option>
          </select>
        </div>
        <div className="field-group">
          <label>File</label>
          <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Uploading…" : "Add variant"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddEvidenceModal({ candidateId, onClose, onAdded }: { candidateId: string; onClose: () => void; onAdded: () => void }) {
  const [sourceType, setSourceType] = useState("resume");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [relatedSkills, setRelatedSkills] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [confidenceScore, setConfidenceScore] = useState(0.8);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/candidates/${candidateId}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_type: sourceType,
        title: title.trim(),
        description: description.trim() || null,
        related_skills: relatedSkills ? relatedSkills.split(",").map((s) => s.trim()).filter(Boolean) : null,
        proof_url: proofUrl.trim() || null,
        confidence_score: confidenceScore,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    onAdded();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add evidence</h2>
        <div className="field-group">
          <label>Source type</label>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
            <option value="resume">Resume</option>
            <option value="interview">Interview</option>
            <option value="reference">Reference</option>
            <option value="assessment">Assessment</option>
            <option value="portfolio">Portfolio</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="field-group">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Strong React experience" />
        </div>
        <div className="field-group">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Details..." />
        </div>
        <div className="field-group">
          <label>Related skills (comma-separated)</label>
          <input value={relatedSkills} onChange={(e) => setRelatedSkills(e.target.value)} placeholder="e.g. React, TypeScript, Node.js" />
        </div>
        <div className="field-group">
          <label>Proof URL</label>
          <input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="field-group">
          <label>Confidence score: {Math.round(confidenceScore * 100)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={confidenceScore}
            onChange={(e) => setConfidenceScore(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Adding…" : "Add evidence"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateBaseResumeModal({
  candidateId,
  candidateName,
  hasUploadedResume,
  onClose,
  onCreated,
}: {
  candidateId: string;
  candidateName: string;
  hasUploadedResume: boolean;
  onClose: () => void;
  onCreated: (id?: string) => void;
}) {
  const [name, setName] = useState(`${candidateName} — Base Resume`);
  const [targetIndustry, setTargetIndustry] = useState("");
  const [targetRoles, setTargetRoles] = useState("");
  const [startingSource, setStartingSource] = useState<"blank" | "uploaded_resume">("blank");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim()) { setError("Name is required."); return; }
    if (startingSource === "uploaded_resume" && !hasUploadedResume) {
      setError("Please upload a resume first, then choose 'Seed from uploaded resume'.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/base-resumes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId,
        name: name.trim(),
        targetIndustry: targetIndustry.trim() || undefined,
        targetRoles: targetRoles ? targetRoles.split(",").map((s) => s.trim()).filter(Boolean) : [],
        startingSource,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to create base resume.");
      return;
    }
    const data = await res.json();
    onCreated(data.id);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create base resume</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
          A reusable starting point for tailoring applications with Falood AI.
        </p>
        <div className="field-group">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Doe — Base Resume" />
        </div>
        <div className="field-group">
          <label>Target industry</label>
          <input value={targetIndustry} onChange={(e) => setTargetIndustry(e.target.value)} placeholder="e.g. Telecom, SaaS" />
        </div>
        <div className="field-group">
          <label>Target roles (comma-separated)</label>
          <input value={targetRoles} onChange={(e) => setTargetRoles(e.target.value)} placeholder="e.g. OSP Designer, Network Engineer" />
        </div>
        <div className="field-group">
          <label>Starting source</label>
          <select value={startingSource} onChange={(e) => setStartingSource(e.target.value as "blank" | "uploaded_resume")}>
            <option value="blank">Blank canvas (build with Falood AI)</option>
            <option value="uploaded_resume">Seed from uploaded resume (if available)</option>
          </select>
          {startingSource === "uploaded_resume" && !hasUploadedResume && (
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              No uploaded resume found yet. Upload a resume first, then come back and seed from it.
            </p>
          )}
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Creating…" : "Create base resume"}
          </button>
        </div>
      </div>
    </div>
  );
}


function ParseResumeModal({ onClose, onSubmit, text, setText, loading }: {
  onClose: () => void;
  onSubmit: () => void;
  text: string;
  setText: (t: string) => void;
  loading: boolean;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700 }}>
        <h2>Build base resume with AI</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -6, marginBottom: 12 }}>
          We couldn't automatically read your PDF. Please paste your resume text below and the AI will structure it into a professional base resume.
        </p>
        <div className="field-group">
          <label>Resume text</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your full resume text here..."
            rows={12}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={onSubmit} disabled={loading || !text.trim()}>
            {loading ? "Building…" : "Build with AI"}
          </button>
        </div>
      </div>
    </div>
  );
}
