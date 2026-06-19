// src/lib/ai/tools.ts
// Read-only tools the chat assistant can call. Deliberately no write/delete tools —
// "access to every database" means broad query visibility through controlled,
// parameterized Supabase queries, not raw SQL execution or the ability to mutate
// data via natural language. Each tool caps its own row limit to keep token usage
// (and API cost) bounded.

import { supabase } from "@/lib/supabase";
import { AiTool } from "@/lib/ai/provider";
import type { UserRole } from "@/lib/auth";

const MAX_ROWS = 50;

function cappedLimit(input: unknown): number {
  const n = typeof input === "number" ? input : parseInt(String(input ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(n, MAX_ROWS);
}

export const TOOLS: AiTool[] = [
  {
    name: "query_candidates",
    description: "Search the candidates table. Filter by status, target_tier, or a free-text search across name/email. Returns up to `limit` rows.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "e.g. active, placed, paused, dropped" },
        target_tier: { type: "string", description: "e.g. osp, adjacent_1, adjacent_2" },
        search: { type: "string", description: "matches name or email" },
        limit: { type: "number", description: "max rows, default 20, capped at 50" },
      },
    },
  },
  {
    name: "query_jobs",
    description: "Search the jobs masterlist. Filter by source, role_tier, job_category, active status, or a free-text search across title/company/location. Returns up to `limit` rows.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "e.g. linkedin, greenhouse, lever, ashby, usajobs, career_page, manual, csv_import" },
        role_tier: { type: "string" },
        job_category: { type: "string", description: "e.g. OSP, Drafting, GIS, Civil, Telecom, Utility, AV, Project Management" },
        is_active: { type: "boolean" },
        search: { type: "string", description: "matches title, company, or location" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "query_applications",
    description: "Search applications (the link between candidates and jobs), including pre-submission pipeline tickets (assigned/stacked/in_progress). Filter by status, priority, review_status, or free-text search matching candidate name or job title. Returns candidate name, job title/company, priority, and review status joined in.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "assigned, stacked, in_progress, applied, replied, interview, rejected, offer, withdrawn" },
        priority: { type: "string", description: "low, normal, high, urgent" },
        review_status: { type: "string", description: "not_required, pending, approved, changes_requested" },
        search: { type: "string", description: "matches candidate name or job title" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "query_companies",
    description: "Search the companies directory (normalized from job postings — name, website, LinkedIn, size). Free-text search across name.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "matches company name" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "query_application_activity_log",
    description: "Search the free-form activity log/comments on applications (who called, interview scheduled, etc.) — separate from the automatic status-change timeline.",
    inputSchema: {
      type: "object",
      properties: {
        application_id: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_analytics_summary",
    description: "Overall conversion metrics: totals (candidates/jobs/applications/pipeline tickets), response/interview/offer rates, breakdown by job source and by resume variant. No input needed.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "query_import_sources",
    description: "List saved scheduled job-board import sources (Greenhouse/Lever/Ashby/USAJobs/career pages), whether active, and their last run result.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "query_audit_logs",
    description: "Search the internal audit log (who created/updated/deleted what, when). Admin-only — will return a permission error for other roles.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "e.g. user.created, application.created, application.updated, application.deleted" },
        entity_type: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
];

export interface ToolContext {
  role: UserRole;
}

export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  try {
    switch (name) {
      case "query_candidates": {
        let q = supabase.from("candidates").select("id, name, email, status, target_tier, target_roles, preferred_locations, work_authorization, created_at");
        if (input.status) q = q.eq("status", input.status as string);
        if (input.target_tier) q = q.eq("target_tier", input.target_tier as string);
        if (input.search) q = q.or(`name.ilike.%${input.search}%,email.ilike.%${input.search}%`);
        const { data, error } = await q.order("created_at", { ascending: false }).limit(cappedLimit(input.limit));
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "query_jobs": {
        let q = supabase.from("jobs").select("id, title, company, location, source, role_tier, job_category, is_active, posted_at, category_relevance_score");
        if (input.source) q = q.eq("source", input.source as string);
        if (input.role_tier) q = q.eq("role_tier", input.role_tier as string);
        if (input.job_category) q = q.eq("job_category", input.job_category as string);
        if (typeof input.is_active === "boolean") q = q.eq("is_active", input.is_active);
        if (input.search) q = q.or(`title.ilike.%${input.search}%,company.ilike.%${input.search}%,location.ilike.%${input.search}%`);
        const { data, error } = await q.order("created_at", { ascending: false }).limit(cappedLimit(input.limit));
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "query_applications": {
        let q = supabase.from("applications").select("id, status, priority, review_status, review_note, applied_at, follow_up_at, assigned_to, assignment_due_at, candidates(name, email), jobs(title, company)");
        if (input.status) q = q.eq("status", input.status as string);
        if (input.priority) q = q.eq("priority", input.priority as string);
        if (input.review_status) q = q.eq("review_status", input.review_status as string);
        const { data, error } = await q.order("applied_at", { ascending: false }).limit(cappedLimit(input.limit));
        if (error) throw error;
        let rows = data ?? [];
        if (input.search) {
          const needle = String(input.search).toLowerCase();
          rows = rows.filter((r: any) =>
            r.candidates?.name?.toLowerCase().includes(needle) || r.jobs?.title?.toLowerCase().includes(needle));
        }
        return JSON.stringify(rows);
      }

      case "query_companies": {
        let q = supabase.from("companies").select("id, name, website, linkedin_url, employees_count, last_seen_at");
        if (input.search) q = q.ilike("name", `%${input.search}%`);
        const { data, error } = await q.order("last_seen_at", { ascending: false }).limit(cappedLimit(input.limit));
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "query_application_activity_log": {
        let q = supabase.from("application_comments").select("id, application_id, commenter_name, body, visible_to_candidate, parent_comment_id, created_at");
        if (input.application_id) q = q.eq("application_id", input.application_id as string);
        const { data, error } = await q.order("created_at", { ascending: false }).limit(cappedLimit(input.limit));
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "get_analytics_summary": {
        // Deliberately NOT a same-origin fetch to /api/analytics: that route requires a
        // session cookie (added after this tool was first written), so a server-side fetch
        // with no cookie always 401s. Compute it directly instead — same definitions as
        // that route (pipeline tickets excluded from conversion-rate math).
        const PIPELINE_STATUSES = new Set(["assigned", "stacked", "in_progress"]);
        const [candidatesRes, applicationsRes] = await Promise.all([
          supabase.from("candidates").select("id", { count: "exact", head: true }),
          supabase.from("applications").select("id, status"),
        ]);
        const allTickets = applicationsRes.data ?? [];
        const submitted = allTickets.filter((a: any) => !PIPELINE_STATUSES.has(a.status as string));
        const responded = submitted.filter((a: any) => a.status !== "applied").length;
        const interviews = submitted.filter((a: any) => a.status === "interview" || a.status === "offer").length;
        const offers = submitted.filter((a: any) => a.status === "offer").length;
        const rate = (count: number, total: number) => (total === 0 ? 0 : Math.round((count / total) * 1000) / 10);
        const { count: jobsCount } = await supabase.from("jobs").select("id", { count: "exact", head: true });

        return JSON.stringify({
          totals: {
            candidates: candidatesRes.count ?? 0,
            jobs: jobsCount ?? 0,
            applications: submitted.length,
            pipelineTickets: allTickets.length - submitted.length,
          },
          rates: {
            responseRate: rate(responded, submitted.length),
            interviewRate: rate(interviews, submitted.length),
            offerRate: rate(offers, submitted.length),
          },
        });
      }

      case "query_import_sources": {
        const { data, error } = await supabase.from("import_sources").select("id, label, provider, is_active, last_run_at, last_result");
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "query_audit_logs": {
        if (ctx.role !== "admin") {
          return JSON.stringify({ error: "Permission denied: audit logs are admin-only." });
        }
        let q = supabase.from("audit_logs").select("id, actor_email, action, entity_type, entity_id, metadata, created_at");
        if (input.action) q = q.eq("action", input.action as string);
        if (input.entity_type) q = q.eq("entity_type", input.entity_type as string);
        const { data, error } = await q.order("created_at", { ascending: false }).limit(cappedLimit(input.limit));
        if (error) throw error;
        return JSON.stringify(data);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message ?? "tool execution failed" });
  }
}
