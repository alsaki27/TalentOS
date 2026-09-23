"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileSpreadsheet,
  Link2,
  Briefcase,
  Globe,
  ArrowLeft,
  ArrowRight,
  X,
  Sparkles,
  Save,
  Check,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { applyMapping } from "@/lib/normalizer";
// parseJson is not imported here to avoid pulling papaparse into the client bundle;
// we parse JSON inline below.

import DropZone from "@/components/DropZone";
import ImportStepIndicator from "@/components/ImportStepIndicator";
import FieldMappingTable from "@/components/FieldMappingTable";
import ImportSummary from "@/components/ImportSummary";

/* ─────────── Types ─────────── */

type SourceType = "csv" | "linkedin" | "ats" | "career-page";

type SchemaField =
  | "title" | "company" | "location" | "source_url" | "posted_at"
  | "salary_range" | "role_tier" | "notes" | "external_job_id"
  | "tracking_id" | "ref_id" | "apply_url" | "description_html"
  | "description_text" | "benefits" | "seniority_level" | "employment_type"
  | "applicants_count" | "job_function" | "industries" | "input_url"
  | "company_linkedin_url" | "company_logo_url" | "company_employees_count"
  | "company_website" | "company_address" | "company_slogan"
  | "company_description" | "job_poster_name" | "job_poster_title"
  | "job_poster_profile_url" | "job_poster_photo_url" | "job_category"
  | "category_tags" | "category_relevance_score";

type FieldMapping = Partial<Record<SchemaField, string>>;

interface MatchingProfile {
  id: string;
  label: string;
  column_map: FieldMapping;
  score: number;
}

interface AnalyzeResponse {
  headersDetected: boolean;
  mapping: FieldMapping;
  unmappedHeaders: string[];
  confident: boolean;
  rawHeaders: string[];
  sampleRows: Record<string, string>[];
  matchingProfiles: MatchingProfile[];
  rowCount: number;
}

interface ImportResult {
  imported: number;
  skipped: number;
  error?: string;
}

const STEPS = ["Source", "Upload", "Mapping", "Review"];
const BATCH_SIZE = 50;

const SOURCE_CARDS: {
  id: SourceType;
  title: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "csv",
    title: "CSV / TSV / Excel",
    description: "Upload a spreadsheet or delimited file with job listings.",
    icon: <FileSpreadsheet className="h-6 w-6" />,
  },
  {
    id: "linkedin",
    title: "LinkedIn JSON",
    description: "Import a JSON export from LinkedIn job searches.",
    icon: <Link2 className="h-6 w-6" />,
  },
  {
    id: "ats",
    title: "ATS (Greenhouse / Lever / Ashby)",
    description: "Pull live postings directly from a company's ATS board.",
    icon: <Briefcase className="h-6 w-6" />,
  },
  {
    id: "career-page",
    title: "Career Page",
    description: "Scrape structured job postings from a company careers page.",
    icon: <Globe className="h-6 w-6" />,
  },
];

/* ─────────── Helpers ─────────── */

function apiMappingToUi(apiMapping: FieldMapping): Record<string, string> {
  const ui: Record<string, string> = {};
  for (const [field, header] of Object.entries(apiMapping)) {
    if (header) ui[header] = field;
  }
  return ui;
}

function uiMappingToApi(uiMapping: Record<string, string>): FieldMapping {
  const api: FieldMapping = {};
  for (const [header, field] of Object.entries(uiMapping)) {
    if (field && field !== "ignore") api[field as SchemaField] = header;
  }
  return api;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/* ─────────── Page ─────────── */

export default function ImportPage() {
  const router = useRouter();

  /* Step & source */
  const [step, setStep] = useState(1);
  const [source, setSource] = useState<SourceType | null>(null);

  /* File upload */
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [detectedFormat, setDetectedFormat] = useState<string>("");

  /* Analyze */
  const [analyzeResponse, setAnalyzeResponse] = useState<AnalyzeResponse | null>(null);
  const [uiMapping, setUiMapping] = useState<Record<string, string>>({});
  const [sourceLabel, setSourceLabel] = useState("normalized_import");
  const [saveProfile, setSaveProfile] = useState(false);
  const [profileLabel, setProfileLabel] = useState("");

  /* ATS */
  const [atsProvider, setAtsProvider] = useState("greenhouse");
  const [atsToken, setAtsToken] = useState("");

  /* Career page */
  const [careerUrl, setCareerUrl] = useState("");

  /* Result */
  const [result, setResult] = useState<ImportResult | null>(null);

  /* Loading */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* Progress */
  const [progress, setProgress] = useState(0);

  /* ── Step 1 → 2 ── */
  function selectSource(s: SourceType) {
    setSource(s);
    setError("");
    setResult(null);
    setStep(2);
  }

  /* ── Step 2: File ── */
  async function handleFileSelect(file: File) {
    setFileName(file.name);
    setError("");
    const text = await file.text();
    setFileContent(text);

    /* Detect format from content (same logic as detect.ts) */
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    let fmt = "";
    if (ext === "json") fmt = "JSON";
    else if (ext === "tsv") fmt = "TSV";
    else if (ext === "csv") fmt = "CSV";
    else {
      const trimmed = text.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) fmt = "JSON";
      else {
        const firstLine = trimmed.split(/\r?\n/)[0] || "";
        const tabCount = (firstLine.match(/\t/g) || []).length;
        const commaCount = (firstLine.match(/,/g) || []).length;
        fmt = tabCount > commaCount ? "TSV" : "CSV";
      }
    }
    setDetectedFormat(fmt);
  }

  async function analyzeFile() {
    if (!fileName || !fileContent) {
      setError("Please select a file first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Parse full file locally to get the actual row count
      let actualRowCount = 0;
      const trimmed = fileContent.trim();
      if (trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) actualRowCount = parsed.length;
      }

      // Send only a sample (first 10 rows) for analysis to avoid server payload limits
      let contentToSend = fileContent;
      if (trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 10) {
          const sample = parsed.slice(0, 10);
          contentToSend = JSON.stringify(sample);
        }
      }

      const res = await fetch("/api/import/normalize/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: fileName, content: contentToSend }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not analyze file.");
      // Override rowCount with the actual count from the local file
      if (actualRowCount > 0) {
        data.rowCount = actualRowCount;
      }
      setAnalyzeResponse(data);
      setUiMapping(apiMappingToUi(data.mapping ?? {}));
      setStep(3);
    } catch (err: any) {
      setError(err.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  /* ── Step 3: Mapping ── */
  function handleMappingChange(header: string, field: string) {
    setUiMapping((prev) => ({ ...prev, [header]: field }));
  }

  function autoMap() {
    if (!analyzeResponse) return;
    setUiMapping(apiMappingToUi(analyzeResponse.mapping ?? {}));
  }

  function applyProfile(profile: MatchingProfile) {
    setUiMapping(apiMappingToUi(profile.column_map ?? {}));
    setProfileLabel(profile.label);
    setSaveProfile(false);
  }

  function mappedCount() {
    return Object.values(uiMapping).filter((v) => v && v !== "").length;
  }

  function unmappedHeaders() {
    if (!analyzeResponse) return [];
    return analyzeResponse.rawHeaders.filter((h) => !uiMapping[h] || uiMapping[h] === "");
  }

  function titleMapped() {
    return Object.entries(uiMapping).some(([, f]) => f === "title");
  }

  /* ── Step 4: Commit (client-side batching) ── */
  async function commitFile() {
    if (!fileName || !fileContent || !analyzeResponse) {
      setError("Missing file data.");
      return;
    }
    const apiMapping = uiMappingToApi(uiMapping);
    if (!apiMapping.title) {
      setError("The 'Job title' field must be mapped to a column before importing.");
      return;
    }
    if (saveProfile && !profileLabel.trim()) {
      setError("Name the import profile before saving it.");
      return;
    }

    setLoading(true);
    setError("");
    setProgress(5);

    try {
      // Parse and map locally to avoid sending 12MB payload to server
      const rawData = JSON.parse(fileContent);
      const arr = Array.isArray(rawData) ? rawData : [rawData];
      const parsedRows: Record<string, string>[] = arr.map((row: any) => {
        const obj: Record<string, string> = {};
        for (const key of Object.keys(row ?? {})) {
          const v = row[key];
          obj[key] = v === null || v === undefined
            ? ""
            : typeof v === "object"
              ? JSON.stringify(v)
              : String(v);
        }
        return obj;
      });
      setProgress(10);

      const cleaned = applyMapping(parsedRows, apiMapping);
      if (cleaned.length === 0) {
        setResult({ imported: 0, skipped: parsedRows.length });
        setProgress(100);
        setLoading(false);
        return;
      }
      setProgress(15);

      const rowsToSend = cleaned.map((row) => ({
        ...row,
        source: sourceLabel?.trim() || "normalized_import",
      }));
      const batches = chunkArray(rowsToSend, BATCH_SIZE);
      let totalImported = 0;
      let totalSkipped = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchProgress = 15 + Math.round(((i + 1) / batches.length) * 80);
        setProgress(batchProgress);

        const res = await fetch("/api/import/normalize/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: batch,
            sourceLabel,
          }),
        });

        let data: any = null;
        try {
          data = await res.json();
        } catch (parseErr) {
          throw new Error(`Batch ${i + 1}: server returned invalid response (status ${res.status}).`);
        }
        if (!res.ok) {
          throw new Error(data?.error || `Batch ${i + 1} failed (status ${res.status}).`);
        }
        totalImported += data?.imported ?? 0;
        totalSkipped += data?.skipped ?? 0;
      }

      setProgress(100);
      setResult({ imported: totalImported, skipped: totalSkipped });
    } catch (err: any) {
      setError(err.message || "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  async function commitAts() {
    if (!atsToken.trim()) {
      setError(
        atsProvider === "usajobs"
          ? "Enter a search keyword."
          : "Enter the company's board token / slug."
      );
      return;
    }
    setLoading(true);
    setError("");
    setProgress(30);
    try {
      const res = await fetch("/api/import/ats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: atsProvider, token: atsToken.trim() }),
      });
      setProgress(70);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed.");
      setResult({ imported: data.imported ?? 0, skipped: data.skipped ?? 0 });
      setProgress(100);
    } catch (err: any) {
      setError(err.message || "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  async function commitCareerPage() {
    if (!careerUrl.trim()) {
      setError("Enter a career page URL.");
      return;
    }
    setLoading(true);
    setError("");
    setProgress(30);
    try {
      const res = await fetch("/api/import/career-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: careerUrl.trim() }),
      });
      setProgress(70);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed.");
      setResult({ imported: data.imported ?? 0, skipped: data.skipped ?? 0 });
      setProgress(100);
    } catch (err: any) {
      setError(err.message || "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  async function commitImport() {
    if (source === "csv" || source === "linkedin") {
      await commitFile();
    } else if (source === "ats") {
      await commitAts();
    } else if (source === "career-page") {
      await commitCareerPage();
    }
  }

  /* ── Navigation ── */
  function goBack() {
    if (step > 1) {
      setStep(step - 1);
      setError("");
    }
  }

  function goNext() {
    if (step === 2 && (source === "csv" || source === "linkedin")) {
      analyzeFile();
      return;
    }
    if (step === 3 && (source === "csv" || source === "linkedin")) {
      if (!titleMapped()) {
        setError("Map at least one column to 'Job title' before continuing.");
        return;
      }
      setError("");
      setStep(4);
      return;
    }
    if (step < 4) {
      setStep(step + 1);
      setError("");
    }
  }

  function cancel() {
    router.push("/jobs");
  }

  /* ── Render helpers ── */
  function renderStep1() {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SOURCE_CARDS.map((card) => (
          <button
            key={card.id}
            onClick={() => selectSource(card.id)}
            className={cn(
              "flex flex-col items-start gap-3 rounded-lg border p-5 text-left transition-all",
              "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:shadow-sm"
            )}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              {card.icon}
            </div>
            <div>
              <h3 className="font-semibold text-[var(--ink)]">{card.title}</h3>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                {card.description}
              </p>
            </div>
            <span className="mt-1 text-sm font-medium text-[var(--accent)]">
              Select →
            </span>
          </button>
        ))}
      </div>
    );
  }

  function renderStep2() {
    if (source === "csv" || source === "linkedin") {
      return (
        <div className="space-y-4">
          <DropZone
            onFileSelect={handleFileSelect}
            accept=".csv,.tsv,.json,text/csv,application/json"
          />

          {fileName && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
              <FileSpreadsheet className="h-4 w-4 text-[var(--accent)]" />
              <span className="text-sm font-medium text-[var(--ink)]">
                {fileName}
              </span>
              {detectedFormat && (
                <span className="badge ml-1">{detectedFormat}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              onClick={analyzeFile}
              disabled={loading || !fileName}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Analyze File
                </span>
              )}
            </button>
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      );
    }

    if (source === "ats") {
      return (
        <div className="space-y-4 max-w-md">
          <div className="field-group">
            <label>Provider</label>
            <select
              value={atsProvider}
              onChange={(e) => setAtsProvider(e.target.value)}
            >
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="usajobs">USAJobs</option>
            </select>
          </div>

          <div className="field-group">
            <label>
              {atsProvider === "usajobs"
                ? "Search keyword"
                : "Company board token / slug"}
            </label>
            <input
              value={atsToken}
              onChange={(e) => setAtsToken(e.target.value)}
              placeholder={
                atsProvider === "greenhouse"
                  ? "e.g. airbnb"
                  : atsProvider === "lever"
                  ? "e.g. netflix"
                  : atsProvider === "usajobs"
                  ? "e.g. civil engineer"
                  : "e.g. ramp"
              }
            />
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={goNext} disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Fetching…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4" />
                  Next
                </span>
              )}
            </button>
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      );
    }

    if (source === "career-page") {
      return (
        <div className="space-y-4 max-w-md">
          <div className="field-group">
            <label>Career page URL</label>
            <input
              value={careerUrl}
              onChange={(e) => setCareerUrl(e.target.value)}
              placeholder="https://company.com/careers"
            />
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={goNext} disabled={loading}>
              Next
            </button>
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return null;
  }

  function renderStep3() {
    if (source === "ats") {
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <h3 className="font-semibold text-[var(--ink)]">Ready to import</h3>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              Jobs will be fetched from{" "}
              <span className="font-medium text-[var(--ink)] capitalize">
                {atsProvider}
              </span>{" "}
              using token{" "}
              <code className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-xs">
                {atsToken}
              </code>
              .
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={goNext}>
              <span className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4" />
                Review & Commit
              </span>
            </button>
            <button className="btn" onClick={goBack}>
              <span className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </span>
            </button>
          </div>
        </div>
      );
    }

    if (source === "career-page") {
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <h3 className="font-semibold text-[var(--ink)]">Ready to import</h3>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              Job postings will be extracted from{" "}
              <code className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-xs break-all">
                {careerUrl}
              </code>
              .
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={goNext}>
              <span className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4" />
                Review & Commit
              </span>
            </button>
            <button className="btn" onClick={goBack}>
              <span className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </span>
            </button>
          </div>
        </div>
      );
    }

    /* CSV / LinkedIn */
    if (!analyzeResponse) return null;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm">
            <span className="text-[var(--ink-soft)]">Format:</span>{" "}
            <span className="font-medium text-[var(--ink)]">
              {analyzeResponse.headersDetected ? "Header row detected" : "No header row"}
            </span>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm">
            <span className="text-[var(--ink-soft)]">Total rows:</span>{" "}
            <span className="font-medium text-[var(--ink)]">
              {analyzeResponse.rowCount}
            </span>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm">
            <span className="text-[var(--ink-soft)]">Mapped:</span>{" "}
            <span className="font-medium text-[var(--accent)]">
              {mappedCount()} / {analyzeResponse.rawHeaders.length}
            </span>
          </div>
          {unmappedHeaders().length > 0 && (
            <div className="rounded-lg border border-[var(--warn)] bg-[var(--warn)]/10 px-3 py-2 text-sm">
              <span className="text-[var(--warn)] font-medium">
                {unmappedHeaders().length} unmapped column
                {unmappedHeaders().length === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>

        {analyzeResponse.matchingProfiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--ink-soft)]">
              Saved profile matches:
            </span>
            {analyzeResponse.matchingProfiles.slice(0, 3).map((profile) => (
              <button
                key={profile.id}
                className="btn-compact"
                onClick={() => applyProfile(profile)}
              >
                Use &ldquo;{profile.label}&rdquo; ({Math.round(profile.score * 100)}%)
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button className="btn" onClick={autoMap}>
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Auto-map
            </span>
          </button>
          <button
            className="btn"
            onClick={() => {
              setUiMapping({});
            }}
          >
            Clear all
          </button>
        </div>

        <FieldMappingTable
          headers={analyzeResponse.rawHeaders}
          mapping={uiMapping}
          sampleRows={analyzeResponse.sampleRows}
          onMappingChange={handleMappingChange}
        />

        <div className="field-group">
          <label>Source label</label>
          <input
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            placeholder="normalized_import"
          />
        </div>

        <div className="field-group">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={saveProfile}
              onChange={(e) => setSaveProfile(e.target.checked)}
              className="w-auto"
            />
            Save this mapping as a reusable import profile
          </label>
          {saveProfile && (
            <input
              value={profileLabel}
              onChange={(e) => setProfileLabel(e.target.value)}
              placeholder="e.g. Acme weekly export"
              className="mt-2"
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            className="btn-primary"
            onClick={goNext}
            disabled={!titleMapped()}
          >
            <span className="flex items-center gap-2">
              <ArrowRight className="h-4 w-4" />
              Review & Commit
            </span>
          </button>
          <button className="btn" onClick={goBack}>
            <span className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </span>
          </button>
        </div>
      </div>
    );
  }

  function renderStep4() {
    return (
      <div className="space-y-4">
        {!result && (
          <>
            <ImportSummary
              total={analyzeResponse?.rowCount ?? 0}
              newRows={0}
              duplicates={0}
              errors={0}
            />

            {loading && (
              <div className="space-y-2">
                <div className="h-2 w-full rounded-full bg-[var(--border)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm text-[var(--ink-soft)] text-center">
                  Importing… {progress}%
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                className="btn-primary"
                onClick={commitImport}
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Save className="h-4 w-4" />
                    Commit Import
                  </span>
                )}
              </button>
              <button className="btn" onClick={goBack} disabled={loading}>
                <span className="flex items-center gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </span>
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-white">
                  <Check className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-[var(--accent)]">
                  Import complete
                </h3>
              </div>
              <p className="text-[var(--ink)]">
                Imported <strong>{result.imported}</strong> job
                {result.imported === 1 ? "" : "s"}
                {result.skipped > 0
                  ? `, skipped ${result.skipped} duplicate${
                      result.skipped === 1 ? "" : "s"
                    }`
                  : ""}
                .
              </p>
            </div>

            <ImportSummary
              total={result.imported + result.skipped}
              newRows={result.imported}
              duplicates={result.skipped}
              errors={0}
            />

            <div className="flex items-center gap-3">
              <Link href="/jobs" className="btn-primary">
                View jobs
              </Link>
              <button
                className="btn"
                onClick={() => {
                  setStep(1);
                  setSource(null);
                  setFileName("");
                  setFileContent("");
                  setAnalyzeResponse(null);
                  setUiMapping({});
                  setResult(null);
                  setError("");
                  setAtsToken("");
                  setCareerUrl("");
                  setProgress(0);
                }}
              >
                Import another
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Main render ── */
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Universal Import</h1>
          <p className="page-kicker">
            Import jobs from any source into the masterlist.
          </p>
        </div>
        <button className="btn" onClick={cancel}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-6">
        <ImportStepIndicator steps={STEPS} currentStep={step} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--danger)] bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="card">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>
    </div>
  );
}
