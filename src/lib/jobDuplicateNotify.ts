// Professional messaging for blocked job duplicates - one message template,
// reused by every insertion path, wrapping the notification/activity-log/
// webhook plumbing that already exists rather than inventing anything new.
//
// Two shapes, matching how jobs actually get added:
//   - notifyInteractiveDuplicateBlocked: a human is at the keyboard right
//     now (the admin Add Job form, the browser extension, a manual AE
//     entry) - one notification, immediately, for that one attempt.
//   - notifyBatchDuplicateSummary: an unattended cron/pipeline run (Job
//     CEO, ATS/career-page/CSV import) - one aggregate notification per
//     run, never one per duplicate, so admins aren't spammed by a
//     scheduled job that happens to re-see a lot of already-known postings.

import { createNotification } from "./notifications";
import { logActivity } from "./activity";
import { triggerWebhooks } from "./webhookEngine";
import { query } from "@/server/db/neon";
import { MASTER_DATA_MANAGER_ROLES } from "./auth";
import type { JobDuplicateMatch } from "@/server/services/jobDuplicateGuard";

export interface AttemptedJob {
  title: string;
  company: string | null;
  applyUrl?: string | null;
}

function formatLoggedDate(createdAt: string | null): string {
  if (!createdAt) return "an earlier date";
  try {
    return new Date(createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "an earlier date";
  }
}

/** The one professional rejection message every caller shares. */
export function buildDuplicateMessage(attempted: AttemptedJob, existing: JobDuplicateMatch): string {
  const attemptedCompany = attempted.company || "an unspecified company";
  const existingCompany = existing.company || "an unspecified company";
  const linkClause = attempted.applyUrl ? ` (${attempted.applyUrl})` : "";
  return `"${attempted.title}" at ${attemptedCompany} was not added — a job with the same apply link${linkClause} was already logged on ${formatLoggedDate(existing.created_at)} as "${existing.title}" at ${existingCompany}.`;
}

export async function notifyInteractiveDuplicateBlocked(opts: {
  userId: string;
  actorName?: string;
  attempted: AttemptedJob;
  existing: JobDuplicateMatch;
}): Promise<void> {
  const message = buildDuplicateMessage(opts.attempted, opts.existing);
  await Promise.all([
    createNotification({
      userId: opts.userId,
      type: "job_duplicate_blocked",
      title: `Duplicate job blocked: ${opts.attempted.title}`,
      body: message,
      link: `/jobs/${opts.existing.id}`,
      entityType: "job",
      entityId: opts.existing.id,
    }),
    logActivity({
      userId: opts.userId,
      actorName: opts.actorName,
      type: "job_duplicate_blocked",
      description: message,
      entityType: "job",
      entityId: opts.existing.id,
      metadata: { attempted: opts.attempted, existingJobId: opts.existing.id },
    }),
    triggerWebhooks("job.duplicate_detected", { attempted: opts.attempted, existingJob: opts.existing }).catch(() => {}),
  ]);
}

async function notifyAdmins(opts: { type: string; title: string; body: string; link?: string }): Promise<void> {
  const admins = await query<{ user_id: string }>(
    "SELECT user_id FROM profiles WHERE role = ANY($1) AND is_active = true",
    [MASTER_DATA_MANAGER_ROLES]
  );
  await Promise.all(
    admins.map((a) => createNotification({ userId: a.user_id, type: opts.type, title: opts.title, body: opts.body, link: opts.link }))
  );
}

const MAX_EXAMPLES = 10;

export async function notifyBatchDuplicateSummary(opts: {
  runLabel: string;
  runLink: string;
  totalCandidates: number;
  duplicates: { attemptedTitle: string; attemptedCompany: string | null; attemptedApplyUrl: string | null; existing: JobDuplicateMatch }[];
}): Promise<void> {
  if (opts.duplicates.length === 0) return;

  const examples = opts.duplicates.slice(0, MAX_EXAMPLES);
  const exampleLines = examples
    .map((d) => `- ${buildDuplicateMessage({ title: d.attemptedTitle, company: d.attemptedCompany, applyUrl: d.attemptedApplyUrl }, d.existing)}`)
    .join("\n");
  const remainder = opts.duplicates.length - examples.length;
  const moreLine = remainder > 0 ? `\n...and ${remainder} more. View the run for the full list.` : "";

  const title = `${opts.duplicates.length} duplicate job${opts.duplicates.length === 1 ? "" : "s"} blocked in ${opts.runLabel}`;
  const body = `${opts.duplicates.length} of ${opts.totalCandidates} jobs matched an apply link already in TalentOS and were not added.\n\n${exampleLines}${moreLine}`;

  await Promise.all([
    notifyAdmins({ type: "job_duplicate_summary", title, body, link: opts.runLink }),
    logActivity({
      type: "job_duplicate_summary",
      description: title,
      metadata: {
        runLabel: opts.runLabel,
        count: opts.duplicates.length,
        totalCandidates: opts.totalCandidates,
        examples: examples.map((d) => ({ title: d.attemptedTitle, company: d.attemptedCompany, matchedJobId: d.existing.id })),
      },
    }),
    triggerWebhooks("job.duplicate_detected", {
      runLabel: opts.runLabel,
      count: opts.duplicates.length,
      examples: examples.map((d) => ({ attemptedTitle: d.attemptedTitle, attemptedCompany: d.attemptedCompany, matchedJobId: d.existing.id })),
    }).catch(() => {}),
  ]);
}
