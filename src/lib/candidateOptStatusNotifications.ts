import { formatOptCalendarDate, addDaysToIsoDate, OPT_APPROVAL_WINDOW_DAYS } from "@/lib/candidateOptStatus";
import { query } from "@/server/db/neon";

/** Notify every active internal TalentOS user after an exact approval date is saved. */
export async function notifyTeamOfOptApproval(opts: {
  candidateId: string;
  candidateName: string;
  approvalDate: string;
}): Promise<void> {
  const endDate = addDaysToIsoDate(opts.approvalDate, OPT_APPROVAL_WINDOW_DAYS);
  if (!endDate) return;

  const title = `90-day OPT countdown: ${opts.candidateName} (${opts.approvalDate})`;
  const body = `Approval date: ${formatOptCalendarDate(opts.approvalDate, "en-US")}. The ${OPT_APPROVAL_WINDOW_DAYS}-day countdown starts on this date and reaches 0 on ${formatOptCalendarDate(endDate, "en-US")}.`;

  await query(
    `INSERT INTO notifications (user_id, type, title, body, link, entity_type, entity_id)
     SELECT p.user_id::text, 'warning', $1, $2, $3, 'candidate_opt_status', $4
       FROM profiles p
      WHERE p.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.user_id = p.user_id::text
             AND n.type = 'warning'
             AND n.title = $1
             AND n.entity_type = 'candidate_opt_status'
             AND n.entity_id = $4
        )
     ON CONFLICT DO NOTHING`,
    [title, body, `/candidates/${opts.candidateId}`, opts.candidateId],
  );
}
