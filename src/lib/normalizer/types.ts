// src/lib/normalizer/types.ts
// Shared types for the universal job import normalizer pipeline.
// See README.md "Planned: Universal Job Import Normalizer" for the full spec.

export type SchemaField =
  | "title" | "company" | "location" | "source_url" | "posted_at"
  | "salary_range" | "role_tier" | "notes"
  | "external_job_id" | "tracking_id" | "ref_id" | "apply_url"
  | "description_html" | "description_text" | "benefits"
  | "seniority_level" | "employment_type" | "applicants_count"
  | "job_function" | "industries" | "input_url"
  | "company_linkedin_url" | "company_logo_url" | "company_employees_count"
  | "company_website" | "company_address" | "company_slogan" | "company_description"
  | "job_poster_name" | "job_poster_title" | "job_poster_profile_url" | "job_poster_photo_url"
  | "job_category" | "category_tags" | "category_relevance_score";

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  headersDetected: boolean;
}

// schema field -> source header name; fields with no confident match are absent.
export type FieldMapping = Partial<Record<SchemaField, string>>;

export interface MappingResult {
  mapping: FieldMapping;
  unmappedHeaders: string[];
  confident: boolean;
}

export interface FieldMapper {
  mapFields(headers: string[], sampleRows: Record<string, string>[]): MappingResult;
}
