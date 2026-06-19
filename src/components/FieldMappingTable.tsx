"use client";

import React from "react";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const schemaFieldOptions = [
  { value: "", label: "Ignore" },
  { value: "title", label: "Job title", required: true },
  { value: "company", label: "Company" },
  { value: "location", label: "Location" },
  { value: "source_url", label: "Posting URL" },
  { value: "posted_at", label: "Posted date" },
  { value: "salary_range", label: "Salary range" },
  { value: "role_tier", label: "Role tier" },
  { value: "notes", label: "Notes" },
  { value: "seniority_level", label: "Seniority level" },
  { value: "employment_type", label: "Employment type" },
  { value: "applicants_count", label: "Applicants count" },
  { value: "external_job_id", label: "External job ID" },
  { value: "apply_url", label: "Apply URL" },
  { value: "description_text", label: "Description text" },
  { value: "description_html", label: "Description HTML" },
  { value: "benefits", label: "Benefits" },
  { value: "job_function", label: "Job function" },
  { value: "industries", label: "Industries" },
  { value: "job_category", label: "Job category" },
  { value: "category_tags", label: "Category tags" },
  { value: "company_website", label: "Company website" },
  { value: "company_logo_url", label: "Company logo" },
  { value: "company_employees_count", label: "Company employees" },
  { value: "tracking_id", label: "Tracking ID" },
  { value: "ref_id", label: "Ref ID" },
];

interface FieldMappingTableProps {
  headers: string[];
  mapping: Record<string, string>;
  sampleRows: Record<string, string>[];
  onMappingChange: (header: string, field: string) => void;
}

export default function FieldMappingTable({
  headers,
  mapping,
  sampleRows,
  onMappingChange,
}: FieldMappingTableProps) {
  const isMapped = (header: string) => {
    const field = mapping[header];
    return field && field !== "";
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="table w-full">
        <thead>
          <tr>
            <th className="w-10"></th>
            <th>Column</th>
            <th>Sample data</th>
            <th>Mapped field</th>
          </tr>
        </thead>
        <tbody>
          {headers.map((header) => {
            const mapped = isMapped(header);
            const field = mapping[header] || "";
            const samples = sampleRows
              .map((row) => row[header])
              .filter((v) => v !== undefined && v !== "")
              .slice(0, 3);

            return (
              <tr
                key={header}
                className={cn(
                  !mapped && "bg-[var(--warn)]/5"
                )}
              >
                <td>
                  {mapped ? (
                    <Check className="h-4 w-4 text-[var(--accent)]" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-[var(--warn)]" />
                  )}
                </td>
                <td>
                  <span className="font-semibold text-[var(--ink)]">
                    {header}
                  </span>
                  {!mapped && (
                    <span className="ml-2 text-xs text-[var(--warn)] font-medium">
                      Unmapped
                    </span>
                  )}
                </td>
                <td className="muted text-sm max-w-[240px] truncate">
                  {samples.length > 0 ? samples.join(" | ") : "—"}
                </td>
                <td>
                  <select
                    value={field}
                    onChange={(e) =>
                      onMappingChange(header, e.target.value)
                    }
                    className={cn(
                      "w-full min-w-[180px]",
                      !mapped && "border-[var(--warn)]"
                    )}
                  >
                    {schemaFieldOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                        {opt.required ? " (required)" : ""}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
