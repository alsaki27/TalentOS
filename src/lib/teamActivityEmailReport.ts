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
  is_active: boolean;
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
  const visibleMembers = [...members].sort((left, right) => {
    const leftTotal = Object.values(left).filter((value) => typeof value === "number").reduce((sum, value) => sum + value, 0);
    const rightTotal = Object.values(right).filter((value) => typeof value === "number").reduce((sum, value) => sum + value, 0);
    return rightTotal - leftTotal || left.display_name.localeCompare(right.display_name);
  });

  const memberCards = visibleMembers.map((member) => {
    const total = member.jobs_added + member.candidates_logged + member.applications_reviewed + member.applications_applied;
    const cells = actionDefinitions.map(({ key, label }) => `
      <td style="padding:10px 6px;vertical-align:top;width:25%;border-top:1px solid #e4e8f0;">
        <div style="font:600 11px/1.35 Arial,sans-serif;color:#65708a;">${label}</div>
        <div style="margin-top:4px;font:700 18px/1.1 Arial,sans-serif;color:#17213b;">${number(member[key])}</div>
      </td>`).join("");
    return `
      <tr><td style="padding:16px 18px 4px;background:#ffffff;border:1px solid #e4e8f0;border-bottom:0;border-radius:12px 12px 0 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
          <td style="font:700 16px/1.3 Arial,sans-serif;color:#17213b;">${escapeHtml(member.display_name)}</td>
          <td align="right" style="white-space:nowrap;font:700 12px/1 Arial,sans-serif;color:${brandBlue};">${number(total)} ${total === 1 ? "action" : "actions"}</td>
        </tr><tr><td colspan="2" style="padding-top:3px;font:12px/1.4 Arial,sans-serif;color:#65708a;">${escapeHtml(member.role.replaceAll("_", " "))}${member.email ? ` · ${escapeHtml(member.email)}` : ""}</td></tr></table>
      </td></tr>
      <tr><td style="padding:0 12px 10px;background:#ffffff;border:1px solid #e4e8f0;border-top:0;border-radius:0 0 12px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${cells}</tr></table>
      </td></tr>
      <tr><td height="10" style="height:10px;font-size:1px;line-height:1px;">&nbsp;</td></tr>`;
  }).join("");

  const totalCells = actionDefinitions.map(({ key, label }) => `
      <td align="center" style="padding:12px 5px;width:25%;">
        <div style="font:600 10px/1.3 Arial,sans-serif;color:#d4ddf6;">${label}</div>
        <div style="margin-top:5px;font:700 21px/1 Arial,sans-serif;color:#ffffff;">${number(totals[key])}</div>
      </td>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f4f8;color:#17213b;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2f4f8;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;">
      <tr><td style="padding:20px 22px;background:#f7f8fc;border:1px solid #e4e8f0;border-bottom:0;border-radius:14px 14px 0 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
          <td width="52" valign="middle"><img src="https://www.skarion.com/logo.svg" width="40" height="32" alt="Skarion" style="display:block;border:0;outline:none;text-decoration:none;"></td>
          <td valign="middle"><div style="font:700 16px/1.1 Arial,sans-serif;letter-spacing:1.4px;color:${brandBlue};">SKARION</div><div style="margin-top:5px;font:12px/1.2 Arial,sans-serif;color:#58647c;">TalentOS · Team operations</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 22px 20px;background:#ffffff;">
        <div style="font:700 23px/1.25 Arial,sans-serif;color:#17213b;">${title}</div>
        <div style="margin-top:7px;font:14px/1.5 Arial,sans-serif;color:#65708a;">${description}</div>
        <div style="margin-top:12px;display:inline-block;padding:7px 10px;border-radius:6px;background:#eef5ff;font:600 12px/1.4 Arial,sans-serif;color:${brandBlue};">${escapeHtml(window.label)}</div>
      </td></tr>
      <tr><td style="padding:0 18px 16px;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${brandBlue};border-radius:10px;"><tr>${totalCells}</tr></table>
      </td></tr>
      <tr><td style="padding:4px 22px 10px;background:#ffffff;font:700 14px/1.4 Arial,sans-serif;color:#17213b;">Team member activity</td></tr>
      <tr><td style="padding:0 18px 18px;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${memberCards || `<tr><td style="padding:18px;border:1px solid #e4e8f0;border-radius:10px;font:14px/1.5 Arial,sans-serif;color:#65708a;">No team member activity was recorded for this period.</td></tr>`}</table>
      </td></tr>
      <tr><td align="center" style="padding:18px 22px;background:#ffffff;border-top:1px solid #edf0f5;">
        <a href="${escapeHtml(reportUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:${accent};color:#ffffff;text-decoration:none;font:700 13px/1 Arial,sans-serif;">Open TalentOS activity report</a>
        <div style="margin-top:14px;font:11px/1.5 Arial,sans-serif;color:#7b8498;">This scheduled summary uses verified TalentOS activity records. Resume edit events are excluded.</div>
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
