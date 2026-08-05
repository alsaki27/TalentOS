// src/lib/emailService.ts
// Mock email service — logs to DB but does not actually send.
// Replace with Resend/SendGrid integration when ready.

import { query, queryOne, execute } from "@/server/db/neon";
import { isGraphMailConfigured, sendGraphMail } from "@/lib/msGraphMail";

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  candidateId?: string;
  templateId?: string;
  sequenceId?: string;
  stepNumber?: number;
  sentBy?: string;
  channel?: string;
}

export interface SendEmailResult {
  success: boolean;
  logId?: string;
  error?: string;
}

const ALLOWED_TAGS = [
  "candidate_name",
  "job_title",
  "company_name",
  "interviewer_name",
  "interview_date",
  "interview_time",
  "interview_link",
  "portal_url",
];

export function renderTemplate(templateBody: string, mergeData: Record<string, string>): string {
  return templateBody.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    if (!ALLOWED_TAGS.includes(key)) return _match; // leave unknown tags as-is
    return mergeData[key] ?? _match;
  });
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  try {
    // Delivery priority: Microsoft Graph (talent@skarion.com via Microsoft 365)
    // if configured, then Resend, then log-only mock — same graceful-degrade
    // pattern as encryptSecret() elsewhere in this codebase, so this is safe to
    // ship regardless of which (if either) is set up yet.
    let deliveryError: string | null = null;

    if (!opts.to) {
      deliveryError = "No recipient address provided";
    } else if (isGraphMailConfigured()) {
      const result = await sendGraphMail({ to: opts.to, subject: opts.subject, html: opts.body });
      if (!result.success) deliveryError = result.error ?? "Microsoft Graph send failed";
    } else if (process.env.RESEND_API_KEY) {
      const from = process.env.EMAIL_FROM || "TalentOS <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.body }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        deliveryError = `Resend error (${res.status}): ${errBody.slice(0, 300)}`;
      }
    }

    if (deliveryError) {
      console.error(`[emailService] Delivery failed for ${opts.to}: ${deliveryError}`);
    }

    const data = await queryOne<{ id: string }>(
      `INSERT INTO email_logs (candidate_id, template_id, sequence_id, step_number, subject, body, status, sent_by, sent_at, error_message) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [opts.candidateId ?? null, opts.templateId ?? null, opts.sequenceId ?? null, opts.stepNumber ?? null, opts.subject, opts.body, deliveryError ? "failed" : "sent", opts.sentBy ?? null, new Date().toISOString(), deliveryError]
    );
    if (!data) {
      return { success: false, error: "Insert failed" };
    }
    if (deliveryError) {
      return { success: false, error: deliveryError, logId: data.id };
    }
    return { success: true, logId: data.id };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Unknown error" };
  }
}

export async function triggerSequence(
  candidateId: string,
  sequenceId: string,
  triggerEvent: string,
  mergeData: Record<string, string> = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    let sequence: any;
    sequence = await queryOne(
      "SELECT id, trigger_event, is_active FROM email_sequences WHERE id = $1",
      [sequenceId]
    );

    if (!sequence) return { success: false, error: "Sequence not found" };
    if (!sequence.is_active) return { success: false, error: "Sequence is paused" };
    if (sequence.trigger_event && sequence.trigger_event !== triggerEvent) {
      return { success: false, error: "Trigger event mismatch" };
    }

    let steps: any[];
    steps = await query(
      `
      SELECT s.*,
        CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id', t.id, 'name', t.name, 'subject', t.subject, 'body', t.body) END as templates
      FROM email_sequence_steps s
      LEFT JOIN email_templates t ON s.template_id = t.id
      WHERE s.sequence_id = $1
      ORDER BY s.step_number ASC
      `,
      [sequenceId]
    );

    if (!steps || steps.length === 0) {
      return { success: false, error: "No steps in sequence" };
    }

    // For now, send the first step immediately and log remaining steps for later
    const firstStep = steps[0];
    const templateBody = firstStep.templates?.body ?? "";
    const subject = firstStep.templates?.subject ?? "";
    const renderedBody = renderTemplate(templateBody, mergeData);
    const renderedSubject = renderTemplate(subject, mergeData);

    const result = await sendEmail({
      to: "", // will be filled from candidate record in real implementation
      subject: renderedSubject,
      body: renderedBody,
      candidateId,
      templateId: firstStep.template_id,
      sequenceId,
      stepNumber: firstStep.step_number,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Log remaining steps as pending for the email queue processor
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      await execute(
        "INSERT INTO email_queue (candidate_id, sequence_id, step_number, template_id, delay_hours, trigger_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [candidateId, sequenceId, step.step_number, step.template_id, step.delay_hours, new Date(Date.now() + step.delay_hours * 60 * 60 * 1000).toISOString(), "pending"]
      );
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Unknown error" };
  }
}
