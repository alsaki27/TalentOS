"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Activity, Bot, BriefcaseBusiness, Check, Clock3, KeyRound, LockKeyhole, Play, RefreshCw, Save, Settings2, ShieldCheck, Users } from "lucide-react";
import styles from "./auto-job-logging.module.css";

type Priority = "high" | "default" | "low";
type SettingsTab = "workflow" | "candidates" | "matching" | "activity";
type PreferenceValues = Record<string, string | boolean>;
interface Candidate {
  id: string; name: string; status: string; pipeline_stage: string | null; approved_resume_count: number;
}
interface CandidateRule {
  candidate_id: string; is_enabled: boolean; priority: Priority;
  preferences: PreferenceValues; custom_requirements: string;
}
interface SettingsDraft { config: Config; rules: Record<string, CandidateRule>; apiKey: string }
type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
interface TeamMember { user_id: string; display_name: string | null; role: string }
interface RunRow {
  id: string; trigger_type: string; status: string; jobs_seen: number;
  candidate_pairs_scored: number; applications_created: number; skipped_count: number;
  failed_count: number; ai_calls: number; input_tokens: number; output_tokens: number;
  ai_success_count: number; ai_failure_count: number; avg_latency_ms: number | null;
  started_at: string; finished_at: string | null; error_message: string | null;
  config_snapshot: { provider?: string; model?: string } | null;
}
interface DecisionRow {
  id: string; run_id: string; job_id: string; job_title: string; company: string | null; source: string;
  candidate_id: string; candidate_name: string; base_resume_id: string | null;
  base_resume_name: string | null; deterministic_score: number | null; match_score: number | null;
  priority: Priority; status: string; reason: string | null; application_id: string | null; updated_at: string;
}
interface Config {
  is_enabled: boolean; password_configured?: boolean; ai_provider: string | null; ai_model: string | null;
  ai_base_url: string | null; has_ai_key: boolean; ai_key_fingerprint: string | null;
  match_threshold: number; jobs_per_run: number; ai_calls_per_run: number;
  max_applications_per_run: number; job_freshness_days: number; custom_prompt: string; include_inactive_candidates: boolean;
  assigned_by_user_id: string | null; application_owner_user_id: string | null; updated_at: string | null;
}
interface PageData {
  locked: boolean; config: Config; candidates: Candidate[]; candidateRules: CandidateRule[];
  teamMembers: TeamMember[]; recentRuns: RunRow[]; recentDecisions: DecisionRow[];
  scheduledSources: { source: string; pending_count: number; latest_ingested_at: string }[];
}

// BEGIN commented out (restorable together with the matching block below and
// the matching blocks in scheduledCandidateLoggingService.ts and route.ts):
// only used by the now-deactivated dedicated-provider section.
// const PROVIDERS = [
//   ["openai", "OpenAI"], ["anthropic", "Anthropic"], ["google", "Google Gemini"],
//   ["openrouter", "OpenRouter"], ["deepseek", "DeepSeek"], ["glm", "GLM"],
//   ["opencode", "OpenCode"], ["moonshot", "Moonshot"], ["nvidia", "NVIDIA"],
//   ["groq", "Groq"], ["openai_compatible", "OpenAI-compatible API"],
//   ["google_vertex_proxy", "Google Vertex proxy"],
// ];
// END commented out

const DEFAULT_CONFIG: Config = {
  is_enabled: false, ai_provider: "openai", ai_model: "", ai_base_url: null, has_ai_key: false,
  ai_key_fingerprint: null, match_threshold: 85, jobs_per_run: 25, ai_calls_per_run: 25,
  max_applications_per_run: 25, job_freshness_days: 1, custom_prompt: "", include_inactive_candidates: false,
  assigned_by_user_id: null, application_owner_user_id: null, updated_at: null,
};

function errorMessage(payload: any, fallback: string) { return typeof payload?.error === "string" ? payload.error : fallback; }
function displayDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
function emptyRule(candidate: Candidate): CandidateRule {
  return {
    candidate_id: candidate.id, is_enabled: candidate.status === "active", priority: "default",
    preferences: {}, custom_requirements: "",
  };
}

export default function AutoJobLoggingPage() {
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [rules, setRules] = useState<Record<string, CandidateRule>>({});
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [accessPassword, setAccessPassword] = useState("");
  const [newAccessPassword, setNewAccessPassword] = useState("");
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const apiKeyRef = useRef("");
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [candidateSearch, setCandidateSearch] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>("workflow");
  const [activityUpdatedAt, setActivityUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [runResult, setRunResult] = useState<any>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const markDirty = () => {
    revisionRef.current += 1;
    dirtyRef.current = true;
    setHasUnsavedChanges(true);
    setSaveStatus("pending");
    setPageError("");
    setNotice("");
  };

  const loadPage = useCallback(async () => {
    revisionRef.current += 1;
    dirtyRef.current = false;
    setSaveStatus("idle");
    setLoading(true);
    setPageError("");
    try {
      const response = await fetch("/api/admin/scheduled-job-logging", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Could not load this page."));
      if (payload.locked) {
        setPasswordConfigured(Boolean(payload.config?.password_configured));
        setPageData(null);
        return;
      }
      const nextConfig = { ...DEFAULT_CONFIG, ...payload.config } as Config;
      setConfig(nextConfig);
      apiKeyRef.current = "";
      setApiKey("");
      setHasUnsavedChanges(false);
      setSaveStatus(nextConfig.updated_at ? "saved" : "idle");
      setPasswordConfigured(true);
      setPageData(payload as PageData);
      setActivityUpdatedAt(new Date().toISOString());
      const savedRules = new Map<string, CandidateRule>((payload.candidateRules ?? []).map((rule: CandidateRule) => [rule.candidate_id, rule]));
      const nextRules: Record<string, CandidateRule> = {};
      for (const candidate of payload.candidates as Candidate[]) {
        const saved = savedRules.get(candidate.id);
        nextRules[candidate.id] = saved
          ? { ...emptyRule(candidate), ...saved, preferences: { ...(saved.preferences ?? {}) } }
          : emptyRule(candidate);
      }
      setRules(nextRules);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load scheduled logging.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPage(); }, [loadPage]);

  const refreshPageInBackground = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/scheduled-job-logging", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.locked) return;
      const fresh = payload as PageData;
      setPageData((current) => current ? {
        ...current,
        config: fresh.config,
        candidates: fresh.candidates,
        candidateRules: fresh.candidateRules,
        teamMembers: fresh.teamMembers,
        recentRuns: fresh.recentRuns,
        scheduledSources: fresh.scheduledSources,
        recentDecisions: fresh.recentDecisions,
      } : current);
      if (!hasUnsavedChanges) {
        setConfig({ ...DEFAULT_CONFIG, ...fresh.config } as Config);
        const savedRules = new Map<string, CandidateRule>((fresh.candidateRules ?? []).map((rule) => [rule.candidate_id, rule]));
        const nextRules: Record<string, CandidateRule> = {};
        for (const candidate of fresh.candidates) {
          const saved = savedRules.get(candidate.id);
          nextRules[candidate.id] = saved
            ? { ...emptyRule(candidate), ...saved, preferences: { ...(saved.preferences ?? {}) } }
            : emptyRule(candidate);
        }
        setRules(nextRules);
      }
      setActivityUpdatedAt(new Date().toISOString());
    } catch {
      // Keep the current view intact; the next background refresh can retry.
    }
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!pageData) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPageInBackground();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [Boolean(pageData), refreshPageInBackground]);

  const visibleCandidates = useMemo(() => {
    const candidates = pageData?.candidates ?? [];
    const search = candidateSearch.trim().toLowerCase();
    return candidates.filter((candidate) => !search || candidate.name.toLowerCase().includes(search));
  }, [pageData?.candidates, candidateSearch]);

  const updateConfig = <K extends keyof Config>(key: K, value: Config[K]) => {
    markDirty();
    setConfig((current) => ({ ...current, [key]: value }));
  };
  const updateRule = (candidateId: string, changes: Partial<CandidateRule>) => {
    markDirty();
    setRules((current) => ({ ...current, [candidateId]: { ...current[candidateId], ...changes } }));
  };
  const updatePreference = (candidateId: string, key: string, value: string | boolean) => {
    markDirty();
    setRules((current) => ({ ...current, [candidateId]: { ...current[candidateId], preferences: { ...current[candidateId].preferences, [key]: value } } }));
  };

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setPageError("");
    try {
      const response = await fetch("/api/admin/scheduled-job-logging/unlock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: passwordConfigured ? "unlock" : "set", password: accessPassword }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Could not unlock the page."));
      setPasswordConfigured(true); setAccessPassword(""); setNotice(payload.passwordSet ? "Feature password created. Keep it in a password manager." : "Page unlocked for this session.");
      await loadPage();
    } catch (error) { setPageError(error instanceof Error ? error.message : "Could not unlock the page."); }
    finally { setBusy(false); }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setPageError("");
    try {
      const response = await fetch("/api/admin/scheduled-job-logging/unlock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", password: newAccessPassword }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Could not change the page password."));
      setNewAccessPassword(""); setShowPasswordChange(false); setNotice("Feature password changed.");
    } catch (error) { setPageError(error instanceof Error ? error.message : "Could not change the password."); }
    finally { setBusy(false); }
  };

  const lockPage = async () => {
    if (hasUnsavedChanges && !window.confirm("Lock the page and discard unsaved settings?")) return;
    revisionRef.current += 1;
    dirtyRef.current = false;
    setHasUnsavedChanges(false);
    setSaveStatus("idle");
    await fetch("/api/admin/scheduled-job-logging/unlock", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }),
    });
    setPageData(null); setNotice("Scheduled logging settings locked.");
  };

  const persistSettings = useCallback((draft: SettingsDraft, revision: number) => {
    const queuedSave = saveQueueRef.current.catch(() => undefined).then(async () => {
      if (!pageData || !dirtyRef.current || revision !== revisionRef.current) return;
      setSaveStatus("saving");
      setPageError("");
      try {
        const response = await fetch("/api/admin/scheduled-job-logging", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft.config, ai_api_key: draft.apiKey, candidate_rules: Object.values(draft.rules) }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload, "Could not save settings."));
        const savedAt = typeof payload.updated_at === "string" ? payload.updated_at : new Date().toISOString();
        const savedKey = Boolean(draft.apiKey);
        if (savedKey && apiKeyRef.current === draft.apiKey) {
          apiKeyRef.current = "";
          setApiKey((current) => current === draft.apiKey ? "" : current);
        }
        setConfig((current) => ({
          ...current,
          updated_at: savedAt,
          has_ai_key: Boolean(payload.has_ai_key ?? (current.has_ai_key || savedKey)),
          ai_key_fingerprint: payload.ai_key_fingerprint ?? current.ai_key_fingerprint,
        }));
        setPageData((current) => current ? {
          ...current,
          config: {
            ...current.config,
            updated_at: savedAt,
            has_ai_key: Boolean(payload.has_ai_key ?? (current.config.has_ai_key || savedKey)),
            ai_key_fingerprint: payload.ai_key_fingerprint ?? current.config.ai_key_fingerprint,
          },
        } : current);
        if (revision === revisionRef.current) {
          dirtyRef.current = false;
          setHasUnsavedChanges(false);
          setSaveStatus("saved");
        } else if (dirtyRef.current) {
          setSaveStatus("pending");
        } else {
          setSaveStatus("saved");
        }
      } catch (error) {
        if (revision === revisionRef.current) {
          setSaveStatus("error");
          setPageError(error instanceof Error ? error.message : "Could not save settings.");
        } else if (dirtyRef.current) {
          setSaveStatus("pending");
        } else {
          setSaveStatus("idle");
        }
      }
    });
    saveQueueRef.current = queuedSave;
    return queuedSave;
  }, [pageData]);

  useEffect(() => {
    if (!pageData || !hasUnsavedChanges || saveStatus === "error" || saveStatus === "saving") return;
    const draft: SettingsDraft = { config, rules, apiKey };
    const revision = revisionRef.current;
    const timer = window.setTimeout(() => { void persistSettings(draft, revision); }, 900);
    return () => window.clearTimeout(timer);
  }, [pageData, hasUnsavedChanges, saveStatus, config, rules, apiKey, persistSettings]);

  const saveSettings = (event: FormEvent) => {
    event.preventDefault();
    if (!pageData || !dirtyRef.current) return;
    void persistSettings({ config, rules, apiKey }, revisionRef.current);
  };

  const runNow = async () => {
    const confirmed = window.confirm("Run a batch now? This may create standard TalentOS application records and start their existing resume workflow.");
    if (!confirmed) return;
    setBusy(true); setPageError(""); setNotice(""); setRunResult(null);
    try {
      const response = await fetch("/api/admin/scheduled-job-logging/run", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "The batch did not complete."));
      setRunResult(payload.result); setNotice("Batch finished. Review its counts and any pending work below.");
      await refreshPageInBackground();
    } catch (error) { setPageError(error instanceof Error ? error.message : "The batch did not complete."); }
    finally { setBusy(false); }
  };

  if (loading) return <main className={`${styles.page} auto-job-logging-page`}><div className={styles.loading}>Loading scheduled job logging…</div></main>;

  if (!pageData) return (
    <main className={`${styles.page} auto-job-logging-page`}>
      <div className={styles.lockCard}>
        <div className={styles.brand}><span className={styles.brandIcon}><LockKeyhole size={19} /></span><span>TalentOS Admin</span></div>
        <p className={styles.eyebrow}>RESTRICTED WORKSPACE</p>
        <h1>{passwordConfigured ? "Unlock scheduled job logging" : "Set up scheduled job logging"}</h1>
        <p className={styles.muted}>Admin access and a separate passphrase protect these matching rules, candidate preferences, and AI provider settings.</p>
        <form className={styles.unlockForm} onSubmit={unlock}>
          <label htmlFor="feature-password">{passwordConfigured ? "Feature passphrase" : "Create a feature passphrase"}</label>
          <input id="feature-password" type="password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} minLength={passwordConfigured ? undefined : 12} autoComplete="current-password" required />
          {!passwordConfigured && <small>Use at least 12 characters. This is separate from your TalentOS account password.</small>}
          {pageError && <div className={styles.error}>{pageError}</div>}
          {notice && <div className={styles.success}>{notice}</div>}
          <button className={styles.primaryButton} disabled={busy}>{busy ? "Checking…" : passwordConfigured ? "Unlock page" : "Create passphrase and unlock"}</button>
        </form>
        <Link href="/candidates" className={styles.backLink}>Back to TalentOS</Link>
      </div>
    </main>
  );

  const applyingCandidateCount = pageData.candidates.length;
  const configuredCount = pageData.candidates.filter((candidate) => rules[candidate.id]?.is_enabled).length;
  const pendingJobs = pageData.scheduledSources.reduce((sum, row) => sum + Number(row.pending_count), 0);
  const teamMembers = pageData.teamMembers;
  const ownerMissing = !config.assigned_by_user_id || !config.application_owner_user_id;
  // const providerNeedsBaseUrl = ["openai_compatible", "google_vertex_proxy", "groq", "openrouter"].includes(config.ai_provider ?? ""); // commented out with the matching block below
  const selectedRun = selectedRunId ? pageData.recentRuns.find((run) => run.id === selectedRunId) ?? null : null;
  const visibleDecisions = selectedRunId
    ? pageData.recentDecisions.filter((decision) => decision.run_id === selectedRunId)
    : pageData.recentDecisions;

  return (
    <main className={`${styles.page} auto-job-logging-page`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>AUTOMATED SOURCING · ADMIN ONLY</p>
          <h1>Scheduled candidate logging</h1>
          <p className={styles.subhead}>Review scheduled-source jobs, match draft or approved base resumes, then create normal TalentOS applications.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} onClick={() => setShowPasswordChange(true)}><KeyRound size={16} /> Change passphrase</button>
          <button className={styles.secondaryButton} onClick={() => {
            if (hasUnsavedChanges && !window.confirm("Discard unsaved settings and reload?")) return;
            if (hasUnsavedChanges) void loadPage();
            else void refreshPageInBackground();
          }} disabled={busy || saveStatus === "saving"}><RefreshCw size={16} /> Refresh</button>
          <button className={styles.secondaryButton} onClick={() => void lockPage()} disabled={busy || saveStatus === "saving"}><LockKeyhole size={16} /> Lock page</button>
        </div>
      </header>

      {pageError && <div className={styles.errorBanner} role="alert">{pageError}</div>}
      {notice && <div className={styles.successBanner} role="status"><Check size={17} />{notice}</div>}

      <section className={styles.summaryGrid} aria-label="Workflow summary">
        <article className={styles.summaryCard}><span className={styles.summaryIcon}><Clock3 size={18} /></span><div><small>Target schedule</small><strong>Daily · 5:00 AM BDT</strong><p>GitHub Actions · 23:00 UTC</p></div></article>
        <article className={styles.summaryCard}><span className={styles.summaryIcon}><BriefcaseBusiness size={18} /></span><div><small>Scheduled jobs waiting</small><strong>{pendingJobs}</strong><p>{pageData.scheduledSources.length} source group{pageData.scheduledSources.length === 1 ? "" : "s"}</p></div></article>
        <article className={styles.summaryCard}><span className={styles.summaryIcon}><Users size={18} /></span><div><small>Active applying candidates</small><strong>{configuredCount} / {applyingCandidateCount}</strong><p>Only active candidates in the applying stage</p></div></article>
        <article className={`${styles.summaryCard} ${config.is_enabled ? styles.enabledCard : styles.pausedCard}`}><span className={styles.summaryIcon}><Activity size={18} /></span><div><small>Automatic logging</small><strong>{config.is_enabled ? "Enabled" : "Paused"}</strong><p>{config.match_threshold}% minimum match</p></div></article>
      </section>

      {runResult && <section className={styles.runResult} aria-live="polite"><div><strong>Latest run · {runResult.status ?? (runResult.skipped ? "skipped" : "complete")}</strong><p>{runResult.reason ?? `${runResult.jobsSeen ?? 0} jobs checked · ${runResult.candidatePairsScored ?? 0} sent to Stage 2 AI · ${runResult.applicationsCreated ?? 0} applications created · ${runResult.failedCount ?? 0} failed`}</p></div><span>{runResult.aiCalls ?? 0} separate AI calls</span></section>}

      <nav className={styles.tabs} role="tablist" aria-label="Scheduled logging settings">
        <button id="tab-workflow" type="button" role="tab" aria-selected={activeTab === "workflow"} aria-controls="panel-workflow" className={activeTab === "workflow" ? styles.activeTab : styles.tab} onClick={() => setActiveTab("workflow")}><Settings2 size={16} />Workflow</button>
        <button id="tab-candidates" type="button" role="tab" aria-selected={activeTab === "candidates"} aria-controls="panel-candidates" className={activeTab === "candidates" ? styles.activeTab : styles.tab} onClick={() => setActiveTab("candidates")}><Users size={16} />Candidates <span>{applyingCandidateCount}</span></button>
        <button id="tab-matching" type="button" role="tab" aria-selected={activeTab === "matching"} aria-controls="panel-matching" className={activeTab === "matching" ? styles.activeTab : styles.tab} onClick={() => setActiveTab("matching")}><Bot size={16} />AI & matching</button>
        <button id="tab-activity" type="button" role="tab" aria-selected={activeTab === "activity"} aria-controls="panel-activity" className={activeTab === "activity" ? styles.activeTab : styles.tab} onClick={() => setActiveTab("activity")}><Activity size={16} />Activity <span>Live</span></button>
      </nav>

      <form onSubmit={saveSettings}>
        {activeTab === "workflow" && <section id="panel-workflow" role="tabpanel" aria-labelledby="tab-workflow" className={styles.panel}>
          <div className={styles.panelHeading}><div><span className={styles.sectionIcon}><ShieldCheck size={18} /></span><div><h2>Workflow controls</h2><p>Only scheduled ingestion events qualify. Manual, extension, and spreadsheet jobs are excluded.</p></div></div><label className={styles.toggle}><input type="checkbox" checked={config.is_enabled} onChange={(event) => updateConfig("is_enabled", event.target.checked)} /><span />{config.is_enabled ? "Schedule enabled" : "Paused"}</label></div>
          <div className={styles.controlGrid}>
            <label>Minimum keyword/ATS match score <span className={styles.inlineControl}><input type="number" min={0} max={100} value={config.match_threshold} onChange={(event) => updateConfig("match_threshold", Number(event.target.value))} /><b>%</b></span><small>A keyword/ATS score below this value is rejected before any AI call runs (Stage 1). The same value is reused as the Stage-2 AI eligibility score cutoff. Required eligibility gates always apply.</small></label>
            <label>Scheduled jobs per run <input type="number" min={1} max={100} value={config.jobs_per_run} onChange={(event) => updateConfig("jobs_per_run", Number(event.target.value))} /><small>Jobs are processed oldest first in small batches.</small></label>
            <label>Separate AI calls per run <input type="number" min={1} max={200} value={config.ai_calls_per_run} onChange={(event) => updateConfig("ai_calls_per_run", Number(event.target.value))} /><small>Caps this feature's matching-provider usage only.</small></label>
            <label>Applications per run <input type="number" min={1} max={100} value={config.max_applications_per_run} onChange={(event) => updateConfig("max_applications_per_run", Number(event.target.value))} /><small>Extra matches remain queued for later batches.</small></label>
            <label>Job freshness window (days) <input type="number" min={1} max={30} value={config.job_freshness_days} onChange={(event) => updateConfig("job_freshness_days", Number(event.target.value))} /><small>A job older than this many days (since it entered TalentOS, not its original posting date) is rejected before any AI call runs.</small></label>
          </div>
          <div className={styles.assignmentGrid}>
            <label>Assigned by<select value={config.assigned_by_user_id ?? ""} onChange={(event) => updateConfig("assigned_by_user_id", event.target.value || null)}><option value="">Select team member…</option>{teamMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || "Team member"} · {member.role.replaceAll("_", " ")}</option>)}</select></label>
            <label>Application owner<select value={config.application_owner_user_id ?? ""} onChange={(event) => updateConfig("application_owner_user_id", event.target.value || null)}><option value="">Select team member…</option>{teamMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || "Team member"} · {member.role.replaceAll("_", " ")}</option>)}</select></label>
          </div>
          {ownerMissing && <p className={styles.inlineWarning}>Choose both team members before enabling or running batches.</p>}
          <p className={styles.note}>Only candidates whose TalentOS status is active and pipeline stage is applying can be selected. This feature’s checkbox controls whether each eligible candidate is included.</p>
        </section>}

        {activeTab === "matching" && <>
        <section id="panel-matching" role="tabpanel" aria-labelledby="tab-matching" className={styles.panel}>
          <div className={styles.panelHeading}><div><span className={styles.sectionIcon}><KeyRound size={18} /></span><div><h2>Shared AI matching pool</h2><p>Stage 2 (the final eligibility check) now runs through TalentOS's shared OpenCode key pool and round-robin routing — the same system used by Resume Forge, Hiring Panel, and Final Polish.</p></div></div></div>
          <p className={styles.note}>Keys, models, and fallback order are managed centrally at{" "}
            <Link href="/admin/ai">talent.skarion.com/admin/ai</Link> (AI Control Center),
            under automation <code>scheduled_candidate_logging_eligibility_check</code>.
            This page no longer stores a separate provider, model, or API key for matching.</p>
        </section>
        {/*
        BEGIN commented out (restorable): dedicated per-feature AI provider/model/key/
        base-URL config. Restoring this also requires restoring, in the same marker:
          - the PROVIDERS array and providerNeedsBaseUrl above
          - the isEnabled-requires-provider/model/key checks in
            src/app/api/admin/scheduled-job-logging/route.ts
          - the config.ai_provider/model/key startup guard + buildProvider()/
            evaluateWithAi() in src/server/services/scheduledCandidateLoggingService.ts
        <section id="panel-matching-legacy-provider" className={styles.panel}>
          <div className={styles.panelHeading}><div><span className={styles.sectionIcon}><KeyRound size={18} /></span><div><h2>Dedicated matching AI</h2><p>Matching uses only the separate key saved here, never keys from the TalentOS AI Control Center.</p></div></div><span className={styles.pill}>{config.has_ai_key ? "Key stored" : "Key needed"}</span></div>
          <div className={styles.controlGrid}>
            <label>Provider<select value={config.ai_provider ?? ""} onChange={(event) => updateConfig("ai_provider", event.target.value || null)}><option value="">Choose provider…</option>{PROVIDERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Model ID<input value={config.ai_model ?? ""} onChange={(event) => updateConfig("ai_model", event.target.value)} placeholder="e.g. gpt-4.1-mini" autoComplete="off" /></label>
            <label className={styles.wideField}>API key<input type="password" value={apiKey} onChange={(event) => { apiKeyRef.current = event.target.value; setApiKey(event.target.value); markDirty(); }} placeholder={config.has_ai_key ? "Saved key hidden · enter a new key to rotate it" : "Paste a separate provider key"} autoComplete="new-password" /></label>
            <label className={styles.wideField}>API base URL {providerNeedsBaseUrl && <em>Required for this adapter</em>}<input type="url" value={config.ai_base_url ?? ""} onChange={(event) => updateConfig("ai_base_url", event.target.value || null)} placeholder={providerNeedsBaseUrl ? "https://api.example.com/v1" : "Provider default endpoint"} /></label>
          </div>
          <div className={styles.keyFootnote}><span>{config.ai_key_fingerprint ? `Stored key fingerprint · ${config.ai_key_fingerprint}` : "API key will be encrypted at rest."}</span><span>Usage has its own token and latency ledger.</span></div>
        </section>
        END commented out
        */}

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><span className={styles.sectionIcon}><Bot size={18} /></span><div><h2>Matching guidance</h2><p>Evaluate job qualifications, explicit preferences, and evidence in approved resumes.</p></div></div></div>
          <label className={styles.textareaLabel}>Additional instructions for the separate matching model<textarea rows={5} maxLength={6000} value={config.custom_prompt} onChange={(event) => updateConfig("custom_prompt", event.target.value)} placeholder="Optional scoring guidance, role priorities, or conservative screening instructions…" /><small>{config.custom_prompt.length}/6,000 · Candidate and job text are treated as data, not instructions.</small></label>
        </section>
        </>}

        {activeTab === "candidates" && <section id="panel-candidates" role="tabpanel" aria-labelledby="tab-candidates" className={styles.panel}>
          <div className={styles.panelHeading}><div><span className={styles.sectionIcon}><Users size={18} /></span><div><h2>Candidate eligibility and preferences</h2><p>Only active candidates currently in the applying stage are listed. Preferences are saved separately for this feature.</p></div></div><strong className={styles.countTag}>{configuredCount} enabled</strong></div>
          <div className={styles.candidateToolbar}>
            <input type="search" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Filter candidate names…" aria-label="Filter candidates by name" />
            <span>{visibleCandidates.length} of {applyingCandidateCount} active applying</span>
          </div>
          <div className={styles.candidateList}>
            {visibleCandidates.map((candidate) => {
              const rule = rules[candidate.id] ?? emptyRule(candidate);
              return <article className={styles.candidateCard} key={candidate.id}>
                <div className={styles.candidateTop}>
                  <label className={styles.candidateEnable}>
                    <input type="checkbox" checked={rule.is_enabled} onChange={(event) => updateRule(candidate.id, { is_enabled: event.target.checked })} aria-label={`Include ${candidate.name} in scheduled matching`} />
                    <span>
                      <strong>{candidate.name}</strong>
                      <span className={styles.candidateBadges}><span className={styles.candidateBadge}>Active</span><span className={`${styles.candidateBadge} ${styles.candidateBadgeStage}`}>Applying</span></span>
                      <small className={styles.candidateResumeMeta}>{candidate.approved_resume_count} usable base resume{candidate.approved_resume_count === 1 ? "" : "s"} (draft or approved)</small>
                    </span>
                  </label>
                  <label className={styles.priorityField}>Priority<select value={rule.priority} onChange={(event) => updateRule(candidate.id, { priority: event.target.value as Priority })}><option value="high">High</option><option value="default">Default</option><option value="low">Low</option></select></label>
                </div>
                {rule.is_enabled && <div className={styles.preferenceSection}>
                  <div className={styles.preferenceHeading}><strong>Job matching profile</strong><span>Optional details improve role and location fit.</span></div>
                  <div className={styles.preferenceGrid}>
                  <label>Preferred locations<input value={String(rule.preferences.locations ?? "")} onChange={(event) => updatePreference(candidate.id, "locations", event.target.value)} placeholder="Toronto, remote, hybrid…" /></label>
                  <label>Target roles / domain<input value={String(rule.preferences.roles ?? "")} onChange={(event) => updatePreference(candidate.id, "roles", event.target.value)} placeholder="Data analyst, GIS technician…" /></label>
                  <label>Workplace and employment preferences<input value={String(rule.preferences.employmentTypes ?? "")} onChange={(event) => updatePreference(candidate.id, "employmentTypes", event.target.value)} placeholder="Remote / hybrid / onsite; full-time…" /></label>
                  <label>Salary expectations<input value={String(rule.preferences.salaryExpectation ?? "")} onChange={(event) => updatePreference(candidate.id, "salaryExpectation", event.target.value)} placeholder="Range and currency, if known" /></label>
                  <label>Citizenship status<input value={String(rule.preferences.citizenshipStatus ?? "")} onChange={(event) => updatePreference(candidate.id, "citizenshipStatus", event.target.value)} placeholder="e.g. US Citizen, Green Card holder, F1 OPT with EAD" /></label>
                  <label>Security clearance<input value={String(rule.preferences.securityClearance ?? "")} onChange={(event) => updatePreference(candidate.id, "securityClearance", event.target.value)} placeholder="Active clearance level, if any" /></label>
                  <label className={styles.preferenceWide}>Custom candidate requirements<textarea rows={2} value={rule.custom_requirements} onChange={(event) => updateRule(candidate.id, { custom_requirements: event.target.value })} placeholder="Specific job types, experience limits, exclusions, or other job-related requirements…" /></label>
                  </div>
                </div>}
              </article>;
            })}
            {visibleCandidates.length === 0 && <div className={styles.empty}>No active applying candidates match this name filter.</div>}
          </div>
        </section>}

        <div className={styles.saveBar}>
          <span className={`${styles.saveStatus} ${saveStatus === "error" ? styles.saveError : saveStatus === "saved" ? styles.saveSaved : saveStatus === "pending" || saveStatus === "saving" ? styles.savePending : ""}`} role="status" aria-live="polite">{saveStatus === "pending" ? "Changes will save automatically…" : saveStatus === "saving" ? "Saving changes…" : saveStatus === "error" ? "Save failed · edit to retry or use Save now" : saveStatus === "saved" ? `All changes saved · ${displayDate(config.updated_at)}` : "Changes save automatically as you edit."}</span>
          <button className={styles.primaryButton} disabled={busy || saveStatus === "saving" || !hasUnsavedChanges}><Save size={17} />Save now</button>
        </div>
      </form>

      {activeTab === "activity" && <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity">
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span className={styles.sectionIcon}><Play size={18} /></span><div><h2>Scheduled source queue</h2><p>Only jobs with a verified scheduled Job CEO run marker appear here.</p></div></div><div className={styles.runActions}><span className={styles.refreshTimestamp}>Auto-refreshes every 30 seconds · Updated {displayDate(activityUpdatedAt)}</span><button className={styles.runButton} disabled={busy || hasUnsavedChanges || !config.is_enabled || ownerMissing} onClick={() => void runNow()}><Play size={16} />Run one batch now</button>{hasUnsavedChanges && <small>Save settings before running.</small>}</div></div>
        {pageData.scheduledSources.length ? <div className={styles.sourceGrid}>{pageData.scheduledSources.map((source) => <div className={styles.sourceItem} key={source.source}><span>{source.source}</span><strong>{source.pending_count}</strong><small>waiting · latest {displayDate(source.latest_ingested_at)}</small></div>)}</div> : <div className={styles.empty}>No scheduled-ingest jobs are waiting. Manual, extension, and spreadsheet imports are not eligible.</div>}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span className={styles.sectionIcon}><Activity size={18} /></span><div><h2>Run history</h2><p>Decision counts, independent model usage, and failures for recent batches.</p></div></div></div>
        <div className={styles.runList}>
          {pageData.recentRuns.map((run) => <article className={run.id === selectedRunId ? `${styles.runRow} ${styles.runRowActive}` : styles.runRow} key={run.id}>
            <div className={styles.runMain}>
              <strong>{run.trigger_type.replaceAll("_", " ")} · {run.status}</strong>
              <small>{run.config_snapshot?.provider ?? "unknown provider"} · {run.config_snapshot?.model ?? "unknown model"} · {displayDate(run.started_at)}{run.finished_at ? ` · finished ${displayDate(run.finished_at)}` : " · still running"}</small>
              {run.error_message && <small className={styles.runError}>{run.error_message}</small>}
              <button type="button" className={styles.viewDecisionsButton} onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}>
                {run.id === selectedRunId ? "Showing this run's decisions ↓" : "View this run's decisions"}
              </button>
            </div>
            <div><strong>{run.jobs_seen}</strong><small>jobs</small></div><div><strong>{run.candidate_pairs_scored}</strong><small>sent to Stage 2 AI</small></div><div><strong>{run.applications_created}</strong><small>applications</small></div><div><strong>{run.ai_calls}</strong><small>separate calls · {run.ai_failure_count} failed</small></div><div><strong>{(run.input_tokens + run.output_tokens).toLocaleString()}</strong><small>tokens · {run.input_tokens.toLocaleString()} in / {run.output_tokens.toLocaleString()} out{run.avg_latency_ms != null ? ` · ${run.avg_latency_ms} ms avg` : ""}</small></div>
          </article>)}
          {pageData.recentRuns.length === 0 && <div className={styles.empty}>No runs have been recorded.</div>}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span className={styles.sectionIcon}><BriefcaseBusiness size={18} /></span><div><h2>Recent candidate decisions</h2><p>Stage 1 is the keyword/ATS gate; Stage 2 is the AI eligibility check that only runs for Stage-1 passers. A low Stage 2 score with a high Stage 1 score is normal — it means the AI caught something the keyword match missed.</p></div></div><strong className={styles.countTag}>{visibleDecisions.length} {selectedRunId ? "for this run" : "recent"}</strong></div>
        {selectedRun && <div className={styles.filterBanner}>
          <span>Showing decisions from the <strong>{selectedRun.trigger_type.replaceAll("_", " ")} · {selectedRun.status}</strong> run started {displayDate(selectedRun.started_at)}.</span>
          <button type="button" onClick={() => setSelectedRunId(null)}>Show all recent decisions</button>
        </div>}
        <div className={styles.decisionList}>
          {visibleDecisions.map((decision) => <article className={styles.decisionRow} key={decision.id}>
            <div className={styles.decisionJob}><Link href={`/jobs/${decision.job_id}`}>{decision.job_title || "Untitled job"}</Link><small>{decision.company || "Company not listed"} · {decision.source}</small><small>{displayDate(decision.updated_at)}</small></div>
            <div className={styles.decisionCandidate}><strong>{decision.candidate_name}</strong><small>{decision.priority} priority</small></div>
            <div className={styles.decisionResume}><strong>{decision.base_resume_name || "No approved resume selected"}</strong><small>{decision.base_resume_id ? "Selected base resume" : "Resume unavailable"}</small></div>
            <div className={styles.decisionScore}>
              <div><strong>{decision.deterministic_score == null ? "—" : `${decision.deterministic_score}%`}</strong><small>Stage 1 · keyword/ATS</small></div>
              <div><strong>{decision.match_score == null ? "—" : `${decision.match_score}%`}</strong><small>Stage 2 · AI score</small></div>
            </div>
            <span className={`${styles.decisionStatus} ${styles[`status_${decision.status}`] ?? ""}`}>{decision.status.replaceAll("_", " ")}</span>
            <p className={styles.decisionReason}>{decision.reason || "No additional reason recorded."}</p>
          </article>)}
          {visibleDecisions.length === 0 && selectedRunId && <div className={styles.empty}>No decisions found for this run. Either it did not reach any candidate, or its decisions have aged out of the most recent 100 shown here — use "Show all recent decisions" to check.</div>}
          {visibleDecisions.length === 0 && !selectedRunId && <div className={styles.empty}>No candidate match decisions recorded yet.</div>}
        </div>
      </section>

      <section className={styles.securityFootnote}><ShieldCheck size={18} /><p><strong>Data boundary:</strong> this page stores its own settings and audit trail. Matching uses only the API key configured above and job-related candidate preferences. Street addresses, contact details, credentials, and protected personal information are excluded. Approved resumes are read to evaluate fit. A successful match creates a standard TalentOS application and starts the existing TalentOS resume pipeline.</p></section>
      </div>}

      {showPasswordChange && <div className={styles.modalBackdrop} role="presentation"><form className={styles.passwordModal} onSubmit={changePassword}>
        <button type="button" className={styles.modalClose} onClick={() => setShowPasswordChange(false)} aria-label="Close">×</button>
        <h2>Change feature passphrase</h2><p>This only changes the extra lock for this page.</p>
        <label>New passphrase<input type="password" minLength={12} autoComplete="new-password" value={newAccessPassword} onChange={(event) => setNewAccessPassword(event.target.value)} required /></label>
        <button className={styles.primaryButton} disabled={busy}>Change passphrase</button>
      </form></div>}
    </main>
  );
}
