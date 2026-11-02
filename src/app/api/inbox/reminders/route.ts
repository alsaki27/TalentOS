import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { EMAIL_REMINDER_CATEGORIES, type EmailReminderScope, loadEmailReminderSnapshot } from "@/server/services/emailReminderService";

export const dynamic = "force-dynamic";

const scopes = new Set<EmailReminderScope>(["recent", "needs-reply", "waiting-12h", "overdue", "replied", "no-reply-needed", "all"]);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const intParam = (value: string | null, fallback: number, max: number) => Math.min(max, Math.max(1, Number.parseInt(value || "", 10) || fallback));

export async function GET(request: NextRequest) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  const url = new URL(request.url);
  const scope = (url.searchParams.get("scope") || "needs-reply") as EmailReminderScope;
  const category = (url.searchParams.get("category") || "").trim();
  const candidateId = (url.searchParams.get("candidateId") || "").trim();
  const focusEmailId = (url.searchParams.get("emailId") || "").trim();
  const search = (url.searchParams.get("search") || "").trim();
  const messagePage = intParam(url.searchParams.get("page"), 1, 1_000_000);
  const messagePageSize = intParam(url.searchParams.get("pageSize"), 20, 100);
  const candidatePage = intParam(url.searchParams.get("candidatePage"), 1, 1_000_000);
  const candidatePageSize = intParam(url.searchParams.get("candidatePageSize"), 20, 100);

  if (!scopes.has(scope)) return NextResponse.json({ error: "Invalid reminder filter." }, { status: 400 });
  if (category && ![...EMAIL_REMINDER_CATEGORIES, "application_confirmation"].includes(category as any)) {
    return NextResponse.json({ error: "Invalid email category." }, { status: 400 });
  }
  if (candidateId && !isUuid(candidateId)) return NextResponse.json({ error: "Invalid candidate filter." }, { status: 400 });
  if (focusEmailId && !isUuid(focusEmailId)) return NextResponse.json({ error: "Invalid email link." }, { status: 400 });

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 12 * 60 * 60_000);
  try {
    const snapshot = await loadEmailReminderSnapshot({
      windowStart,
      windowEnd,
      scope,
      category,
      candidateId,
      search,
      messagePage,
      messagePageSize,
      candidatePage,
      candidatePageSize,
      focusEmailId,
    });
    return NextResponse.json({
      ...snapshot,
      window: { start: windowStart.toISOString(), end: windowEnd.toISOString(), timezone: "Asia/Dhaka" },
    });
  } catch (error) {
    console.error("[email-reminders] Snapshot load failed", error);
    return NextResponse.json({ error: "Could not load email reminders. Check the server log for details." }, { status: 500 });
  }
}
