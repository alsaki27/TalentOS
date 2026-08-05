// src/app/api/candidates/[id]/invite/route.ts
// POST -> (re)send the candidate portal invite email and return the invite link
// either way, so staff always have a copy-able fallback if delivery isn't
// configured (RESEND_API_KEY unset) or fails.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";
import { sendEmail } from "@/lib/emailService";
import { candidatePortalInviteEmail } from "@/lib/emailTemplates";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const candidate = await queryOne<{
    id: string; name: string; email: string | null; portal_token: string;
    portal_token_revoked_at: string | null; account_created_at: string | null;
  }>(
    "SELECT id, name, email, portal_token, portal_token_revoked_at, account_created_at FROM candidates WHERE id = $1",
    [params.id]
  );
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  if (candidate.account_created_at) {
    return NextResponse.json({ error: "This candidate already has an active portal account." }, { status: 409 });
  }

  // A previously revoked link is un-revoked on resend — inviting again is an
  // explicit staff action, so it should work even if the link was revoked earlier.
  if (candidate.portal_token_revoked_at) {
    await execute("UPDATE candidates SET portal_token_revoked_at = NULL WHERE id = $1", [candidate.id]);
  }

  const url = new URL(req.url);
  const link = `${url.origin}/portal/invite/${candidate.portal_token}`;

  let emailResult: { success: boolean; error?: string } = { success: false, error: "No email on file for this candidate." };
  if (candidate.email) {
    const { subject, html } = candidatePortalInviteEmail({ candidateName: candidate.name, inviteUrl: link });
    emailResult = await sendEmail({
      to: candidate.email,
      subject,
      body: html,
      candidateId: candidate.id,
      sentBy: context.profile.user_id,
    });
  }

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "portal_invite_sent",
    description: `Invited ${candidate.name} to the candidate portal${emailResult.success ? " (email delivered)" : " (link only — no email delivery)"}`,
    entityType: "candidate",
    entityId: candidate.id,
    entityName: candidate.name,
  });

  return NextResponse.json({ link, emailSent: emailResult.success, emailError: emailResult.success ? null : emailResult.error });
}
