const REPORT_TIMEZONE = "America/New_York";

export type TeamActivityCounts = {
  jobs_added: number;
  candidates_logged: number;
  applications_reviewed: number;
  applications_applied: number;
};

export type TeamActivityMember = TeamActivityCounts & {
  actor_user_id: string;
  display_name: string;
  email: string | null;
  role: string;
  role_variant?: string | null;
  is_active: boolean;
};

export type TeamActivityReportGroup = {
  reviewer: TeamActivityMember | null;
  grunters: TeamActivityMember[];
  jobs_added: number;
  candidates_logged: number;
  applications_reviewed: number;
  applications_applied: number;
};

export type TeamActivityPeriod = "daily" | "weekly";

export type TeamActivityReportWindow = {
  startAt: Date;
  endAt: Date;
  label: string;
  subjectDate: string;
};

function zonedParts(date: Date, timeZone = REPORT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number) {
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desiredAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const fields = zonedParts(new Date(guess));
    const representedAsUtc = Date.UTC(
      Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute),
    );
    const adjustment = desiredAsUtc - representedAsUtc;
    if (adjustment === 0) break;
    guess += adjustment;
  }
  return new Date(guess);
}

function addCalendarDays(year: number, month: number, day: number, amount: number) {
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function prettyDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function prettyDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function prettyTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function getTeamActivityReportWindow(period: TeamActivityPeriod, now = new Date()): TeamActivityReportWindow {
  const fields = zonedParts(now);
  const year = Number(fields.year);
  const month = Number(fields.month);
  const day = Number(fields.day);
  const hour = Number(fields.hour);
  const minute = Number(fields.minute);
  const endAt = now;
  const startAt = period === "daily"
    ? localDateTimeToUtc(year, month, day, 0, 0)
    : (() => {
      const previousWeek = addCalendarDays(year, month, day, -7);
      return localDateTimeToUtc(previousWeek.year, previousWeek.month, previousWeek.day, hour, minute);
    })();

  return {
    startAt,
    endAt,
    label: period === "daily"
      ? `${prettyDate(now)} · 12:00 AM–${prettyTime(now)}`
      : `${prettyDateTime(startAt)}–${prettyDateTime(endAt)}`,
    subjectDate: prettyDate(now),
  };
}

export function summarizeTeamActivity(members: TeamActivityMember[]) {
  return members.reduce((totals, member) => {
    totals.jobs_added += member.jobs_added;
    totals.candidates_logged += member.candidates_logged;
    totals.applications_reviewed += member.applications_reviewed;
    totals.applications_applied += member.applications_applied;
    return totals;
  }, { jobs_added: 0, candidates_logged: 0, applications_reviewed: 0, applications_applied: 0 });
}

// Current reviewer/grunter assignments follow the team's approved weekly
// dashboard. Unmatched active AE variants are retained below as unassigned
// rows, so a roster change never silently removes a person's activity.
const REVIEWER_GRUNTER_ASSIGNMENTS = [
  { reviewer: ["azmain"], grunters: [["tafhim"]] },
  { reviewer: ["saiba"], grunters: [["piniti"], ["rakib"]] },
  { reviewer: ["sareta"], grunters: [["fardin"]] },
  { reviewer: ["wafia"], grunters: [["zaman"]] },
  { reviewer: ["takoat"], grunters: [["sagor"]] },
  { reviewer: ["tahsina", "tahshina"], grunters: [["avimanyue"]] },
] as const;

function hasNameToken(member: TeamActivityMember, tokens: readonly string[]) {
  const nameTokens = member.display_name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((token) => nameTokens.includes(token));
}

function isReviewer(member: TeamActivityMember) {
  return member.role_variant === "application_engineer_reviewer"
    || member.role_variant === "application_engineer_manager_reviewer";
}

function isGrunter(member: TeamActivityMember) {
  return member.role_variant === "application_engineer_grunter";
}

function groupFromMembers(reviewer: TeamActivityMember | null, grunters: TeamActivityMember[]): TeamActivityReportGroup {
  return {
    reviewer,
    grunters,
    jobs_added: reviewer?.jobs_added ?? 0,
    candidates_logged: reviewer?.candidates_logged ?? 0,
    applications_reviewed: reviewer?.applications_reviewed ?? 0,
    applications_applied: grunters.reduce((total, member) => total + member.applications_applied, 0),
  };
}

export function buildTeamActivityGroups(members: TeamActivityMember[]): TeamActivityReportGroup[] {
  const reviewers = members.filter(isReviewer);
  const grunters = members.filter(isGrunter);
  const usedReviewers = new Set<string>();
  const usedGrunters = new Set<string>();
  const groups: TeamActivityReportGroup[] = [];

  for (const assignment of REVIEWER_GRUNTER_ASSIGNMENTS) {
    const reviewer = reviewers.find((member) => !usedReviewers.has(member.actor_user_id)
      && assignment.reviewer.some((token) => hasNameToken(member, [token])));
    if (!reviewer) continue;
    usedReviewers.add(reviewer.actor_user_id);
    const assigned = assignment.grunters.map((tokens) => grunters.find((member) => !usedGrunters.has(member.actor_user_id)
      && tokens.some((token) => hasNameToken(member, [token])))).filter((member): member is TeamActivityMember => Boolean(member));
    for (const grunter of assigned) usedGrunters.add(grunter.actor_user_id);
    groups.push(groupFromMembers(reviewer, assigned));
  }

  for (const reviewer of reviewers) {
    if (usedReviewers.has(reviewer.actor_user_id)) continue;
    usedReviewers.add(reviewer.actor_user_id);
    groups.push(groupFromMembers(reviewer, []));
  }

  // Preserve any new or renamed grunter until the assignment table is updated.
  for (const grunter of grunters) {
    if (usedGrunters.has(grunter.actor_user_id)) continue;
    usedGrunters.add(grunter.actor_user_id);
    groups.push(groupFromMembers(null, [grunter]));
  }

  // Keep legacy base Application Engineer accounts visible while teams finish
  // assigning the new reviewer/grunter variants.
  const unclassified = members.filter((member) => member.role === "application_engineer" && !member.role_variant);
  for (const member of unclassified) groups.push(groupFromMembers(member, []));
  return groups;
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

const number = (value: number) => Number(value || 0).toLocaleString("en-US");
const actionDefinitions: Array<{ key: keyof TeamActivityCounts; label: string }> = [
  { key: "jobs_added", label: "Jobs added" },
  { key: "candidates_logged", label: "Candidates logged" },
  { key: "applications_reviewed", label: "Reviews completed" },
  { key: "applications_applied", label: "Marked as applied" },
];

export function renderTeamActivityEmail(options: {
  period: TeamActivityPeriod;
  window: TeamActivityReportWindow;
  members: TeamActivityMember[];
  reportUrl: string;
}) {
  const { period, window, members, reportUrl } = options;
  const totals = summarizeTeamActivity(members);
  const title = period === "daily" ? "Daily team activity" : "Weekly team activity";
  const description = period === "daily"
    ? "A clear summary of today’s verified team actions."
    : "A seven-day summary of the team’s verified actions.";
  const brandBlue = "#16275f";
  const accent = "#0ea5b7";
  const groups = buildTeamActivityGroups(members);
  const tableRows = groups.map((group, index) => {
    const grunterNames = group.grunters.length
      ? group.grunters.map((member) => `<div style="padding:2px 0;color:#52647d;">${escapeHtml(member.display_name)} <span style="color:#17213b;font-weight:700;">(${number(member.applications_applied)} applied)</span></div>`).join("")
      : `<span style="color:#8b95a8;">—</span>`;
    const reviewerName = group.reviewer ? escapeHtml(group.reviewer.display_name) : "Other AE activity";
    const background = index % 2 === 0 ? "#ffffff" : "#f3f6fa";
    return `<tr style="background:${background};">
      <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font:700 12px/1.35 Arial,sans-serif;color:#17213b;overflow-wrap:anywhere;">${reviewerName}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;font:11px/1.35 Arial,sans-serif;">${grunterNames}</td>
      <td align="right" style="padding:10px 7px;border-bottom:1px solid #e2e8f0;font:700 12px Arial,sans-serif;color:#17213b;">${number(group.jobs_added)}</td>
      <td align="right" style="padding:10px 7px;border-bottom:1px solid #e2e8f0;font:700 12px Arial,sans-serif;color:#17213b;">${number(group.candidates_logged)}</td>
      <td align="right" style="padding:10px 7px;border-bottom:1px solid #e2e8f0;font:700 12px Arial,sans-serif;color:#17213b;">${number(group.applications_reviewed)}</td>
      <td align="right" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font:700 12px Arial,sans-serif;color:#17213b;">${number(group.applications_applied)}</td>
    </tr>`;
  }).join("");

  const scale = period === "daily" ? 60 : 300;
  const chartRows = groups.map((group) => {
    const reviewerName = group.reviewer?.display_name ?? "Other AE";
    const grunterLabel = group.grunters.length
      ? group.grunters.map((member) => `${member.display_name} · ${number(member.applications_applied)} applied`).join(", ")
      : "No assigned grunter";
    const bars = [
      { label: "Applied", value: group.applications_applied, color: "#e97132" },
      { label: "Reviews", value: group.applications_reviewed, color: "#156082" },
    ].map(({ label, value, color }) => {
      const width = Math.min(100, Math.max(0, (value / scale) * 100));
      const trackCells = width === 0
        ? `<td class="chart-track-empty" width="100%" bgcolor="#e7edf3" style="height:10px;background:#e7edf3;border-radius:5px;"></td>`
        : `<td class="chart-track-value" width="${width}%" bgcolor="${color}" style="height:10px;background:${color};border-radius:5px 0 0 5px;"></td><td class="chart-track-rest" style="height:10px;"></td>`;
      return `<tr>
        <td class="chart-measure-label" style="width:13%;padding:4px 5px;border-bottom:1px solid #eef1f5;font:10px Arial,sans-serif;color:#52647d;">${label}</td>
        <td class="chart-track-cell" style="width:74%;padding:4px 5px;border-bottom:1px solid #eef1f5;">
          <table class="chart-track" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#e7edf3" style="width:100%;height:10px;table-layout:fixed;border-radius:5px;"><tr>${trackCells}</tr></table>
        </td>
        <td class="chart-measure-value" align="right" style="width:13%;padding:4px 4px 4px 2px;border-bottom:1px solid #eef1f5;font:700 11px Arial,sans-serif;color:#17243c;">${number(value)}</td>
      </tr>`;
    }).join("");
    return `<tr><td class="chart-member" style="width:32%;padding:6px 4px;border-bottom:1px solid #dfe6ed;vertical-align:middle;">
      <div class="chart-member-name" style="font:700 12px/1.35 Arial,sans-serif;color:#17243c;overflow-wrap:anywhere;">${escapeHtml(reviewerName)}</div>
      <div class="chart-grunter-names" style="padding-top:2px;font:10px/1.35 Arial,sans-serif;color:#52647d;overflow-wrap:anywhere;">${escapeHtml(grunterLabel)}</div>
    </td><td class="chart-metrics" style="width:68%;padding:0;border-bottom:1px solid #dfe6ed;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${bars}</table></td></tr>`;
  }).join("");

  const totalCells = actionDefinitions.map(({ key, label }) => `
      <td align="center" style="padding:12px 5px;width:25%;">
        <div style="font:600 10px/1.3 Arial,sans-serif;color:#d4ddf6;">${label}</div>
        <div style="margin-top:5px;font:700 21px/1 Arial,sans-serif;color:#ffffff;">${number(totals[key])}</div>
      </td>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style type="text/css">
    @media only screen and (max-width:600px) {
      .email-gutter { padding:8px !important; }
      .email-shell { width:100% !important; max-width:100% !important; }
      .email-section { padding-left:10px !important; padding-right:10px !important; }
      .report-table th { padding:7px 3px !important; font-size:9px !important; }
      .report-table td { padding:7px 3px !important; font-size:10px !important; }
      .chart-member, .chart-metrics { display:block !important; width:100% !important; max-width:100% !important; box-sizing:border-box !important; }
      .chart-member { padding:9px 8px 3px !important; border-bottom:0 !important; }
      .chart-metrics { padding:0 6px 8px !important; }
      .chart-member-name { font-size:13px !important; }
      .chart-grunter-names { font-size:11px !important; }
      .chart-measure-label { width:15% !important; }
      .chart-track-cell { width:73% !important; }
      .chart-measure-value { width:12% !important; }
    }
  </style></head>
<body style="margin:0;padding:0;background:#f2f4f8;color:#17213b;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2f4f8;"><tr><td class="email-gutter" align="center" style="padding:24px 12px;">
    <table class="email-shell" role="presentation" width="980" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:980px;">
      <tr><td style="padding:20px 22px;background:#f7f8fc;border:1px solid #e4e8f0;border-bottom:0;border-radius:14px 14px 0 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
          <td width="52" valign="middle"><img src="https://www.skarion.com/logo.svg" width="40" height="32" alt="Skarion" style="display:block;border:0;outline:none;text-decoration:none;"></td>
          <td valign="middle"><div style="font:700 16px/1.1 Arial,sans-serif;letter-spacing:1.4px;color:${brandBlue};">SKARION</div><div style="margin-top:5px;font:12px/1.2 Arial,sans-serif;color:#58647c;">TalentOS · Team operations</div></td>
        </tr></table>
      </td></tr>
      <tr><td class="email-section" style="padding:24px 22px 20px;background:#ffffff;">
        <div style="font:700 23px/1.25 Arial,sans-serif;color:#17213b;">${title}</div>
        <div style="margin-top:7px;font:14px/1.5 Arial,sans-serif;color:#65708a;">${description}</div>
        <div style="margin-top:12px;display:inline-block;padding:7px 10px;border-radius:6px;background:#eef5ff;font:600 12px/1.4 Arial,sans-serif;color:${brandBlue};">${escapeHtml(window.label)}</div>
      </td></tr>
      <tr><td class="email-section" style="padding:0 18px 16px;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${brandBlue};border-radius:10px;"><tr>${totalCells}</tr></table>
      </td></tr>
      <tr><td style="padding:4px 22px 10px;background:#ffffff;font:700 14px/1.4 Arial,sans-serif;color:#17213b;">Application Engineer activity</td></tr>
      <tr><td class="email-section" style="padding:0 18px 18px;background:#ffffff;">
        <table class="report-table" role="table" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;border:1px solid #dce3ec;border-collapse:collapse;">
          <thead><tr style="background:#16275f;color:#ffffff;">
            <th align="left" style="width:19%;padding:10px 8px;font:700 11px/1.3 Arial,sans-serif;">Reviewer</th>
            <th align="left" style="width:31%;padding:10px 8px;font:700 11px/1.3 Arial,sans-serif;">Assigned grunter(s)</th>
            <th align="right" style="width:10%;padding:10px 5px;font:700 11px/1.3 Arial,sans-serif;">Jobs added</th>
            <th align="right" style="width:13%;padding:10px 5px;font:700 11px/1.3 Arial,sans-serif;">Logged</th>
            <th align="right" style="width:14%;padding:10px 5px;font:700 11px/1.3 Arial,sans-serif;">Reviews</th>
            <th align="right" style="width:13%;padding:10px 8px;font:700 11px/1.3 Arial,sans-serif;">Applied</th>
          </tr></thead>
          <tbody>${tableRows || `<tr><td colspan="6" style="padding:18px;font:14px/1.5 Arial,sans-serif;color:#65708a;">No Application Engineer activity was recorded for this period.</td></tr>`}</tbody>
        </table>
      </td></tr>
      <tr><td class="email-section" style="padding:8px 22px 10px;background:#ffffff;font:700 14px/1.4 Arial,sans-serif;color:#17213b;">Team comparison · scale 0–${scale}</td></tr>
      <tr><td style="padding:0 18px 18px;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #dce3ec;border-collapse:collapse;">
          <thead><tr><th align="left" style="width:32%;padding:9px 6px;background:#f3f6fa;font:700 10px Arial,sans-serif;color:#52647d;">Reviewer · grunter</th><th style="padding:9px 6px;background:#f3f6fa;"><span style="font:700 10px Arial,sans-serif;color:#e97132;">■ Marked applied</span><span style="padding-left:12px;font:700 10px Arial,sans-serif;color:#156082;">■ Reviews completed</span></th></tr></thead>
          <tbody>${chartRows || `<tr><td colspan="2" style="padding:14px;font:13px Arial,sans-serif;color:#65708a;">No comparison data available.</td></tr>`}</tbody>
          <tfoot><tr><td></td><td style="padding:5px 5px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${[0, 0.2, 0.4, 0.6, 0.8, 1].map((fraction) => `<td align="${fraction === 0 ? "left" : fraction === 1 ? "right" : "center"}" style="font:9px Arial,sans-serif;color:#667b98;">${number(Math.round(scale * fraction))}</td>`).join("")}</tr></table></td></tr></tfoot>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:18px 22px;background:#ffffff;border-top:1px solid #edf0f5;">
        <a href="${escapeHtml(reportUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:${accent};color:#ffffff;text-decoration:none;font:700 13px/1 Arial,sans-serif;">Open TalentOS activity report</a>
        <div style="margin-top:14px;font:11px/1.5 Arial,sans-serif;color:#7b8498;">Daily and weekly reports use the same layout. Activity comes from verified TalentOS records; resume edit events are excluded.</div>
      </td></tr>
      <tr><td style="padding:16px 22px;text-align:center;font:11px/1.5 Arial,sans-serif;color:#7b8498;">Skarion · TalentOS<br>Automated team activity summary</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function getTeamActivityReportRecipients(raw = process.env.TEAM_ACTIVITY_REPORT_RECIPIENTS || "") {
  const addresses = raw.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean);
  const valid = addresses.filter((address) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(address));
  return Array.from(new Set(valid.map((address) => address.toLowerCase())));
}
