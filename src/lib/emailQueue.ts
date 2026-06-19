// src/lib/emailQueue.ts
// Simple cron-like email queue processor.
// Called by a cron job or manual trigger to process pending email sequence steps.

import { supabase } from "./supabase";
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
    const { data: pendingItems, error } = await supabase
      .from("email_queue")
      .select("*, templates:email_templates(*)")
      .eq("status", "pending")
      .lte("trigger_at", new Date().toISOString());

    if (error) {
      result.errors.push(`Queue fetch error: ${error.message}`);
      return result;
    }

    if (!pendingItems || pendingItems.length === 0) {
      return result;
    }

    for (const item of pendingItems) {
      try {
        const candidate = await supabase
          .from("candidates")
          .select("id, name, email")
          .eq("id", item.candidate_id)
          .maybeSingle();

        if (!candidate.data?.email) {
          result.failed++;
          result.errors.push(`Candidate ${item.candidate_id} has no email.`);
          await supabase
            .from("email_queue")
            .update({ status: "failed", error: "No candidate email" })
            .eq("id", item.id);
          continue;
        }

        const templateBody = item.templates?.body ?? "";
        const subject = item.templates?.subject ?? "";
        const mergeData: Record<string, string> = {
          candidate_name: candidate.data.name || "Candidate",
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
          await supabase
            .from("email_queue")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", item.id);
          result.processed++;
        } else {
          await supabase
            .from("email_queue")
            .update({ status: "failed", error: sendResult.error ?? "Unknown" })
            .eq("id", item.id);
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
