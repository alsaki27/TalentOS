import type { EmailReminderMessage } from "@/server/services/emailReminderService";

type DigestSnapshot = Awaited<ReturnType<typeof import("@/server/services/emailReminderService").loadEmailReminderSnapshot>>;

const escapeHtml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const formatTime = (value: Date | string) => new Intl.DateTimeFormat("en-BD", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function renderItems(items: EmailReminderMessage[], baseUrl: string, scope: string) {
  if (!items.length) return `<p style="margin:0;color:#64748b;font-size:13px">No messages in this group.</p>`;
  return items.slice(0, 12).map((item) => {
    const reminderUrl = `${baseUrl}/inbox/reminders?scope=${scope}&emailId=${encodeURIComponent(item.id)}&candidateId=${encodeURIComponent(item.candidate_id)}`;
    const job = [item.company_name, item.job_title].filter(Boolean).join(" · ");
    const status = item.overdue_24h ? "OVERDUE · 24+ HOURS" : item.replied_at ? (item.manual_reply ? "MARKED REPLIED" : "TEAM REPLIED") : "NEEDS REPLY";
    const statusColor = item.overdue_24h ? "#b91c1c" : item.replied_at ? "#15803d" : "#4338ca";
    return `<tr><td style="padding:12px 14px;border:1px solid #e2e8f0;border-radius:9px;background:#fff">
      <div style="font-size:11px;color:${statusColor};font-weight:700;letter-spacing:.35px">${escapeHtml(status)} · ${escapeHtml(formatTime(item.sent_at))}</div>
      <a href="${reminderUrl}" style="display:block;margin-top:5px;font-size:15px;font-weight:700;color:#1d4ed8;text-decoration:none">${escapeHtml(item.subject || "(no subject)")}</a>
      <div style="margin-top:4px;color:#334155;font-size:13px">${escapeHtml(item.candidate_name)}${job ? ` · ${escapeHtml(job)}` : ""}</div>
      <div style="margin-top:5px;color:#64748b;font-size:12px">${escapeHtml(item.ai_summary || item.snippet || item.ai_category.replaceAll("_", " "))}</div>
      <div style="margin-top:7px"><a href="${reminderUrl}" style="font-size:12px;color:#4f46e5;font-weight:700;text-decoration:none">Open this reminder →</a></div>
    </td></tr><tr><td height="7"></td></tr>`;
  }).join("") + (items.length > 12 ? `<tr><td style="padding:7px 2px;font-size:12px;color:#64748b">Showing 12 of ${items.length}. <a href="${baseUrl}/inbox/reminders?scope=${scope}">Open all</a></td></tr>` : "");
}

export function renderEmailReminderDigest(snapshot: DigestSnapshot, windowStart: Date, windowEnd: Date, baseUrl: string) {
  const open = snapshot.messages.filter((item) => item.needs_reply && !item.replied_at);
  const overdue = open.filter((item) => {
    const ageHours = (windowEnd.getTime() - new Date(item.sent_at).getTime()) / 3_600_000;
    return ageHours >= 24 && ageHours <= 24 * 7;
  });
  const waiting = open.filter((item) => {
    const ageHours = (windowEnd.getTime() - new Date(item.sent_at).getTime()) / 3_600_000;
    return ageHours >= 12 && ageHours < 24;
  });
  const metrics: Array<[string, number, string]> = [
    ["Needs reply", Number(snapshot.summary.needs_reply || 0), "Open · last 15 days"],
    ["Waiting 12–24 hours", Number(snapshot.summary.waiting_12h || 0), "Important candidate mail"],
    ["Overdue 24+ hours", Number(snapshot.summary.overdue_24h || 0), "Retained · last 7 days"],
    ["Replied · last 12 hours", Number(snapshot.summary.replied_12h || 0), "Auto-detected or marked replied"],
  ];
  const metricCards = metrics.map(([label, count, note]) => `<td width="25%" valign="top" style="padding:7px">
    <div style="height:82px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc">
      <div style="font-size:11px;line-height:1.35;color:#64748b">${label}</div><strong style="display:block;margin-top:5px;font-size:24px;color:#0f172a">${count.toLocaleString()}</strong><div style="margin-top:2px;font-size:10px;color:#64748b">${note}</div>
    </div>
  </td>`).join("");
  const section = (title: string, items: EmailReminderMessage[], scope: string, color: string) => `<h2 style="margin:22px 0 9px;font-size:15px;color:${color}">${title} <span style="color:#64748b;font-weight:500">(${items.length})</span></h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${renderItems(items, baseUrl, scope)}</table>`;
  const startLabel = formatTime(windowStart);
  const endLabel = formatTime(windowEnd);
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <main style="max-width:700px;margin:0 auto;padding:20px 12px"><div style="padding:22px;background:#fff;border:1px solid #dbe2ea;border-radius:14px">
    <div style="font-size:11px;color:#4f46e5;font-weight:700;letter-spacing:1px">TALENTOS · CANDIDATE EMAIL</div>
    <h1 style="margin:7px 0 4px;font-size:22px">Reply reminders</h1>
    <p style="margin:0;color:#64748b;font-size:12px">12-hour update · ${escapeHtml(startLabel)} – ${escapeHtml(endLabel)} Bangladesh time</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:13px -7px 6px;width:calc(100% + 14px)"><tr>${metricCards}</tr></table>
    ${section("Overdue · reply needed", overdue, "overdue", "#b91c1c")}
    ${section("Waiting · reply needed", waiting, "needs-reply", "#4338ca")}
    <p style="margin:18px 0 12px;color:#64748b;font-size:11px">Counts cover important candidate email from the last 15 days. Overdue items stay in the reminder view for 7 days.</p>
    <a href="${baseUrl}/inbox/reminders?scope=needs-reply" style="display:inline-block;padding:10px 15px;border-radius:8px;background:#4f46e5;color:#fff;font-size:13px;font-weight:700;text-decoration:none">Open email reminders</a>
  </div></main></body></html>`;
}
