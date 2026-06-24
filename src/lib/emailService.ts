// src/lib/emailService.ts
// Mock email service — logs to DB but does not actually send.
// Replace with Resend/SendGrid integration when ready.

import { supabase } from "./supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

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
    // Mock: just log to DB. Replace with Resend/SendGrid integration.
    if (isNeon()) {
      const data = await queryOne<{ id: string }>(
        `INSERT INTO email_logs (candidate_id, template_id, sequence_id, step_number, subject, body, status, sent_by, sent_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [opts.candidateId ?? null, opts.templateId ?? null, opts.sequenceId ?? null, opts.stepNumber ?? null, opts.subject, opts.body, "sent", opts.sentBy ?? null, new Date().toISOString()]
      );
      if (!data) {
        return { success: false, error: "Insert failed" };
      }
      return { success: true, logId: data.id };
    }

    const { data, error } = await supabase
      .from("email_logs")
      .insert({
        candidate_id: opts.candidateId ?? null,
        template_id: opts.templateId ?? null,
        sequence_id: opts.sequenceId ?? null,
        step_number: opts.stepNumber ?? null,
        subject: opts.subject,
        body: opts.body,
        status: "sent",
        sent_by: opts.sentBy ?? null,
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, logId: data?.id };
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
    if (isNeon()) {
      sequence = await queryOne(
        "SELECT id, trigger_event, is_active FROM email_sequences WHERE id = $1",
        [sequenceId]
      );
    } else {
      const { data } = await supabase
        .from("email_sequences")
        .select("id, trigger_event, is_active")
        .eq("id", sequenceId)
        .maybeSingle();
      sequence = data;
    }

    if (!sequence) return { success: false, error: "Sequence not found" };
    if (!sequence.is_active) return { success: false, error: "Sequence is paused" };
    if (sequence.trigger_event && sequence.trigger_event !== triggerEvent) {
      return { success: false, error: "Trigger event mismatch" };
    }

    let steps: any[];
    if (isNeon()) {
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
    } else {
      const { data } = await supabase
        .from("email_sequence_steps")
        .select("*, templates:email_templates(*)")
        .eq("sequence_id", sequenceId)
        .order("step_number", { ascending: true });
      steps = data ?? [];
    }

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
    if (isNeon()) {
      for (let i = 1; i < steps.length; i++) {
        const step = steps[i];
        await execute(
          "INSERT INTO email_queue (candidate_id, sequence_id, step_number, template_id, delay_hours, trigger_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [candidateId, sequenceId, step.step_number, step.template_id, step.delay_hours, new Date(Date.now() + step.delay_hours * 60 * 60 * 1000).toISOString(), "pending"]
        );
      }
    } else {
      for (let i = 1; i < steps.length; i++) {
        const step = steps[i];
        await supabase.from("email_queue").insert({
          candidate_id: candidateId,
          sequence_id: sequenceId,
          step_number: step.step_number,
          template_id: step.template_id,
          delay_hours: step.delay_hours,
          trigger_at: new Date(Date.now() + step.delay_hours * 60 * 60 * 1000).toISOString(),
          status: "pending",
        });
      }
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Unknown error" };
  }
}
