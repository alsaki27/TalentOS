// src/app/jobs/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { toCsv, downloadCsv } from "@/lib/csv";
import { TableSkeleton } from "../Skeleton";
import { DateRangePicker } from "@/components/DateRangePicker";

interface Applicant {
  application_id: string;
  candidate_id: string;
  name: string;
  avatar_url: string | null;
  status: string;
}

interface Job {
  id: string;
  company_id: string | null;
  title: string;
  company: string | null;
  location: string | null;
  role_tier: string | null;
  source: string;
  is_active: boolean;
  employment_type: string | null;
  seniority_level: string | null;
  posted_at: string | null;
  job_category: string | null;
  category_tags: string[] | null;
  category_relevance_score: number | null;
  category_status: "pending" | "done" | "needs_review" | "failed" | null;
  ai_suggested_category: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  work_authorization: string | null;
  applicant_count: number;
  applicants: Applicant[];
  raw_description?: string | null;
  parsed_description?: unknown | null;
  ai_extracted_at?: string | null;
  ai_confidence_score?: number | null;
}

const WORK_AUTH_LABELS: Record<string, string> = {
  us_citizen_required: "US citizen required",
  no_sponsorship: "No sponsorship",
  sponsorship_available: "Sponsorship available",
};

interface TeamUser {
  user_id: string;
  email: string | null;
  display_name: string;
  role: string;
}

interface MeResponse {
  profile: TeamUser;
}

interface SavedJobSearch {
  id: string;
  label: string;
  filters: {
    search?: string;
    source?: string;
    roleTier?: string;
    active?: string;
    employmentType?: string;
    category?: string;
    workAuthorization?: string;
    sort?: string;
    dateStart?: string;
    dateEnd?: string;
    candidate?: string;
    assignedBy?: string;
    owner?: string;
    score?: string;
  };
  is_shared: boolean;
}

type SchemaField =
  | "title" | "company" | "location" | "source_url" | "posted_at" | "salary_range" | "role_tier" | "notes"
  | "external_job_id" | "tracking_id" | "ref_id" | "apply_url" | "description_html" | "description_text"
  | "benefits" | "seniority_level" | "employment_type" | "applicants_count" | "job_function" | "industries"
  | "input_url" | "company_linkedin_url" | "company_logo_url" | "company_employees_count" | "company_website"
  | "company_address" | "company_slogan" | "company_description" | "job_poster_name" | "job_poster_title"
  | "job_poster_profile_url" | "job_poster_photo_url" | "job_category" | "category_tags" | "category_relevance_score";
type FieldMapping = Partial<Record<SchemaField, string>>;

interface MatchingProfile {
  id: string;
  label: string;
  column_map: FieldMapping;
  score: number;
}

interface AnalyzeResult {
  headersDetected: boolean;
  mapping: FieldMapping;
  unmappedHeaders: string[];
  confident: boolean;
  rawHeaders: string[];
  sampleRows: Record<string, string>[];
  matchingProfiles: MatchingProfile[];
  rowCount: number;
}

const schemaFields: { value: SchemaField; label: string; required?: boolean }[] = [
  { value: "title", label: "Job title", required: true },
  { value: "company", label: "Company" },
  { value: "location", label: "Location" },
  { value: "source_url", label: "Posting URL" },
  { value: "posted_at", label: "Posted date" },
  { value: "salary_range", label: "Salary range" },
  { value: "role_tier", label: "Role tier" },
  { value: "notes", label: "Notes" },
  { value: "external_job_id", label: "External job ID" },
  { value: "tracking_id", label: "Tracking ID" },
  { value: "ref_id", label: "Ref ID" },
  { value: "apply_url", label: "Apply URL" },
  { value: "description_html", label: "Description HTML" },
  { value: "description_text", label: "Description text" },
  { value: "benefits", label: "Benefits" },
  { value: "seniority_level", label: "Seniority level" },
  { value: "employment_type", label: "Employment type" },
  { value: "applicants_count", label: "Applicants count" },
  { value: "job_function", label: "Job function" },
  { value: "industries", label: "Industries" },
  { value: "input_url", label: "Input/search URL" },
  { value: "company_linkedin_url", label: "Company LinkedIn" },
  { value: "company_logo_url", label: "Company logo" },
  { value: "company_employees_count", label: "Company employees" },
  { value: "company_website", label: "Company website" },
  { value: "company_address", label: "Company address" },
  { value: "company_slogan", label: "Company slogan" },
  { value: "company_description", label: "Company description" },
  { value: "job_poster_name", label: "Poster name" },
  { value: "job_poster_title", label: "Poster title" },
  { value: "job_poster_profile_url", label: "Poster profile URL" },
  { value: "job_poster_photo_url", label: "Poster photo URL" },
  { value: "job_category", label: "Job category" },
  { value: "category_tags", label: "Category tags" },
  { value: "category_relevance_score", label: "Category relevance score" },
];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

const PAGE_SIZE = 50;

function DualRangeSlider({ min, max, value, onChange }: { min: number, max: number, value: [number, number], onChange: (val: [number, number]) => void }) {
  const [localVal, setLocalVal] = useState<[number, number]>(value);
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef<"min" | "max" | null>(null);

  useEffect(() => {
    setLocalVal(value);
  }, [value[0], value[1]]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (localVal[0] !== value[0] || localVal[1] !== value[1]) {
        onChange(localVal);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [localVal[0], localVal[1]]);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDragging.current || !trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const val = Math.round((percent / 100) * (max - min) + min);
      
      setLocalVal(prev => {
        if (isDragging.current === "min") return [Math.min(val, prev[1] - 1), prev[1]];
        return [prev[0], Math.max(val, prev[0] + 1)];
      });
    }
    function handleMouseUp() {
      isDragging.current = null;
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [min, max]);

  const getPercent = (val: number) => Math.round(((val - min) / (max - min)) * 100);

  return (
    <div ref={trackRef} style={{ position: "relative", width: "140px", height: "24px", marginTop: "14px", marginBottom: "4px", userSelect: "none" }}>
      <div style={{ position: "absolute", borderRadius: "3px", height: "6px", backgroundColor: "#d1d5db", width: "100%", top: "50%", transform: "translateY(-50%)" }} />
      <div style={{ position: "absolute", borderRadius: "3px", height: "6px", backgroundColor: "var(--accent, #2a6f4f)", top: "50%", transform: "translateY(-50%)", left: `${getPercent(localVal[0])}%`, width: `${getPercent(localVal[1]) - getPercent(localVal[0])}%` }} />
      
      <div 
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: "pointer", zIndex: 2 }}
        onMouseDown={(e) => {
          if (!trackRef.current) return;
          const rect = trackRef.current.getBoundingClientRect();
          const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
          const val = Math.round((percent / 100) * (max - min) + min);
          const distMin = Math.abs(val - localVal[0]);
          const distMax = Math.abs(val - localVal[1]);
          if (distMin < distMax || (distMin === distMax && val < localVal[0])) {
             setLocalVal([val, localVal[1]]);
             isDragging.current = "min";
          } else {
             setLocalVal([localVal[0], val]);
             isDragging.current = "max";
          }
        }}
      />

      <div 
        onMouseDown={() => { isDragging.current = "min"; }}
        style={{ position: "absolute", width: "16px", height: "16px", borderRadius: "50%", backgroundColor: "#fff", border: "2px solid var(--accent, #2a6f4f)", boxShadow: "0 1px 3px rgba(0,0,0,0.3)", top: "50%", transform: "translate(-50%, -50%)", left: `${getPercent(localVal[0])}%`, cursor: "grab", zIndex: 3 }}
      >
        <div style={{ position: "absolute", top: "-24px", transform: "translateX(-50%)", backgroundColor: "#374151", color: "white", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: "600", left: "50%" }}>{localVal[0]}</div>
      </div>

      <div 
        onMouseDown={() => { isDragging.current = "max"; }}
        style={{ position: "absolute", width: "16px", height: "16px", borderRadius: "50%", backgroundColor: "#fff", border: "2px solid var(--accent, #2a6f4f)", boxShadow: "0 1px 3px rgba(0,0,0,0.3)", top: "50%", transform: "translate(-50%, -50%)", left: `${getPercent(localVal[1])}%`, cursor: "grab", zIndex: 4 }}
      >
        <div style={{ position: "absolute", top: "-24px", transform: "translateX(-50%)", backgroundColor: "#374151", color: "white", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: "600", left: "50%" }}>{localVal[1]}</div>
      </div>
    </div>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showImportAts, setShowImportAts] = useState(false);
  const [showApplyFor, setShowApplyFor] = useState<Job | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [workAuthFilter, setWorkAuthFilter] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [assignedByFilter, setAssignedByFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [scoreFilter, setScoreFilter] = useState<[number, number]>([0, 100]);
  const [filterCandidates, setFilterCandidates] = useState<{ id: string; name: string }[]>([]);
  const [filterUsers, setFilterUsers] = useState<TeamUser[]>([]);
  const [postedSort, setPostedSort] = useState<"" | "asc" | "desc">("");
  const [facets, setFacets] = useState<{ sources: string[]; employmentTypes: string[]; categories: string[] }>({ sources: [], employmentTypes: [], categories: [] });
  const [savedSearches, setSavedSearches] = useState<SavedJobSearch[]>([]);
  const [savedSearchId, setSavedSearchId] = useState("");
  const [saveSearchLabel, setSaveSearchLabel] = useState("");
  const [savedSearchError, setSavedSearchError] = useState("");
  const [pendingCategorization, setPendingCategorization] = useState(0);
  const [addingTagForJobId, setAddingTagForJobId] = useState<string | null>(null);
  const [newTagValue, setNewTagValue] = useState("");
  const categorizingRef = useRef(false);

  // Debounce the free-text search box so it doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    fetch("/api/jobs/facets")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setFacets(data); })
      .catch(console.error);
    loadSavedSearches();
    fetch("/api/candidates?compact=1&pageSize=500")
      .then((r) => r.json())
      .then((data) => setFilterCandidates(data.items ?? data))
      .catch(console.error);
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : []))
      .then(setFilterUsers)
      .catch(console.error);
  }, []);

  function buildParams(pageNum: number, pageSize: number) {
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("pageSize", String(pageSize));
    if (search) params.set("search", search);
    if (sourceFilter) params.set("source", sourceFilter);
    if (tierFilter) params.set("roleTier", tierFilter);
    if (activeFilter) params.set("active", activeFilter);
    if (employmentTypeFilter) params.set("employmentType", employmentTypeFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (workAuthFilter) params.set("workAuthorization", workAuthFilter);
    if (dateStart) params.set("dateStart", dateStart);
    if (dateEnd) params.set("dateEnd", dateEnd);
    if (postedSort) params.set("sort", postedSort === "asc" ? "posted_asc" : "posted_desc");
    if (candidateFilter) params.set("candidate", candidateFilter);
    if (assignedByFilter) params.set("assignedBy", assignedByFilter);
    if (ownerFilter) params.set("owner", ownerFilter);
    if (scoreFilter[0] > 0 || scoreFilter[1] < 100) params.set("score", scoreFilter.join(","));
    return params;
  }

  async function load(pageNum: number) {
    setLoading(true);
    const res = await fetch(`/api/jobs?${buildParams(pageNum, PAGE_SIZE)}`);
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = await res.json();
    const newTotal = data.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
    if (pageNum > totalPages && pageNum > 1) {
      setLoading(false);
      return load(totalPages);
    }
    setJobs(data.jobs ?? []);
    setTotal(newTotal);
    setPage(pageNum);
    setSelected(new Set());
    setLoading(false);
  }

  // Any filter/search/sort change re-queries the server from page 1.
  useEffect(() => { load(1); }, [search, sourceFilter, tierFilter, activeFilter, employmentTypeFilter, categoryFilter, workAuthFilter, postedSort, dateStart, dateEnd, candidateFilter, assignedByFilter, ownerFilter, scoreFilter]);

  // Drains the pending-categorization queue in small sequential batches, called right
  // after any import/create action and once on page load (in case a backlog already
  // exists — e.g. right after this feature's migration ran). Import itself never waits
  // on this — it's always a separate call made after the import's own response lands.
  // Guarded against overlapping loops (e.g. two imports in quick succession).
  async function kickCategorization() {
    if (categorizingRef.current) return;
    categorizingRef.current = true;
    try {
      let remaining = 1;
      while (remaining > 0) {
        const res = await fetch("/api/jobs/categorize/process", { method: "POST" });
        if (!res.ok) break;
        const data = await res.json();
        remaining = data.remainingPending ?? 0;
        setPendingCategorization(remaining);
        
        if (data.updatedJobs && data.updatedJobs.length > 0) {
          setJobs(prev => {
            const jobsCopy = [...prev];
            for (const updatedJob of data.updatedJobs) {
              const idx = jobsCopy.findIndex(j => j.id === updatedJob.id);
              if (idx !== -1) {
                jobsCopy[idx] = { ...jobsCopy[idx], ...updatedJob };
              }
            }
            return jobsCopy;
          });
        }

        if (remaining > 0) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } finally {
      categorizingRef.current = false;
    }
  }

  useEffect(() => { kickCategorization(); }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function togglePostedSort() {
    setPostedSort((prev) => (prev === "desc" ? "asc" : prev === "asc" ? "" : "desc"));
  }

  async function removeTag(job: Job, tagToRemove: string) {
    const updatedTags = (job.category_tags || []).filter((t) => t !== tagToRemove);
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, category_tags: updatedTags } : j)));
    try {
      await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_tags: updatedTags }),
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function addTag(job: Job) {
    if (!newTagValue.trim()) {
      setAddingTagForJobId(null);
      return;
    }
    const updatedTags = [...(job.category_tags || []), newTagValue.trim()];
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, category_tags: updatedTags } : j)));
    setAddingTagForJobId(null);
    setNewTagValue("");
    try {
      await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_tags: updatedTags }),
      });
    } catch (err) {
      console.error(err);
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === jobs.length ? new Set() : new Set(jobs.map((j) => j.id))
    );
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this job? This also removes any applications logged against it.")) return;
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    load(page);
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected job(s)? This also removes any applications logged against them.`)) return;
    await Promise.all(Array.from(selected).map((id) => fetch(`/api/jobs/${id}`, { method: "DELETE" })));
    load(page);
  }

  async function removeAssignment(applicant: Applicant) {
    if (!confirm(`Remove ${applicant.name}'s assignment for this job?`)) return;
    await fetch(`/api/applications/${applicant.application_id}`, { method: "DELETE" });
    load(page);
  }

  const filtersActive = search || sourceFilter || tierFilter || activeFilter || employmentTypeFilter || categoryFilter || workAuthFilter || postedSort || dateStart || dateEnd || scoreFilter[0] > 0 || scoreFilter[1] < 100;

  function currentSavedFilters() {
    const filters: SavedJobSearch["filters"] = {};
    if (search) filters.search = search;
    if (sourceFilter) filters.source = sourceFilter;
    if (tierFilter) filters.roleTier = tierFilter;
    if (activeFilter) filters.active = activeFilter;
    if (employmentTypeFilter) filters.employmentType = employmentTypeFilter;
    if (categoryFilter) filters.category = categoryFilter;
    if (workAuthFilter) filters.workAuthorization = workAuthFilter;
    if (dateStart) filters.dateStart = dateStart;
    if (dateEnd) filters.dateEnd = dateEnd;
    if (postedSort) filters.sort = postedSort === "asc" ? "posted_asc" : "posted_desc";
    if (scoreFilter[0] > 0 || scoreFilter[1] < 100) filters.score = scoreFilter.join(",");
    return filters;
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setSourceFilter("");
    setTierFilter("");
    setActiveFilter("");
    setEmploymentTypeFilter("");
    setCategoryFilter("");
    setWorkAuthFilter("");
    setDateStart("");
    setDateEnd("");
    setPostedSort("");
    setSavedSearchId("");
    setScoreFilter([0, 100]);
  }

  async function loadSavedSearches() {
    const res = await fetch("/api/saved-job-searches");
    if (!res.ok) return;
    setSavedSearches(await res.json());
  }

  function applySavedSearch(searchPreset: SavedJobSearch) {
    const filters = searchPreset.filters ?? {};
    setSearchInput(filters.search ?? "");
    setSearch(filters.search ?? "");
    setSourceFilter(filters.source ?? "");
    setTierFilter(filters.roleTier ?? "");
    setActiveFilter(filters.active ?? "");
    setEmploymentTypeFilter(filters.employmentType ?? "");
    setCategoryFilter(filters.category ?? "");
    setWorkAuthFilter(filters.workAuthorization ?? "");
    setDateStart(filters.dateStart ?? "");
    setDateEnd(filters.dateEnd ?? "");
    setPostedSort(filters.sort === "posted_asc" ? "asc" : filters.sort === "posted_desc" ? "desc" : "");
    if (filters.score) {
      const [min, max] = filters.score.split(",").map(Number);
      setScoreFilter([min || 0, max || 100]);
    } else {
      setScoreFilter([0, 100]);
    }
    setSavedSearchId(searchPreset.id);
  }

  async function saveCurrentSearch() {
    setSavedSearchError("");
    if (!saveSearchLabel.trim()) {
      setSavedSearchError("Name this saved search first.");
      return;
    }
    const res = await fetch("/api/saved-job-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: saveSearchLabel, filters: currentSavedFilters(), is_shared: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSavedSearchError(data.error || "Could not save search.");
      return;
    }
    setSaveSearchLabel("");
    setSavedSearches((current) => [data, ...current]);
    setSavedSearchId(data.id);
  }

  async function deleteSavedSearch() {
    if (!savedSearchId) return;
    const preset = savedSearches.find((item) => item.id === savedSearchId);
    if (!preset || !confirm(`Delete saved search "${preset.label}"?`)) return;
    await fetch(`/api/saved-job-searches/${savedSearchId}`, { method: "DELETE" });
    setSavedSearches((current) => current.filter((item) => item.id !== savedSearchId));
    setSavedSearchId("");
  }

  async function exportCsv() {
    const res = await fetch(`/api/jobs?${buildParams(1, 100)}`);
    if (!res.ok) return;
    const data = await res.json();
    const csv = toCsv(data.jobs ?? [], [
      "title", "company", "location", "source", "job_category", "category_relevance_score", "role_tier", "employment_type",
      "seniority_level", "posted_at", "is_active", "applicant_count",
    ]);
    downloadCsv("jobs.csv", csv);
  }

  return (
    <>
      <div className="page-header">
        <h1>Job masterlist</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {pendingCategorization > 0 && (
            <span className="badge" title="AI categorization, salary cleanup, and work-authorization tagging running in the background">
              Categorizing {pendingCategorization} pending…
            </span>
          )}
          <button onClick={() => setShowImport(true)}>Import file</button>
          <button onClick={() => setShowImportAts(true)}>Import from ATS</button>
          <Link href="/import" className="btn">Universal Import</Link>
          <button onClick={exportCsv}>Export CSV</button>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add job</button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", minWidth: "max-content" }}>Search Jobs</h3>
        <input 
          style={{ flex: 1, padding: "8px 12px" }} 
          placeholder="Search title, company, location…" 
          value={searchInput} 
          onChange={(e) => setSearchInput(e.target.value)} 
        />
      </div>

      <div className="filter-bar" style={{ alignItems: "flex-end" }}>
        {savedSearches.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Saved Searches</span>
            <select
              value={savedSearchId}
              onChange={(e) => {
                const preset = savedSearches.find((item) => item.id === e.target.value);
                if (preset) applySavedSearch(preset); else setSavedSearchId("");
              }}
            >
              <option value="">Select</option>
              {savedSearches.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Source</span>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">All sources</option>
            {facets.sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Tier</span>
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
            <option value="">All tiers</option>
            <option value="osp">OSP</option>
            <option value="adjacent_1">Adjacent 1 (Civil/CAD)</option>
            <option value="adjacent_2">Adjacent 2 (Telecom)</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Status</span>
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>
        {facets.employmentTypes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Employment Type</span>
            <select value={employmentTypeFilter} onChange={(e) => setEmploymentTypeFilter(e.target.value)}>
              <option value="">All employment types</option>
              {facets.employmentTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Category/Tag</span>
          <input
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            placeholder="Search tags..."
            style={{ minWidth: "120px" }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Relevance Score</span>
          <DualRangeSlider
            min={0}
            max={100}
            value={scoreFilter}
            onChange={(val) => setScoreFilter(val)}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Work Authorization</span>
          <select value={workAuthFilter} onChange={(e) => setWorkAuthFilter(e.target.value)}>
            <option value="">All</option>
            <option value="no_sponsorship">No sponsorship</option>
            <option value="sponsorship_available">Sponsorship available</option>
            <option value="us_citizen_required">US citizen required</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Created date</span>
          <DateRangePicker 
            dateStart={dateStart} 
            dateEnd={dateEnd} 
            onChange={(s, e) => { setDateStart(s); setDateEnd(e); }} 
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Candidates</span>
          <select value={candidateFilter} onChange={(e) => setCandidateFilter(e.target.value)}>
            <option value="">All</option>
            {filterCandidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>Assigned by</span>
          <select value={assignedByFilter} onChange={(e) => setAssignedByFilter(e.target.value)}>
            <option value="">All</option>
            {filterUsers.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name || u.email}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-muted, #666)" }}>App owner</span>
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
            <option value="">All</option>
            {filterUsers.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name || u.email}</option>)}
          </select>
        </div>
        {filtersActive && (
          <button onClick={clearFilters} style={{ marginBottom: "2px" }}>
            Clear filters
          </button>
        )}
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto", marginBottom: "8px" }}>{jobs.length} of {total}</span>
      </div>

      <div className="filter-bar">
        <input
          placeholder="Name current filters..."
          value={saveSearchLabel}
          onChange={(e) => setSaveSearchLabel(e.target.value)}
        />
        <button onClick={saveCurrentSearch} disabled={!filtersActive}>Save search</button>
        {savedSearchId && <button className="btn-danger" onClick={deleteSavedSearch}>Delete saved</button>}
        {savedSearchError && <span className="form-error">{savedSearchError}</span>}
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button className="btn-danger" onClick={deleteSelected}>Delete selected</button>
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={8} />
      ) : total === 0 ? (
        <div className="empty">{filtersActive ? "No jobs match these filters." : "No jobs yet. Add one manually or import a CSV."}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={selected.size === jobs.length && jobs.length > 0} onChange={toggleAll} />
              </th>
              <th>Job</th>
              <th>Company</th>
              <th>Category</th>
              <th>Tier</th>
              <th style={{ cursor: "pointer" }} onClick={togglePostedSort}>
                Posted {postedSort === "desc" ? "▼" : postedSort === "asc" ? "▲" : ""}
              </th>
              <th>Applicants</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(job.id)} onChange={() => toggleOne(job.id)} /></td>
                <td>
                  <Link className="row-link" href={`/jobs/${job.id}`}>{job.title}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>{job.location}</div>
                  {(job.salary_min || job.salary_max) ? (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {job.salary_currency ?? ""} {job.salary_min ?? "?"}–{job.salary_max ?? "?"}{job.salary_period ? `/${job.salary_period}` : ""}
                    </div>
                  ) : null}
                  {job.work_authorization && job.work_authorization !== "unspecified" && (
                    <span className="badge" style={{ fontSize: 11 }}>{WORK_AUTH_LABELS[job.work_authorization] ?? job.work_authorization}</span>
                  )}
                </td>
                <td className="muted">
                  {job.company_id && job.company ? (
                    <Link className="row-link" href={`/companies/${job.company_id}`}>{job.company}</Link>
                  ) : job.company || "—"}
                </td>
                <td>
                  {job.category_status === "pending" ? (
                    <span className="muted">Categorizing…</span>
                  ) : job.category_status === "failed" ? (
                    <span className="badge" title="AI categorization failed">Failed</span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {(job.category_tags || []).map((tag, idx) => (
                          <span key={idx} className="badge" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            {tag}
                            <button
                              onClick={() => removeTag(job, tag)}
                              style={{ background: "none", border: "none", color: "inherit", padding: 0, margin: 0, fontSize: "10px", cursor: "pointer", opacity: 0.6 }}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                      {addingTagForJobId === job.id ? (
                        <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                          <input
                            autoFocus
                            value={newTagValue}
                            onChange={(e) => setNewTagValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addTag(job);
                              else if (e.key === "Escape") setAddingTagForJobId(null);
                            }}
                            onBlur={() => addTag(job)}
                            style={{ padding: "2px 4px", fontSize: "11px", width: "80px" }}
                            placeholder="Type..."
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => { setAddingTagForJobId(job.id); setNewTagValue(""); }}
                          style={{ background: "none", border: "none", color: "var(--accent)", padding: 0, fontSize: "11px", cursor: "pointer", marginTop: "2px" }}
                        >
                          + Add tag
                        </button>
                      )}
                      {job.category_relevance_score !== null && job.category_relevance_score !== undefined && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Score: {job.category_relevance_score}</div>
                      )}
                    </div>
                  )}
                </td>
                <td>{job.role_tier ? <span className="badge">{job.role_tier}</span> : <span className="muted">—</span>}</td>
                <td className="muted">{job.posted_at ? new Date(job.posted_at).toLocaleDateString() : "—"}</td>
                <td>
                  <div style={{ marginBottom: 4 }}>
                    <strong>{job.applicant_count}</strong> <span className="muted">linked</span>
                  </div>
                  {job.applicants.length > 0 && (
                    <div>
                      {job.applicants.map((a) => (
                        <button
                          key={a.application_id}
                          className="avatar-button"
                          title={`${a.name} — ${a.status} (click to remove)`}
                          onClick={() => removeAssignment(a)}
                        >
                          {a.avatar_url ? (
                            <img className="avatar-circle" src={a.avatar_url} alt={a.name} />
                          ) : (
                            <span className="avatar-circle">{initials(a.name)}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setShowApplyFor(job)}>Log application</button>
                  <button onClick={() => deleteOne(job.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {total > 0 && (
        <div className="filter-bar" style={{ justifyContent: "center", alignItems: "center", gap: "8px", marginTop: "24px", marginBottom: "24px" }}>
          <button onClick={() => load(page - 1)} disabled={loading || page <= 1}>Prev</button>
          
          {(() => {
            const pages = [];
            if (totalPages <= 7) {
              for (let i = 1; i <= totalPages; i++) pages.push(i);
            } else {
              if (page <= 4) {
                pages.push(1, 2, 3, 4, 5, "...", totalPages);
              } else if (page >= totalPages - 3) {
                pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
              } else {
                pages.push(1, "...", page - 1, page, page + 1, "...", totalPages);
              }
            }
            return pages.map((p, idx) => (
              <button
                key={idx}
                className={p === page ? "btn-primary" : ""}
                onClick={() => typeof p === "number" && p !== page ? load(p) : null}
                disabled={loading || p === "..."}
                style={{ 
                  minWidth: 36, 
                  textAlign: "center", 
                  cursor: p === "..." || p === page ? "default" : "pointer", 
                  padding: "6px 12px",
                  background: p === "..." ? "transparent" : undefined,
                  border: p === "..." ? "none" : undefined,
                  opacity: p === "..." ? 0.7 : undefined,
                }}
              >
                {p}
              </button>
            ));
          })()}

          <button onClick={() => load(page + 1)} disabled={loading || page >= totalPages}>Next</button>
        </div>
      )}

      {showAdd && (
        <AddJobModal onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load(1); kickCategorization(); }} />
      )}
      {showImport && (
        <ImportFileModal onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); load(1); kickCategorization(); }} />
      )}
      {showImportAts && (
        <ImportAtsModal onClose={() => setShowImportAts(false)} onImported={() => { setShowImportAts(false); load(1); kickCategorization(); }} />
      )}
      {showApplyFor && (
        <LogApplicationModal
          job={showApplyFor}
          onClose={() => setShowApplyFor(null)}
          onLogged={() => { setShowApplyFor(null); load(page); }}
        />
      )}
    </>
  );
}

function AddJobModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [roleTier, setRoleTier] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [postedAt, setPostedAt] = useState("");
  const [applicantsCount, setApplicantsCount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim()) { setError("Job title is required."); return; }
    setSaving(true);
    setError("");
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        company,
        location,
        role_tier: roleTier || null,
        source_url: sourceUrl,
        posted_at: postedAt || null,
        applicants_count: applicantsCount || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    onCreated();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add job</h2>
        <div className="field-group">
          <label>Job title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. OSP Designer" />
        </div>
        <div className="field-group">
          <label>Company</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Role tier</label>
          <select value={roleTier} onChange={(e) => setRoleTier(e.target.value)}>
            <option value="">— None —</option>
            <option value="osp">OSP</option>
            <option value="adjacent_1">Adjacent 1 (Civil/CAD)</option>
            <option value="adjacent_2">Adjacent 2 (Telecom)</option>
          </select>
        </div>
        <div className="field-group">
          <label>Job posting URL</label>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="(optional)" />
        </div>
        <div className="field-group">
          <label>Posted date</label>
          <input type="date" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Applicants at source</label>
          <input value={applicantsCount} onChange={(e) => setApplicantsCount(e.target.value)} placeholder="e.g. 25" />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add job"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportFileModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [sourceLabel, setSourceLabel] = useState("normalized_import");
  const [saveProfile, setSaveProfile] = useState(false);
  const [profileLabel, setProfileLabel] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  async function analyze(filename: string, text: string) {
    setWorking(true);
    setError("");
    setAnalysis(null);
    setResult(null);
    try {
      const res = await fetch("/api/import/normalize/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content: text }),
      });
      setWorking(false);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Could not analyze file."); return; }
      setAnalysis(data);
      setMapping(data.mapping ?? {});
    } catch (err: any) {
      setWorking(false);
      setError(err.message || "Network error while analyzing file.");
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setContent("");
    setAnalysis(null);
    setResult(null);
    setError("");
    try {
      const text = await file.text();
      setContent(text);
      analyze(file.name, text);
    } catch (err: any) {
      setError(err.message || "Could not read file.");
    }
  }

  function fieldForHeader(header: string): SchemaField | "" {
    return (Object.entries(mapping).find(([, mappedHeader]) => mappedHeader === header)?.[0] as SchemaField | undefined) ?? "";
  }

  function setHeaderField(header: string, field: SchemaField | "") {
    setMapping((prev) => {
      const next: FieldMapping = {};
      for (const [existingField, existingHeader] of Object.entries(prev) as [SchemaField, string][]) {
        if (existingHeader !== header && existingField !== field) next[existingField] = existingHeader;
      }
      if (field) next[field] = header;
      return next;
    });
  }

  function applyProfile(profile: MatchingProfile) {
    setMapping(profile.column_map ?? {});
    setProfileLabel(profile.label);
    setSaveProfile(false);
  }

  async function submit() {
    if (!analysis || !content) { setError("Choose a file first."); return; }
    if (!mapping.title) { setError("Map one column to Job title before importing."); return; }
    if (saveProfile && !profileLabel.trim()) { setError("Name the import profile before saving it."); return; }

    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/import/normalize/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: fileName,
          content,
          mapping,
          sourceLabel,
          profileLabel: saveProfile ? profileLabel : undefined,
        }),
      });
      setWorking(false);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Import failed."); return; }
      setResult(data);
    } catch (err: any) {
      setWorking(false);
      setError(err.message || "Network error during import.");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 760, maxHeight: "86vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2>Import jobs from file</h2>
        <p className="muted" style={{ fontSize: 12 }}>
          Upload CSV, TSV, or JSON. Review the detected column mapping before anything is inserted.
        </p>

        <div className="field-group">
          <input type="file" accept=".csv,.tsv,.json,text/csv,application/json" onChange={handleFile} />
        </div>

        {working && <p className="muted">Working...</p>}

        {analysis && !result && (
          <>
            <p className="muted">
              Found <strong>{analysis.rowCount}</strong> rows in {fileName}
              {!analysis.headersDetected ? " with no confident header row." : "."}
            </p>

            {analysis.matchingProfiles.length > 0 && (
              <div className="field-group">
                <label>Saved profile match</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {analysis.matchingProfiles.slice(0, 3).map((profile) => (
                    <button key={profile.id} onClick={() => applyProfile(profile)}>
                      Use {profile.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field-group">
              <label>Source label</label>
              <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="normalized_import" />
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Import as</th>
                  <th>Sample values</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rawHeaders.map((header) => (
                  <tr key={header}>
                    <td><strong>{header}</strong></td>
                    <td>
                      <select value={fieldForHeader(header)} onChange={(e) => setHeaderField(header, e.target.value as SchemaField | "")}>
                        <option value="">Ignore</option>
                        {schemaFields.map((field) => (
                          <option key={field.value} value={field.value}>
                            {field.label}{field.required ? " (required)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {analysis.sampleRows.map((row) => row[header]).filter(Boolean).slice(0, 3).join(" | ") || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="field-group" style={{ marginTop: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={saveProfile}
                  onChange={(e) => setSaveProfile(e.target.checked)}
                />
                Save this mapping as a reusable import profile
              </label>
              {saveProfile && (
                <input
                  value={profileLabel}
                  onChange={(e) => setProfileLabel(e.target.value)}
                  placeholder="e.g. Acme weekly export"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          </>
        )}

        {result && (
          <p style={{ color: "var(--accent)" }}>
            Imported {result.imported} jobs{result.skipped > 0 ? `, skipped ${result.skipped} duplicate or unmappable row(s)` : ""}.
          </p>
        )}

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          {!result && (
            <button className="btn-primary" onClick={submit} disabled={working || !analysis}>
              {working ? "Importing..." : `Import ${analysis?.rowCount || ""} rows`}
            </button>
          )}
          {result && (
            <button className="btn-primary" onClick={onImported}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportCsvModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => setRows(results.data as any[]),
      error: (err) => setError(err.message),
    });
  }

  async function submit() {
    if (rows.length === 0) { setError("Parse a CSV first."); return; }
    setImporting(true);
    const res = await fetch("/api/import/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    setImporting(false);
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Import failed."); return; }
    setResult(data);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import jobs from CSV</h2>
        <p className="muted" style={{ fontSize: 12 }}>
          Expected columns: <code>title</code> (required), <code>company</code>, <code>location</code>,
          <code>role_tier</code>, <code>salary_range</code>, <code>source_url</code>, <code>notes</code>.
        </p>

        <div className="field-group">
          <input type="file" accept=".csv" onChange={handleFile} />
        </div>

        {fileName && !result && (
          <p className="muted">Parsed <strong>{rows.length}</strong> rows from {fileName}.</p>
        )}

        {result && (
          <p style={{ color: "var(--accent)" }}>
            Imported {result.imported} jobs{result.skipped > 0 ? `, skipped ${result.skipped} (missing title)` : ""}.
          </p>
        )}

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          {!result && (
            <button className="btn-primary" onClick={submit} disabled={importing || rows.length === 0}>
              {importing ? "Importing…" : `Import ${rows.length || ""} rows`}
            </button>
          )}
          {result && (
            <button className="btn-primary" onClick={onImported}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportAtsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [provider, setProvider] = useState("greenhouse");
  const [token, setToken] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  async function submit() {
    if (!token.trim()) {
      setError(
        provider === "usajobs" ? "Enter a search keyword."
        : provider === "career-page" ? "Enter a career page URL."
        : "Enter the company's board token/slug."
      );
      return;
    }
    setImporting(true);
    setError("");
    const res = await fetch(provider === "career-page" ? "/api/import/career-page" : "/api/import/ats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(provider === "career-page"
        ? { url: token.trim() }
        : { provider, token: token.trim() }
      ),
    });
    setImporting(false);
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Import failed."); return; }
    setResult(data);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import from ATS</h2>
        <p className="muted" style={{ fontSize: 12 }}>
          Pulls live postings from a company's public job board, or a USAJobs keyword search
          (no scraping). USAJobs requires a free API key — set <code>USAJOBS_API_KEY</code> and{" "}
          <code>USAJOBS_USER_AGENT</code> env vars first (see developer.usajobs.gov).
        </p>

        <div className="field-group">
          <label>Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
            <option value="usajobs">USAJobs (keyword search)</option>
            <option value="career-page">Career page (JobPosting schema)</option>
          </select>
        </div>
        <div className="field-group">
          <label>
            {provider === "usajobs" ? "Search keyword"
              : provider === "career-page" ? "Career page URL"
              : "Company board token / slug"}
          </label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              provider === "greenhouse" ? "e.g. airbnb"
              : provider === "lever" ? "e.g. netflix"
              : provider === "usajobs" ? "e.g. civil engineer"
              : provider === "career-page" ? "https://company.com/careers"
              : "e.g. ramp"
            }
          />
        </div>

        {result && (
          <p style={{ color: "var(--accent)" }}>
            Imported {result.imported} jobs{result.skipped > 0 ? `, skipped ${result.skipped} (already in masterlist)` : ""}.
          </p>
        )}

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          {!result && (
            <button className="btn-primary" onClick={submit} disabled={importing}>
              {importing ? "Importing…" : "Import"}
            </button>
          )}
          {result && (
            <button className="btn-primary" onClick={onImported}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function LogApplicationModal({ job, onClose, onLogged }: { job: Job; onClose: () => void; onLogged: () => void }) {
  const [candidates, setCandidates] = useState<{ id: string; name: string; resume_url: string | null; resume_filename: string | null }[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [currentUser, setCurrentUser] = useState<TeamUser | null>(null);
  const [candidateIds, setCandidateIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("assigned");
  const [resumeVariants, setResumeVariants] = useState<{ id: string; label: string; file_url: string; filename: string }[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const assignmentOwners = [...users].sort((a, b) => {
    const aRank = a.role === "application_engineer" ? 0 : 1;
    const bRank = b.role === "application_engineer" ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "");
  });

  useEffect(() => {
    fetch("/api/candidates?compact=1&pageSize=200", { cache: "no-store" }).then((r) => r.json()).then((data) => setCandidates(data.items ?? data));
    fetch("/api/users").then((r) => r.ok ? r.json() : []).then(setUsers);
    fetch("/api/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((data: MeResponse | null) => setCurrentUser(data?.profile ?? null));
  }, []);

  useEffect(() => {
    setResumeId("");
    if (candidateIds.size !== 1) { setResumeVariants([]); return; }
    const [candidateId] = Array.from(candidateIds);
    fetch(`/api/candidates/${candidateId}/resumes`).then((r) => r.json()).then(setResumeVariants);
  }, [candidateIds]);

  function toggleCandidate(id: string) {
    setCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (candidateIds.size === 0) { setError("Select at least one candidate."); return; }
    setSaving(true);
    setError("");
    const selectedIds = Array.from(candidateIds);
    const candidate = selectedIds.length === 1 ? candidates.find((c) => c.id === selectedIds[0]) : null;
    const variant = resumeVariants.find((r) => r.id === resumeId);
    const assignedToUser = users.find((user) => user.user_id === assignedToUserId);
    const assignmentStatus = status === "assigned" || status === "stacked";
    if (assignmentStatus && !assignedToUserId) {
      setSaving(false);
      setError("Choose an application owner for assigned or stacked tickets.");
      return;
    }
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_ids: selectedIds,
        job_id: job.id,
        status,
        resume_id: variant?.id ?? null,
        resume_url: variant?.file_url ?? candidate?.resume_url ?? null,
        resume_filename: variant?.filename ?? candidate?.resume_filename ?? null,
        assigned_by: currentUser?.display_name || currentUser?.email || null,
        assigned_to: assignedToUser?.display_name || assignedToUser?.email || null,
        assigned_by_user_id: currentUser?.user_id ?? null,
        assigned_to_user_id: assignedToUserId || null,
        assignment_due_at: assignmentDueAt || null,
        assignment_note: assignmentNote || null,
        next_action: status === "assigned" || status === "stacked" ? "Apply to this job" : null,
      }),
    });
    setSaving(false);
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Something went wrong."); return; }
    onLogged();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Assign application - {job.title}</h2>

        <div className="field-group">
          <label>Candidates</label>
          <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 8 }}>
            {candidates.map((c) => (
              <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "var(--ink)", fontWeight: 400 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={candidateIds.has(c.id)}
                  onChange={() => toggleCandidate(c.id)}
                />
                {c.name}{c.resume_filename ? "" : " (no resume uploaded)"}
              </label>
            ))}
          </div>
        </div>

        {candidateIds.size === 1 && resumeVariants.length > 0 && (
          <div className="field-group">
            <label>Resume version</label>
            <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
              <option value="">Primary resume</option>
              {resumeVariants.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="field-group">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="assigned">Assigned to apply</option>
            <option value="stacked">Stacked / queued</option>
            <option value="in_progress">In progress</option>
            <option value="applied">Applied</option>
            <option value="replied">Replied</option>
            <option value="interview">Interview</option>
            <option value="rejected">Rejected</option>
            <option value="offer">Offer</option>
          </select>
        </div>
        <div className="field-group">
          <label>Assigned by</label>
          <input value={currentUser?.display_name || currentUser?.email || ""} disabled placeholder="Current signed-in user" />
        </div>
        <div className="field-group">
          <label>Application owner</label>
          <select value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)}>
            <option value="">-- Select owner --</option>
            {assignmentOwners.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {user.display_name || user.email} ({user.role.replaceAll("_", " ")})
              </option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <label>Due date</label>
          <input type="date" value={assignmentDueAt} onChange={(e) => setAssignmentDueAt(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Assignment note</label>
          <textarea value={assignmentNote} onChange={(e) => setAssignmentNote(e.target.value)} rows={3} placeholder="Instructions, candidate context, resume choice, etc." />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving..." : `Create ${candidateIds.size || ""} ticket${candidateIds.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
