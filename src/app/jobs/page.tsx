// src/app/jobs/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { toCsv, downloadCsv } from "@/lib/csv";
import { TableSkeleton } from "../Skeleton";
import { DateRangePicker } from "@/components/DateRangePicker";

interface MatchScore {
  job_id: string;
  score: number;
  breakdown: any;
  candidate_id: string;
  candidate_name: string;
}

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
  match_scores?: MatchScore[];
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
    dateStart?: string;
    dateEnd?: string;
    candidate?: string;
    assignedBy?: string;
    owner?: string;
    score?: string;
    sort?: string;
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

function DualRangeSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (val: [number, number]) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef<"min" | "max" | null>(null);
  const [localVal, setLocalVal] = useState<[number, number]>(value);

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

      setLocalVal((prev) => {
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
  const [pageInput, setPageInput] = useState("");
  const [pageError, setPageError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showImportAts, setShowImportAts] = useState(false);
  const [showApplyFor, setShowApplyFor] = useState<Job | null>(null);
  const [showBulkApply, setShowBulkApply] = useState(false);
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
    if (candidateFilter) params.set("candidate", candidateFilter);
    if (assignedByFilter) params.set("assignedBy", assignedByFilter);
    if (ownerFilter) params.set("owner", ownerFilter);
    if (scoreFilter[0] > 0 || scoreFilter[1] < 100) params.set("score", scoreFilter.join(","));
    if (postedSort) params.set("sort", postedSort === "asc" ? "posted_asc" : "posted_desc");
    return params;
  }

  async function load(pageNum: number) {
    setLoading(true);
    const res = await fetch(`/api/jobs?${buildParams(pageNum, PAGE_SIZE)}`);
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
          setJobs((prev) => {
            const jobsCopy = [...prev];
            for (const updatedJob of data.updatedJobs) {
              const idx = jobsCopy.findIndex((j) => j.id === updatedJob.id);
              if (idx !== -1) {
                jobsCopy[idx] = { ...jobsCopy[idx], ...updatedJob };
              }
            }
            return jobsCopy;
          });
        }
        if (remaining > 0) await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      categorizingRef.current = false;
    }
  }

  useEffect(() => { kickCategorization(); }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function goToPage(inputVal: string) {
    const n = parseInt(inputVal);
    if (isNaN(n) || n < 1) {
      setPageError("Enter a valid page number");
      return;
    }
    if (n > totalPages) {
      setPageError(`Page must be 1–${totalPages}`);
      return;
    }
    setPageError("");
    setPageInput("");
    load(n);
  }

  function renderPagination(options: { marginTop: number; marginBottom: number }) {
    if (total <= 0) return null;
    return (
      <div className="filter-bar" style={{ justifyContent: "center", alignItems: "center", gap: 6, marginTop: options.marginTop, marginBottom: options.marginBottom }}>
        <button onClick={() => load(page - 1)} disabled={loading || page <= 1}>Prev</button>
        {(() => {
          const pages: Array<number | string> = [];
          if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
          } else if (page <= 4) {
            pages.push(1, 2, 3, 4, 5, "...", totalPages);
          } else if (page >= totalPages - 3) {
            pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
          } else {
            pages.push(1, "...", page - 1, page, page + 1, "...", totalPages);
          }
          return pages.map((entry, index) => (
            <button
              key={`${entry}-${index}`}
              className={entry === page ? "btn-primary" : ""}
              onClick={() => typeof entry === "number" && entry !== page ? load(entry) : undefined}
              disabled={loading || entry === "..."}
              style={{
                minWidth: 36, textAlign: "center",
                cursor: entry === "..." || entry === page ? "default" : "pointer",
                padding: "6px 12px", background: entry === "..." ? "transparent" : undefined,
                border: entry === "..." ? "none" : undefined, opacity: entry === "..." ? 0.7 : undefined,
              }}
            >{entry}</button>
          ));
        })()}
        <button onClick={() => load(page + 1)} disabled={loading || page >= totalPages}>Next</button>
        <span className="muted" style={{ marginLeft: 16, fontSize: 13 }}>Page</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => { setPageInput(e.target.value); setPageError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") goToPage(pageInput); }}
          placeholder={`1–${totalPages}`}
          style={{ width: 70, padding: "5px 8px", fontSize: 13 }}
        />
        <button onClick={() => goToPage(pageInput)} style={{ padding: "5px 12px", fontSize: 13 }}>Go</button>
        {pageError && <span className="form-error" style={{ fontSize: 12, marginLeft: 6 }}>{pageError}</span>}
      </div>
    );
  }

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

  const filtersActive =
    search || sourceFilter || tierFilter || activeFilter || employmentTypeFilter || categoryFilter ||
    workAuthFilter || postedSort || dateStart || dateEnd || candidateFilter || assignedByFilter || ownerFilter ||
    scoreFilter[0] > 0 || scoreFilter[1] < 100;

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
    if (candidateFilter) filters.candidate = candidateFilter;
    if (assignedByFilter) filters.assignedBy = assignedByFilter;
    if (ownerFilter) filters.owner = ownerFilter;
    if (scoreFilter[0] > 0 || scoreFilter[1] < 100) filters.score = scoreFilter.join(",");
    if (postedSort) filters.sort = postedSort === "asc" ? "posted_asc" : "posted_desc";
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
    setCandidateFilter("");
    setAssignedByFilter("");
    setOwnerFilter("");
    setScoreFilter([0, 100]);
    setPostedSort("");
    setSavedSearchId("");
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
    setCandidateFilter(filters.candidate ?? "");
    setAssignedByFilter(filters.assignedBy ?? "");
    setOwnerFilter(filters.owner ?? "");
    if (filters.score) {
      const [min, max] = filters.score.split(",").map(Number);
      setScoreFilter([Number.isFinite(min) ? min : 0, Number.isFinite(max) ? max : 100]);
    } else {
      setScoreFilter([0, 100]);
    }
    setPostedSort(filters.sort === "posted_asc" ? "asc" : filters.sort === "posted_desc" ? "desc" : "");
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
    clearFilters();
  }

  async function updateSavedSearch() {
    setSavedSearchError("");
    if (!savedSearchId) return;
    
    const res = await fetch(`/api/saved-job-searches/${savedSearchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: currentSavedFilters() }),
    });
    
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSavedSearchError(data.error || "Could not update search.");
      return;
    }
    
    setSavedSearches((current) => 
      current.map(item => item.id === savedSearchId ? { ...item, filters: currentSavedFilters() } : item)
    );
    
    clearFilters();
  }

  async function deleteSavedSearch() {
    if (!savedSearchId) return;
    const preset = savedSearches.find((item) => item.id === savedSearchId);
    if (!preset || !confirm(`Delete saved search "${preset.label}"?`)) return;
    await fetch(`/api/saved-job-searches/${savedSearchId}`, { method: "DELETE" });
    setSavedSearches((current) => current.filter((item) => item.id !== savedSearchId));
    clearFilters();
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
                if (preset) applySavedSearch(preset); else clearFilters();
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
          <DualRangeSlider min={0} max={100} value={scoreFilter} onChange={(val) => setScoreFilter(val)} />
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
        {!savedSearchId && (
          <input
            placeholder="Name current filters..."
            value={saveSearchLabel}
            onChange={(e) => setSaveSearchLabel(e.target.value)}
          />
        )}
        {!savedSearchId ? (
          <button onClick={saveCurrentSearch} disabled={!filtersActive}>Save search</button>
        ) : (
          <button onClick={updateSavedSearch} disabled={!filtersActive}>Update search</button>
        )}
        {savedSearchId && <button className="btn-danger" onClick={deleteSavedSearch}>Delete saved</button>}
        {savedSearchError && <span className="form-error">{savedSearchError}</span>}
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button onClick={() => setShowBulkApply(true)}>Log selected to candidate</button>
          <button className="btn-danger" onClick={deleteSelected}>Delete selected</button>
        </div>
      )}

      {renderPagination({ marginTop: 0, marginBottom: 16 })}

      {loading ? (
        <TableSkeleton cols={8} />
      ) : total === 0 ? (
        <div className="empty">{filtersActive ? "No jobs match these filters." : "No jobs yet. Add one manually or import a CSV."}</div>
      ) : (
        <div className="table-shell">
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
                <th>Match Scores</th>
                <th>Applicants</th>
                <th style={{ position: "sticky", right: 0, background: "var(--surface)", zIndex: 2 }}></th>
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
                  <td style={{ maxWidth: 260 }}>
                    {job.category_status === "pending" ? (
                      <span className="muted">Categorizing…</span>
                    ) : job.category_status === "failed" ? (
                      <span className="badge" title="AI categorization failed">Failed</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
                        {/* Without a width cap on the <td>, this flex-wrap never
                            actually engages - a row with several/long tags (e.g.
                            searching "osp") just keeps growing the column
                            instead of wrapping, blowing the whole table past its
                            scroll container's width and pushing the Actions
                            column (Log application/Delete) off-screen to the
                            right with no visible scrollbar cue. Confirmed live:
                            table width jumped from 1050px (fits, no scroll) to
                            1668px after searching "osp". */}
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
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {(job.match_scores || []).map((ms) => {
                        const initials = ms.candidate_name ? ms.candidate_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join("") : "??";
                        let color = "var(--text-muted)";
                        let displayScore = `${ms.score}%`;
                        const isError = ms.score === -1;
                        
                        if (isError) {
                          color = "var(--danger, #dc2626)";
                          displayScore = "Error";
                        } else if (ms.score >= 80) color = "var(--success, #2a6f4f)";
                        else if (ms.score >= 60) color = "var(--warning, #eab308)";
                        else color = "var(--danger, #dc2626)";

                        const errorReason = isError ? (ms.breakdown?.reasoning || "Unknown error") : null;

                        return (
                          <span key={ms.candidate_id} className="badge" style={{ borderColor: color, color, cursor: isError && errorReason ? "help" : "default" }}>
                            {initials}: {displayScore}
                            {isError && errorReason && (
                              <span style={{ position: "relative", marginLeft: 2 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--danger)", cursor: "help" }} title={errorReason}> ⓘ</span>
                              </span>
                            )}
                          </span>
                        );
                      })}
                      {(!job.match_scores || job.match_scores.length === 0) && <span className="muted">—</span>}
                    </div>
                  </td>
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
                  <td style={{ display: "flex", gap: 6, position: "sticky", right: 0, background: "var(--surface)", zIndex: 1 }}>
                    <button onClick={() => setShowApplyFor(job)}>Log application</button>
                    <button onClick={() => deleteOne(job.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {renderPagination({ marginTop: 32, marginBottom: 0 })}

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
          key={showApplyFor.id}
          job={showApplyFor}
          onClose={() => setShowApplyFor(null)}
          onLogged={() => { setShowApplyFor(null); load(page); }}
        />
      )}
      {showBulkApply && (
        <BulkLogApplicationModal
          jobs={jobs.filter((j) => selected.has(j.id))}
          onClose={() => setShowBulkApply(false)}
          onLogged={() => { setShowBulkApply(false); setSelected(new Set()); load(page); }}
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
  const [descriptionText, setDescriptionText] = useState("");
  const [rawPaste, setRawPaste] = useState("");
  const [isParsing, setIsParsing] = useState(false);
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
        description_text: descriptionText || null,
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
        <h2 style={{ marginBottom: 16 }}>Add job</h2>
        
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>✨ AI Auto Fill</h3>
          <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.4 }}>Paste the full job posting below. AI will instantly extract the details for you to review and edit before submitting.</p>
          <textarea
            value={rawPaste}
            onChange={(e) => setRawPaste(e.target.value)}
            placeholder="Paste raw text from LinkedIn, Indeed, etc..."
            style={{ width: "100%", height: 80, marginBottom: 12, padding: 12, borderRadius: 6, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 13, resize: "vertical", background: "var(--bg)", color: "var(--ink)" }}
          />
          <button
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 6, fontWeight: 600, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--ink)", cursor: isParsing ? "wait" : "pointer", opacity: isParsing ? 0.7 : 1 }}
            onClick={async () => {
              if (!rawPaste.trim()) return;
              setIsParsing(true);
              setError("");
              try {
                const res = await fetch("/api/jobs/autofill-form", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text: rawPaste })
                });
                if (!res.ok) throw new Error("Failed to parse");
                const data = await res.json();
                if (data.title) setTitle(data.title);
                if (data.company) setCompany(data.company);
                if (data.location) setLocation(data.location);
                if (data.description_text) setDescriptionText(data.description_text);
              } catch (err: any) {
                setError(err.message || "Error parsing text");
              } finally {
                setIsParsing(false);
              }
            }}
            disabled={isParsing || !rawPaste.trim()}
          >
            {isParsing ? "Analyzing..." : "✨ Auto Fill Fields"}
          </button>
        </div>
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
          <label>Job Description</label>
          <textarea 
            value={descriptionText} 
            onChange={(e) => setDescriptionText(e.target.value)} 
            style={{ width: "100%", height: 120, padding: 12, borderRadius: 6, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 13, resize: "vertical", background: "var(--surface)", color: "var(--ink)" }} 
          />
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
  const [candidates, setCandidates] = useState<{ id: string; name: string; resume_url: string | null; resume_filename: string | null; has_base_resume?: boolean }[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [currentUser, setCurrentUser] = useState<TeamUser | null>(null);
  const [candidateIds, setCandidateIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("assigned");
  const [resumeVariants, setResumeVariants] = useState<{ id: string; label: string; file_url: string; filename: string }[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [baseResumes, setBaseResumes] = useState<{ id: string; name: string; status: string }[]>([]);
  const [selectedBaseResumeId, setSelectedBaseResumeId] = useState("");
  const [baseResumesLoading, setBaseResumesLoading] = useState(false);
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [localScores, setLocalScores] = useState<MatchScore[]>(job.match_scores || []);
  const [generatingScoreFor, setGeneratingScoreFor] = useState<string | null>(null);
  const [expandedScoreError, setExpandedScoreError] = useState<string | null>(null);
  const assignmentOwners = [...users].sort((a, b) => {
    const aRank = a.role === "application_engineer" ? 0 : 1;
    const bRank = b.role === "application_engineer" ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "");
  });

  useEffect(() => {
    fetch("/api/candidates?compact=1&pageSize=200", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.items || []);
        list.sort((a: { name: string }, b: { name: string }) => (a.name || "").localeCompare(b.name || ""));
        setCandidates(list);
      })
      .catch(() => setCandidates([]));
    fetch("/api/users").then((r) => r.ok ? r.json() : []).then(setUsers);
    fetch("/api/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((data: MeResponse | null) => setCurrentUser(data?.profile ?? null));
  }, []);

  useEffect(() => {
    setResumeId("");
    setBaseResumes([]);
    setSelectedBaseResumeId("");
    if (candidateIds.size !== 1) { setResumeVariants([]); return; }
    const [candidateId] = Array.from(candidateIds);
    fetch(`/api/candidates/${candidateId}/resumes`).then((r) => r.json()).then(setResumeVariants);
    // Fetch base resumes for the selected candidate
    setBaseResumesLoading(true);
    fetch(`/api/base-resumes?candidateId=${candidateId}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: { id: string; name: string; status: string }[]) => {
        setBaseResumes(data);
        if (data.length > 0) setSelectedBaseResumeId(data[0].id);
      })
      .catch(() => setBaseResumes([]))
      .finally(() => setBaseResumesLoading(false));
  }, [candidateIds]);

  function toggleCandidate(id: string) {
    setCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function generateScore(candidateId: string) {
    setGeneratingScoreFor(candidateId);
    setError("");
    try {
      const res = await fetch("/api/jobs/match-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.id, candidate_id: candidateId }),
      });
      if (res.ok) {
        const newScore = await res.json();
        setLocalScores((prev) => {
          const filtered = prev.filter(s => s.candidate_id !== candidateId);
          return [...filtered, { ...newScore, candidate_id: candidateId }];
        });
      } else {
        const errorData = await res.json().catch(() => ({ error: "Failed to generate score" }));
        const errorReason = errorData.error || "Failed to generate score";
        setLocalScores((prev) => {
          const filtered = prev.filter(s => s.candidate_id !== candidateId);
          return [...filtered, {
            job_id: job.id,
            candidate_id: candidateId,
            candidate_name: candidates.find(c => c.id === candidateId)?.name || "",
            score: -1,
            breakdown: { skills_match: 0, experience_match: 0, reasoning: `Error: ${errorReason}` },
          }];
        });
      }
    } catch (err: any) {
      setLocalScores((prev) => {
        const filtered = prev.filter(s => s.candidate_id !== candidateId);
        return [...filtered, {
          job_id: job.id,
          candidate_id: candidateId,
          candidate_name: candidates.find(c => c.id === candidateId)?.name || "",
          score: -1,
          breakdown: { skills_match: 0, experience_match: 0, reasoning: `Error: ${err.message || "Network error"}` },
        }];
      });
    } finally {
      setGeneratingScoreFor(null);
    }
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
        source_type: "base_resume",
        base_resume_id: selectedBaseResumeId || null,
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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "95vw", maxWidth: "650px", padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", borderBottom: "1px solid var(--border)", paddingBottom: "16px" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "var(--ink)" }}>Assign application - <span style={{ color: "var(--accent)" }}>{job.title}</span></h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--ink-soft)", cursor: "pointer", padding: "4px", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center" }} onMouseOver={(e) => e.currentTarget.style.color = "var(--ink)"} onMouseOut={(e) => e.currentTarget.style.color = "var(--ink-soft)"}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div className="field-group">
          <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--ink)", marginBottom: "8px", display: "block" }}>Select Candidates</label>
          <div style={{ maxHeight: "40vh", overflowY: "auto", padding: "4px 8px 4px 0", display: "flex", flexDirection: "column", gap: "8px" }}>
            {candidates.map((c) => {
              const ms = localScores.find(s => s.candidate_id === c.id);
              let scoreColor = "var(--text-muted)";
              let displayScore = "Match: ??%";
              const isError = ms && ms.score === -1;
              
              if (ms) {
                if (isError) {
                  scoreColor = "var(--danger, #dc2626)";
                  displayScore = "Error";
                } else if (ms.score >= 80) {
                  scoreColor = "var(--success, #2a6f4f)";
                  displayScore = `Match: ${ms.score}%`;
                } else if (ms.score >= 60) {
                  scoreColor = "var(--warning, #eab308)";
                  displayScore = `Match: ${ms.score}%`;
                } else {
                  scoreColor = "var(--danger, #dc2626)";
                  displayScore = `Match: ${ms.score}%`;
                }
              }

              const alreadyApplied = job.applicants.some(a => a.candidate_id === c.id);
              // /api/jobs/match-score only ever reads base_resumes (most recent
              // by created_at) - resume_filename (the original uploaded file) is
              // never consulted there. A candidate built entirely through Falood
              // Studio with no raw upload still scores fine, so gate on either.
              const noResume = !c.resume_filename && !c.has_base_resume;
              const errorReason = isError ? (ms.breakdown?.reasoning || "Unknown error") : "";
              const isExpanded = expandedScoreError === c.id;

              return (
                <div key={c.id} style={{ display: "flex", flexDirection: "column", padding: "12px 14px", borderRadius: "8px", backgroundColor: "var(--surface)", border: isExpanded && isError ? "1px solid var(--danger, #dc2626)" : "1px solid var(--border)", transition: "background 0.15s ease" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }} onMouseOver={(e) => {if(!alreadyApplied && !noResume) e.currentTarget.parentElement!.style.backgroundColor = "var(--bg)"}} onMouseOut={(e) => e.currentTarget.parentElement!.style.backgroundColor = "var(--surface)"}>
                  <label style={{ display: "flex", alignItems: "center", gap: "12px", color: "var(--ink)", fontWeight: 500, fontSize: "0.95rem", flex: 1, cursor: (alreadyApplied || noResume) ? "not-allowed" : "pointer", userSelect: "none" }}>
                    <input
                      type="checkbox"
                      style={{ width: "16px", height: "16px", accentColor: "var(--accent)", cursor: (alreadyApplied || noResume) ? "not-allowed" : "pointer" }}
                      checked={alreadyApplied || candidateIds.has(c.id)}
                      disabled={alreadyApplied || noResume}
                      onChange={() => {
                        toggleCandidate(c.id);
                        if (!candidateIds.has(c.id) && !ms && generatingScoreFor !== c.id) {
                          generateScore(c.id);
                        }
                      }}
                    />
                    <span style={{ opacity: (alreadyApplied || noResume) ? 0.5 : 1 }}>
                      {c.name}
                      {alreadyApplied && <span style={{ fontSize: "0.8rem", fontWeight: 400, color: "var(--ink-soft)", marginLeft: "6px" }}>(Already applied)</span>}
                      {noResume && <span style={{ fontSize: "0.8rem", fontWeight: 400, color: "var(--danger)", marginLeft: "6px" }}>(no resume)</span>}
                    </span>
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {ms ? (
                    <>
                      <span
                        className="badge"
                        style={{ borderColor: scoreColor, color: scoreColor, padding: "4px 8px", fontWeight: 600, cursor: isError ? "pointer" : "default" }}
                        title={isError ? "Click for details" : (ms.breakdown?.reasoning || "")}
                        onClick={() => { if (isError) setExpandedScoreError(isExpanded ? null : c.id); }}
                      >
                        {displayScore}
                      </span>
                      {isError && (
                        <button
                          type="button"
                          disabled={generatingScoreFor === c.id}
                          onClick={(e) => { e.stopPropagation(); generateScore(c.id); }}
                          style={{ padding: "3px 8px", fontSize: "11px", borderRadius: "4px", border: "1px solid var(--accent)", background: "var(--surface)", color: "var(--accent)", cursor: "pointer", fontWeight: 500 }}
                        >
                          {generatingScoreFor === c.id ? "Retrying..." : "Retry"}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={generatingScoreFor === c.id}
                      onClick={() => generateScore(c.id)}
                      style={{ padding: "4px 10px", fontSize: "12px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontWeight: 500 }}
                    >
                      {generatingScoreFor === c.id ? "🤖 Generating..." : "🤖 Gen Score"}
                    </button>
                  )}
                  </div>
                  </div>
                  {isExpanded && isError && (
                    <div style={{ marginTop: "10px", padding: "10px 12px", backgroundColor: "rgba(220, 38, 38, 0.06)", borderRadius: "6px", border: "1px solid rgba(220, 38, 38, 0.2)", fontSize: "13px", color: "var(--danger, #dc2626)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", fontWeight: 600 }}>
                        <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
                        Scoring error
                      </div>
                      <p style={{ margin: 0, lineHeight: 1.4 }}>{errorReason}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {candidates.some(c => !c.resume_filename && !c.has_base_resume) && (
            <div style={{ color: "var(--danger, #dc2626)", fontSize: "13px", marginTop: "8px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
              Candidates without a base resume cannot be assigned.
            </div>
          )}
        </div>




        {candidateIds.size === 1 && (
          <div className="field-group" style={{ marginTop: "16px" }}>
            <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--ink)", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
              Base Resume
            </label>
            {baseResumesLoading ? (
              <div style={{ padding: "8px 12px", fontSize: "13px", color: "var(--ink-soft)" }}>Loading base resumes…</div>
            ) : baseResumes.length > 0 ? (
              <select
                value={selectedBaseResumeId}
                onChange={(e) => setSelectedBaseResumeId(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
              >
                {baseResumes.map((br) => (
                  <option key={br.id} value={br.id}>
                    {br.name} ({br.status})
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ padding: "10px 14px", fontSize: "13px", color: "var(--warning, #b45309)", backgroundColor: "rgba(234, 179, 8, 0.08)", borderRadius: "var(--radius)", border: "1px solid rgba(234, 179, 8, 0.2)", display: "flex", alignItems: "center", gap: "6px" }}>
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
                No base resumes found for this candidate. The AI workflow will create one automatically.
              </div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "20px" }}>
          <div className="field-group">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
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
            <input value={currentUser?.display_name || currentUser?.email || ""} disabled placeholder="Current signed-in user" style={{ width: "100%", padding: "8px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)", backgroundColor: "var(--bg)" }} />
          </div>
          <div className="field-group">
            <label>Application owner</label>
            <select value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
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
            <input type="date" value={assignmentDueAt} onChange={(e) => setAssignmentDueAt(e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }} />
          </div>
        </div>

        <div className="field-group" style={{ marginTop: "16px" }}>
          <label>Assignment note</label>
          <textarea value={assignmentNote} onChange={(e) => setAssignmentNote(e.target.value)} rows={3} placeholder="Instructions, candidate context, resume choice, etc." style={{ width: "100%", padding: "10px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)", resize: "vertical", fontFamily: "inherit" }} />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: "14px", marginTop: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
          {error}
        </p>}

        <div className="modal-actions" style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", cursor: "pointer", fontWeight: 500 }}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving || candidateIds.size === 0} style={{ padding: "8px 20px", borderRadius: "6px", border: "none", background: "var(--accent)", color: "white", cursor: saving || candidateIds.size === 0 ? "not-allowed" : "pointer", fontWeight: 600, opacity: saving || candidateIds.size === 0 ? 0.7 : 1 }}>
            {saving ? "Saving..." : `Create ${candidateIds.size} ticket${candidateIds.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Logs the same candidate against every selected job in one go - the bulk
// "N selected -> Log selected to candidate" action. Single-candidate by
// design (that's the whole point: many jobs, one person), unlike
// LogApplicationModal's single-job/many-candidates shape, and skips its
// per-job match-score UI since that doesn't cleanly generalize across
// multiple jobs.
function BulkLogApplicationModal({ jobs, onClose, onLogged }: { jobs: Job[]; onClose: () => void; onLogged: () => void }) {
  const [candidates, setCandidates] = useState<{ id: string; name: string; resume_url: string | null; resume_filename: string | null }[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [currentUser, setCurrentUser] = useState<TeamUser | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [status, setStatus] = useState("assigned");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<{ job: Job; ok: boolean; message?: string }[] | null>(null);

  useEffect(() => {
    fetch("/api/candidates?compact=1&pageSize=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = Array.isArray(data) ? data : data.items || [];
        list.sort((a: { name: string }, b: { name: string }) => (a.name || "").localeCompare(b.name || ""));
        setCandidates(list);
      })
      .catch(() => setCandidates([]));
    fetch("/api/users").then((r) => (r.ok ? r.json() : [])).then(setUsers);
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MeResponse | null) => setCurrentUser(data?.profile ?? null));
  }, []);

  async function submit() {
    if (!candidateId) { setError("Select a candidate."); return; }
    const assignmentStatus = status === "assigned" || status === "stacked";
    if (assignmentStatus && !assignedToUserId) {
      setError("Choose an application owner for assigned or stacked tickets.");
      return;
    }
    setSaving(true);
    setError("");
    const candidate = candidates.find((c) => c.id === candidateId);
    const assignedToUser = users.find((u) => u.user_id === assignedToUserId);

    // Sequential, not Promise.all: this is a real write per job against a
    // shared candidate+job uniqueness constraint - firing them all at once
    // risks the same races /api/applications already guards against
    // one-at-a-time (duplicate-application 409s, etc.), and per-job results
    // are shown below either way so there's no UX cost to going one at a time.
    const outcomes: { job: Job; ok: boolean; message?: string }[] = [];
    for (const job of jobs) {
      try {
        const res = await fetch("/api/applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_ids: [candidateId],
            job_id: job.id,
            status,
            resume_url: candidate?.resume_url ?? null,
            resume_filename: candidate?.resume_filename ?? null,
            assigned_by: currentUser?.display_name || currentUser?.email || null,
            assigned_to: assignedToUser?.display_name || assignedToUser?.email || null,
            assigned_by_user_id: currentUser?.user_id ?? null,
            assigned_to_user_id: assignedToUserId || null,
            assignment_due_at: assignmentDueAt || null,
            assignment_note: assignmentNote || null,
            next_action: assignmentStatus ? "Apply to this job" : null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        outcomes.push({ job, ok: res.ok, message: res.ok ? undefined : data.error || "Something went wrong." });
      } catch (err: any) {
        outcomes.push({ job, ok: false, message: err?.message || "Network error" });
      }
    }
    setSaving(false);
    setResults(outcomes);
    if (outcomes.every((o) => o.ok)) onLogged();
  }

  const failedCount = results ? results.filter((r) => !r.ok).length : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "95vw", maxWidth: "600px", padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", borderBottom: "1px solid var(--border)", paddingBottom: "16px" }}>
          <h2 style={{ margin: 0, fontSize: "1.25rem", color: "var(--ink)" }}>
            Log {jobs.length} job{jobs.length !== 1 ? "s" : ""} to one candidate
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--ink-soft)", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ maxHeight: "20vh", overflowY: "auto", marginBottom: "16px", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "6px" }}>
          {jobs.map((j) => (
            <div key={j.id} style={{ fontSize: "13px", padding: "2px 0", color: "var(--ink-soft)" }}>{j.title} — {j.company || "—"}</div>
          ))}
        </div>

        <div className="field-group">
          <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--ink)", marginBottom: "8px", display: "block" }}>Candidate</label>
          <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border)" }}>
            <option value="">Choose a candidate…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="field-group" style={{ marginTop: "16px" }}>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border)" }}>
            <option value="assigned">Assigned</option>
            <option value="stacked">Stacked</option>
            <option value="applied">Applied</option>
          </select>
        </div>

        {(status === "assigned" || status === "stacked") && (
          <div className="field-group" style={{ marginTop: "16px" }}>
            <label>Owner</label>
            <select value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border)" }}>
              <option value="">Choose an owner…</option>
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.display_name || u.email}</option>
              ))}
            </select>
          </div>
        )}

        <div className="field-group" style={{ marginTop: "16px" }}>
          <label>Due date (optional)</label>
          <input type="date" value={assignmentDueAt} onChange={(e) => setAssignmentDueAt(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border)" }} />
        </div>

        <div className="field-group" style={{ marginTop: "16px" }}>
          <label>Assignment note</label>
          <textarea value={assignmentNote} onChange={(e) => setAssignmentNote(e.target.value)} rows={3} placeholder="Instructions, candidate context, resume choice, etc." style={{ width: "100%", padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--border)", resize: "vertical", fontFamily: "inherit" }} />
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: "14px", marginTop: "12px" }}>{error}</p>}

        {results && (
          <div style={{ marginTop: "16px", padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--border)" }}>
            {failedCount === 0 ? (
              <p style={{ margin: 0, color: "var(--success, #2a6f4f)" }}>All {results.length} tickets created.</p>
            ) : (
              <>
                <p style={{ margin: "0 0 6px", color: "var(--danger)" }}>{failedCount} of {results.length} failed:</p>
                {results.filter((r) => !r.ok).map((r) => (
                  <div key={r.job.id} style={{ fontSize: "13px", color: "var(--ink-soft)" }}>{r.job.title}: {r.message}</div>
                ))}
              </>
            )}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", cursor: "pointer", fontWeight: 500 }}>
            {results ? "Close" : "Cancel"}
          </button>
          {(!results || failedCount > 0) && (
            <button className="btn-primary" onClick={submit} disabled={saving || !candidateId} style={{ padding: "8px 20px", borderRadius: "6px", border: "none", background: "var(--accent)", color: "white", cursor: saving || !candidateId ? "not-allowed" : "pointer", fontWeight: 600, opacity: saving || !candidateId ? 0.7 : 1 }}>
              {saving ? "Logging..." : `Log ${jobs.length} ticket${jobs.length !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}