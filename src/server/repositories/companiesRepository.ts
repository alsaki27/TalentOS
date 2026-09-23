import { query, queryOne, execute } from "@/server/db/neon";

export interface CompanyRow {
  id: string;
  name: string;
  normalized_name: string;
  slug: string | null;
  website: string | null;
  linkedin_url: string | null;
  logo_url: string | null;
  employees_count: number | null;
  address: unknown;
  slogan: string | null;
  description: string | null;
  notes: string | null;
  source: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export async function findCompanyById(id: string): Promise<CompanyRow | null> {
  return queryOne<CompanyRow>("SELECT * FROM companies WHERE id = $1", [id]);
}

export async function listCompanies(search?: string): Promise<CompanyRow[]> {
  if (search) {
    return query<CompanyRow>("SELECT * FROM companies WHERE name ILIKE $1 ORDER BY last_seen_at DESC", [`%${search}%`]);
  }
  return query<CompanyRow>("SELECT * FROM companies ORDER BY last_seen_at DESC");
}

export async function updateCompany(id: string, updates: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
  if (keys.length === 0) return;
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map(k => updates[k]);
  values.push(id);
  await execute(`UPDATE companies SET ${setClause} WHERE id = $${keys.length + 1}`, values);
}

export async function findJobsByCompany(companyId: string, limit = 100): Promise<Record<string, unknown>[]> {
  return query("SELECT * FROM jobs WHERE company_id = $1 ORDER BY posted_at DESC NULLS LAST LIMIT $2", [companyId, limit]);
}

export async function findCompanyPeople(companyId: string): Promise<Record<string, unknown>[]> {
  return query("SELECT * FROM company_people WHERE company_id = $1 ORDER BY last_seen_at DESC", [companyId]);
}
