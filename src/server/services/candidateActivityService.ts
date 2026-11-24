import { query, queryOne } from "@/server/db/neon";
import { activityDate, activityDateLabel, activityInDateRange, activityPage, safeActivityUrl, type CandidateActivityData, type CandidateActivityDateRange, type CandidateActivityItem, type CandidateActivityType } from "@/lib/candidateActivity";
import { CANDIDATE_PIPELINE_STAGES } from "@/lib/candidatePipeline";
import * as repo from "@/server/repositories/candidateActivityRepository";
import { customActivityState, type CandidateCustomActivity } from "@/lib/candidateCustomActivity";

type Row = Record<string, any>;
const labels: Record<string, string> = {
  "interview_stage.added": "Interview stage added", "interview_stage.updated": "Interview stage updated",
  "interview_stage.rescheduled": "Interview rescheduled", "interview_stage.cancelled": "Interview cancelled",
  "interview_stage.deleted": "Interview stage removed", "application.interview_scheduled": "Interview scheduled",
  "custom_interview.created": "Custom interview added", "custom_interview.updated": "Custom interview updated",
  "interview_audio.added": "Interview recording added", "interview_audio.removed": "Interview recording removed",
  "interview_audio.replaced": "Interview recording replaced",
  "interview_file.added": "Preparation document added", "interview_file.removed": "Preparation document removed",
  "interview_file.replaced": "Preparation document replaced",
};
function human(value: unknown) { return typeof value === "string" ? value.replace(/_/g, " ") : ""; }
function detail(entries: [string, unknown][]) {
  return entries.filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}
function appointment(value: unknown, timeZone?: string | null) {
  const at = activityDate(value);
  return at ? activityDateLabel(at, at.length === 10, timeZone) : null;
}
function currentInterviewDetails(stage: Row | null | undefined) {
  if (!stage) return [];
  return detail([
    ["Stage", stage.round_number], ["Stage name", stage.round_name], ["Status", human(stage.status)],
    ["Appointment", appointment(stage.scheduled_at, stage.time_zone)], ["Time zone", stage.time_zone],
    ["Format", human(stage.interview_format)], ["Duration", stage.duration_minutes == null ? null : `${stage.duration_minutes} minutes`],
    ["Location", stage.location], ["Mock interview taken", typeof stage.mock_interview_taken === "boolean" ? (stage.mock_interview_taken ? "Yes" : "No") : null],
    ["Preparation notes", stage.preparation_notes], ["Staff notes", stage.notes],
  ]);
}

export async function getCandidateActivity(candidateId: string, options: {
  limit: number; cursor: { at: string; id: string } | null; type?: CandidateActivityType; page?: number;
} & CandidateActivityDateRange): Promise<CandidateActivityData | null> {
  const candidate = await queryOne<{ id: string; name: string; pipeline_stage: keyof typeof CANDIDATE_PIPELINE_STAGES; status: string; timezone: string | null }>(
    "SELECT id,name,pipeline_stage,status,timezone FROM candidates WHERE id=$1", [candidateId]);
  if (!candidate) return null;
  const base = `/candidates/${candidateId}`;
  const trainingHref = `${base}?tab=Training%20Audit`;
  const optHref = `${base}?tab=OPT%20Status`;
  const items: CandidateActivityItem[] = [];
  const warnings: string[] = [];
  const current: CandidateActivityData["current"] = [
    { label: "Candidate stage", value: CANDIDATE_PIPELINE_STAGES[candidate.pipeline_stage] || human(candidate.pipeline_stage) || "Not recorded", href: `${base}?tab=Profile%20Overview` },
  ];
  const sources = [
    ["Interview", repo.ACTIVITY_INTERVIEWS_SQL], ["Interview changes", repo.ACTIVITY_AUDIT_SQL],
    ["Training notes", repo.ACTIVITY_NOTES_SQL],
    ["Mock interviews", repo.ACTIVITY_MOCKS_SQL], ["Training status", repo.ACTIVITY_TRAINING_SQL],
    ["OPT status", repo.ACTIVITY_OPT_SQL], ["Candidate changes", repo.ACTIVITY_LOGS_SQL],
    ["Custom activities", repo.ACTIVITY_CUSTOM_SQL],
  ] as const;
  const results = await Promise.allSettled(sources.map(([, sql]) => query<Row>(sql, [candidateId])));
  const rows = results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    warnings.push(`${sources[index][0]} could not be loaded.`);
    console.error("[candidate-activity] Source unavailable", sources[index][0], (result.reason as { code?: string })?.code || "unknown");
    return [];
  });
  function add(id: string, type: CandidateActivityType, title: string, date: unknown, summary: string,
    details: CandidateActivityItem["details"], href: string, extra: Partial<CandidateActivityItem> = {}) {
    const at = activityDate(date);
    if (!at) return;
    items.push({ id, candidateId, type, title, at, summary, dateOnly: at.length === 10, timeZone: candidate!.timezone || "UTC",
      details, links: [{ label: "Open source", href }], ...extra });
  }
  for (const row of rows[0]) {
    const summary = [row.job_title, row.company].filter(Boolean).join(" · ");
    const href = `${base}/applications/${row.application_id}`;
    if (!row.logged_creation) add(`interview:${row.id}:created`, "interview", "Interview stage added", row.created_at, summary,
      detail([["Recorded by", row.created_by]]), href, { currentDetails: currentInterviewDetails(row) });
    if (row.rescheduled_at && !row.logged_reschedule) add(`interview:${row.id}:rescheduled`, "interview", "Interview rescheduled", row.rescheduled_at, summary,
      detail([["Stage", row.round_number],
        ["Previous appointment", appointment(row.previous_scheduled_at, row.previous_time_zone)],
        ["New appointment", appointment(row.scheduled_at, row.time_zone)]]), href,
      { status: "rescheduled", currentDetails: currentInterviewDetails(row) });
  }
  for (const row of rows[1]) {
    const meta = row.metadata || {};
    const links = [{ label: "Open application", href: `${base}/applications/${row.application_id}` }];
    const meeting = safeActivityUrl(meta.meeting_link);
    if (meeting) links.push({ label: "Open meeting", href: meeting });
    const currentMeeting = safeActivityUrl(row.current_stage?.meeting_link);
    if (currentMeeting && currentMeeting !== meeting) links.push({ label: "Open current meeting", href: currentMeeting });
    const jobUrl = safeActivityUrl(row.job_url);
    if (jobUrl) links.push({ label: "Job posting", href: jobUrl });
    add(`audit:${row.id}`, "interview", labels[row.action] || "Interview updated", row.created_at,
      [row.job_title, row.company].filter(Boolean).join(" · "),
      detail([["Stage", meta.round_number ?? meta.round], ["Stage name", meta.round_name], ["Status", human(meta.status)], ["File", meta.filename],
        ["Previous appointment", appointment(meta.previous_scheduled_at, meta.previous_time_zone)],
        ["Appointment", appointment(meta.scheduled_at, meta.time_zone)],
        ["Format", human(meta.interview_format)], ["Location", meta.location], ["Staff notes", meta.notes],
        ["Preparation notes", meta.preparation_notes],
        ["Updated fields", Array.isArray(meta.fields) ? meta.fields.filter((field: unknown) => typeof field === "string").map((field: string) => field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")).join(", ") : null],
        ["Mock interview taken", typeof meta.mock_interview_taken === "boolean" ? (meta.mock_interview_taken ? "Yes" : "No") : null],
        ["Changed by", meta.actor || row.actor_email]]), links[0].href,
      { links, status: row.action.endsWith("rescheduled") ? "rescheduled" : meta.status,
        currentDetails: currentInterviewDetails(row.current_stage) });
  }
  for (const row of rows[2]) add(`training:${row.id}`, "training", row.category ? `${row.category} note` : "Training note",
    activityDate(row.date) || row.source_created_at, row.content,
    detail([["Note", row.content], ["Recorded by", row.author]]), trainingHref);
  for (const row of rows[3]) {
    const mockHref = `${trainingHref}#training-mock-${encodeURIComponent(row.id)}`;
    const score = row.overall_score == null ? null : `${row.overall_score}${row.overall_score_max ? `/${row.overall_score_max}` : ""}`;
    const summary = [row.round_type, row.target_role, score].filter(Boolean).join(" · ");
    const fields = detail([["Session date", row.session_date], ["Round", row.round_type], ["Role", row.target_role],
      ["Score", row.overall_score == null ? null : `${row.overall_score}${row.overall_score_max ? `/${row.overall_score_max}` : ""}`],
      ["Feedback", row.feedback_summary], ["Strengths", row.strengths_noted], ["Improvements", row.areas_for_improvement], ["Evaluator", row.created_by],
      ["Transcript", row.has_transcript ? "Available in the mock interview report" : null],
      ["Transcript source", row.has_transcript ? human(row.transcript_source) : null], ["Feedback document", row.pdf_filename]]);
    const updated = activityDate(row.updated_at), created = activityDate(row.created_at);
    const changed = Boolean(updated && created && Date.parse(updated) > Date.parse(created) + 1000);
    add(`mock:${row.id}:created`, "mock", "Mock interview record added", row.created_at, changed ? "" : summary,
      changed ? [{ label: "Details", value: "This record has since changed. Open the source for its current feedback." }] : fields, mockHref);
    if (changed) add(`mock:${row.id}:updated`, "mock", "Mock interview record updated", updated,
      summary, fields, mockHref);
  }
  const training = rows[4][0];
  if (training) current.push({ label: "Training progress", value: `${training.progress ?? "Not recorded"}${training.progress == null ? "" : "%"}${training.rating ? ` · ${human(training.rating)}` : ""}`, href: trainingHref });
  const opt = rows[5][0];
  const optDetails = opt ? detail([["Work authorization type", opt.ead_work_authorization_type],
    ["USCIS status", opt.uscis_current_status], ["Approval date", appointment(opt.approval_date)], ["Notes", opt.notes]]) : [];
  if (opt) {
    const status = opt.uscis_current_status || opt.ead_work_authorization_type;
    if (status) current.push({ label: "OPT / work authorization", value: status, href: optHref });
    const logged = rows[6].filter((row) => row.entity_type === "candidate_opt_status");
    if (!logged.length) {
      add(`opt:${opt.id}:created`, "opt", "OPT record added", opt.created_at, "", [], optHref);
      if (activityDate(opt.updated_at) !== activityDate(opt.created_at)) add(`opt:${opt.id}:updated`, "opt", "OPT status updated", opt.updated_at, status || "",
        detail([["Approval date", opt.approval_date], ["Current status", status]]), optHref,
        { currentDetails: optDetails, currentDetailsTitle: "Current OPT record" });
    }
  }
  for (const row of rows[6]) {
    const type = row.entity_type === "candidate_opt_status" ? "opt" : row.entity_type === "candidate_training" ? "training" : "status";
    const changes: [string, unknown][] = [];
    if (type === "training" && row.metadata?.after) {
      for (const [field, label] of [["progress", "Progress"], ["rating", "Rating"], ["domain", "Domain"],
        ["target_role", "Target role"], ["placement_company", "Placement company"], ["placement_role", "Placement role"], ["placement_date", "Placement date"]]) {
        const before = row.metadata.before?.[field], after = row.metadata.after[field];
        if (before !== after) changes.push([label, `${before == null || before === "" ? "Not recorded" : human(String(before))}${field === "progress" && before != null ? "%" : ""} → ${after == null || after === "" ? "Not recorded" : human(String(after))}${field === "progress" && after != null ? "%" : ""}`]);
      }
    }
    if (type === "opt" && row.metadata?.after) {
      for (const [field, label] of [["notes", "Notes"], ["uscis_current_status", "USCIS status"],
        ["ead_work_authorization_type", "Work authorization type"], ["approval_date", "Approval date"]]) {
        const before = row.metadata.before?.[field], after = row.metadata.after[field];
        if (before !== after) changes.push([label, `${before == null || before === "" ? "Not recorded" : String(before)} → ${after == null || after === "" ? "Not recorded" : String(after)}`]);
      }
    }
    add(`candidate:${row.id}`, type, type === "opt" ? (row.type === "delete" ? "OPT record removed" : "OPT status updated") :
      type === "training" ? "Training status updated" : "Candidate status updated", row.created_at,
      changes.slice(0, 2).map(([label, value]) => `${label}: ${value}`).join(" · "),
      detail([["Update", row.description], ["Changed by", row.actor_name],
        ["Updated fields", Array.isArray(row.metadata?.fields) ? row.metadata.fields.join(", ") : null], ...changes]),
      type === "opt" ? optHref : type === "training" ? trainingHref : `${base}?tab=Profile%20Overview`,
      type === "opt" && optDetails.length ? { currentDetails: optDetails, currentDetailsTitle: "Current OPT record" } : {});
  }
  let upcoming: CandidateActivityItem[] = [];
  for (const row of rows[7]) {
    const record = row as CandidateCustomActivity;
    const links = [{ label: "Open candidate profile", href: base }];
    const link = safeActivityUrl(record.link);
    if (link) links.unshift({ label: "Open link", href: link });
    add(`custom:${record.id}`, "custom", record.title, record.updated_at, record.body,
      detail([["Reason / description", record.body],
        ["Start", appointment(record.starts_at || record.start_date, record.time_zone)],
        ["End", appointment(record.ends_at || record.end_date, record.time_zone)],
        ["Time zone", record.time_zone], ["Added", appointment(record.created_at, candidate.timezone)],
        ["Last updated", appointment(record.updated_at, candidate.timezone)], ["Updated by", row.actor_name]]), base,
      { status: customActivityState(record), customActivity: record, links });
  }
  try { upcoming = (await repo.candidateUpcoming([candidateId], 100)).get(candidateId) || []; }
  catch { warnings.push("Upcoming activities could not be loaded."); }
  const filtered = items.filter((item) => (!options.type || item.type === options.type) && activityInDateRange(item, options));
  return { candidate: { id: candidate.id, name: candidate.name, timezone: candidate.timezone }, ...activityPage(filtered, options.limit, options.cursor, options.page), upcoming, current, warnings };
}
