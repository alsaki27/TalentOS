import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export interface CompanyDirectoryJob {
  id?: string;
  company?: string | null;
  source?: string | null;
  company_website?: string | null;
  company_linkedin_url?: string | null;
  company_logo_url?: string | null;
  company_employees_count?: number | null;
  company_address?: unknown;
  company_slogan?: string | null;
  company_description?: string | null;
  job_poster_name?: string | null;
  job_poster_title?: string | null;
  job_poster_profile_url?: string | null;
  job_poster_photo_url?: string | null;
}

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeCompanyName(name: string | null | undefined) {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slugify(name: string) {
  return normalizeCompanyName(name).replace(/\s+/g, "-");
}

function inferInfluenceLevel(title: string | null | undefined) {
  const t = (title ?? "").toLowerCase();
  if (t.includes("recruit")) return "recruiter";
  if (t.includes("hiring")) return "hiring_manager";
  if (t.includes("manager")) return "manager";
  if (t.includes("director") || t.includes("vp") || t.includes("chief")) return "executive";
  return "unknown";
}

function compactUpdate(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

export async function syncCompanyDirectoryFromJobs(jobs: CompanyDirectoryJob[]) {
  let companiesTouched = 0;
  let peopleTouched = 0;

  for (const job of jobs) {
    const companyName = clean(job.company);
    const normalizedName = normalizeCompanyName(companyName);
    if (!companyName || !normalizedName) continue;

    const companyPayload = compactUpdate({
      name: companyName,
      normalized_name: normalizedName,
      slug: slugify(companyName),
      website: clean(job.company_website),
      linkedin_url: clean(job.company_linkedin_url),
      logo_url: clean(job.company_logo_url),
      employees_count: job.company_employees_count ?? null,
      address: job.company_address ?? null,
      slogan: clean(job.company_slogan),
      description: clean(job.company_description),
      source: clean(job.source),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    let company: any;
    if (isNeon()) {
      const keys = Object.keys(companyPayload);
      const setClause = keys.map((k, i) => `${k} = EXCLUDED.${k}`).join(", ");
      const insertCols = keys.join(", ");
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const values = keys.map((k) => (companyPayload as any)[k]);
      company = await queryOne(
        `INSERT INTO companies (${insertCols}) VALUES (${placeholders}) ON CONFLICT (normalized_name) DO UPDATE SET ${setClause} RETURNING *`,
        values
      );
      if (!company) continue;
    } else {
      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .upsert(companyPayload, { onConflict: "normalized_name" })
        .select("*")
        .single();
      if (companyError || !companyData) continue;
      company = companyData;
    }
    companiesTouched++;

    if (job.id) {
      if (isNeon()) {
        await execute("UPDATE jobs SET company_id = $1 WHERE id = $2", [company.id, job.id]);
      } else {
        await supabase
          .from("jobs")
          .update({ company_id: company.id })
          .eq("id", job.id);
      }
    }

    const personName = clean(job.job_poster_name);
    if (!personName) continue;

    const personPayload = compactUpdate({
      company_id: company.id,
      full_name: personName,
      normalized_name: normalizeCompanyName(personName),
      title: clean(job.job_poster_title),
      linkedin_url: clean(job.job_poster_profile_url),
      photo_url: clean(job.job_poster_photo_url),
      influence_level: inferInfluenceLevel(job.job_poster_title),
      source: clean(job.source),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const linkedinUrl = clean(job.job_poster_profile_url);
    const normalizedPersonName = normalizeCompanyName(personName);

    if (isNeon()) {
      let existingId: string | null = null;
      if (linkedinUrl) {
        const existing = await queryOne<{ id: string }>(
          "SELECT id FROM company_people WHERE company_id = $1 AND linkedin_url = $2 LIMIT 1",
          [company.id, linkedinUrl]
        );
        existingId = existing?.id ?? null;
      } else {
        const existing = await queryOne<{ id: string }>(
          "SELECT id FROM company_people WHERE company_id = $1 AND normalized_name = $2 LIMIT 1",
          [company.id, normalizedPersonName]
        );
        existingId = existing?.id ?? null;
      }

      const keys = Object.keys(personPayload);
      if (existingId) {
        const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
        const values = keys.map((k) => (personPayload as any)[k]);
        values.push(existingId);
        await execute(
          `UPDATE company_people SET ${setClause} WHERE id = $${keys.length + 1}`,
          values
        );
      } else {
        const insertCols = keys.join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        const values = keys.map((k) => (personPayload as any)[k]);
        await execute(
          `INSERT INTO company_people (${insertCols}) VALUES (${placeholders})`,
          values
        );
      }
      peopleTouched++;
    } else {
      let existingQuery = supabase
        .from("company_people")
        .select("id")
        .eq("company_id", company.id)
        .limit(1);

      const { data: existing } = linkedinUrl
        ? await existingQuery.eq("linkedin_url", linkedinUrl)
        : await existingQuery.eq("normalized_name", normalizedPersonName);

      const existingId = existing?.[0]?.id;
      const { error: personError } = existingId
        ? await supabase.from("company_people").update(personPayload).eq("id", existingId)
        : await supabase.from("company_people").insert(personPayload);

      if (!personError) peopleTouched++;
    }
  }

  return { companiesTouched, peopleTouched };
}
