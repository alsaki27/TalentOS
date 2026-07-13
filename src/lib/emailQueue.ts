// src/lib/emailQueue.ts
// Simple cron-like email queue processor.
// Called by a cron job or manual trigger to process pending email sequence steps.

import { query, queryOne, execute } from "@/server/db/neon";
import { sendEmail, renderTemplate } from "./emailService";

export interface ProcessResult {
  processed: number;
  failed: number;
  errors: string[];
}

export async function processEmailQueue(): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, failed: 0, errors: [] };

  try {
    // Find pending sequence steps where delay_hours has passed since trigger
    const pendingItems = await query<any>(
      `SELECT eq.*, et.subject AS template_subject, et.body AS template_body
       FROM email_queue eq
       LEFT JOIN email_templates et ON eq.template_id = et.id
       WHERE eq.status = 'pending' AND eq.trigger_at <= $1`,
      [new Date().toISOString()]
    );

    if (!pendingItems || pendingItems.length === 0) {
      return result;
    }

    for (const item of pendingItems) {
      try {
        const candidate = await queryOne<{ id: string; name: string; email: string }>(
          "SELECT id, name, email FROM candidates WHERE id = $1",
          [item.candidate_id]
        );

        if (!candidate?.email) {
          result.failed++;
          result.errors.push(`Candidate ${item.candidate_id} has no email.`);
          await execute(
            "UPDATE email_queue SET status = 'failed', error = 'No candidate email' WHERE id = $1",
            [item.id]
          );
          continue;
        }

        const templateBody = item.template_body ?? "";
        const subject = item.template_subject ?? "";
        const mergeData: Record<string, string> = {
          candidate_name: candidate.name || "Candidate",
        };

        const renderedBody = renderTemplate(templateBody, mergeData);
        const renderedSubject = renderTemplate(subject, mergeData);

        const sendResult = await sendEmail({
          to: candidate.data.email,
          subject: renderedSubject,
          body: renderedBody,
          candidateId: item.candidate_id,
          templateId: item.template_id,
          sequenceId: item.sequence_id,
          stepNumber: item.step_number,
        });

        if (sendResult.success) {
          await execute(
            "UPDATE email_queue SET status = 'sent', sent_at = $1 WHERE id = $2",
            [new Date().toISOString(), item.id]
          );
          result.processed++;
        } else {
          await execute(
            "UPDATE email_queue SET status = 'failed', error = $1 WHERE id = $2",
            [sendResult.error ?? "Unknown", item.id]
          );
          result.failed++;
          result.errors.push(`Step ${item.step_number} failed: ${sendResult.error}`);
        }
      } catch (err: any) {
        result.failed++;
        result.errors.push(`Item ${item.id} error: ${err?.message ?? "Unknown"}`);
      }
    }

    return result;
  } catch (err: any) {
    result.errors.push(`Queue processor error: ${err?.message ?? "Unknown"}`);
    return result;
  }
}
