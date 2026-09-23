import { redirect } from "next/navigation";

// This page was never linked from anywhere in the app (orphaned) and
// duplicated a weaker version of what /inbox now does - status_change_approval
// items get their own page there (/inbox/approvals) and everything else
// (needs_reply, interview_followup, untracked_application, calendar_conflict)
// shows inline on /inbox.
export default function ActionItemsRedirect() {
  redirect("/inbox");
}
