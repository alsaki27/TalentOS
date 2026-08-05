// src/lib/emailTemplates.ts
// Transactional HTML email templates. Inline styles only (email clients strip
// <style> blocks / external CSS unpredictably) — this is the one place in the
// codebase where inline styles are the correct choice, not an anti-pattern.

function shell(preheader: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none;font-size:1px;color:#f4f5f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;max-width:480px;width:100%;">
            <tr>
              <td style="padding:28px 32px;background-color:#111827;">
                <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Skarion</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;line-height:18px;color:#9ca3af;">
                  You're receiving this because you're working with a Skarion recruiter. Questions? Just reply to this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="border-radius:8px;background-color:#4f46e5;">
        <a href="${href}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

export function candidatePortalInviteEmail(params: { candidateName: string; inviteUrl: string }) {
  const subject = "You're invited to your Skarion candidate portal";
  const html = shell(
    "Track your applications, interviews, and updates in one place.",
    `
    <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;color:#111827;">Hi ${params.candidateName},</h1>
    <p style="margin:0 0 12px;font-size:14px;line-height:22px;color:#374151;">
      We've set up a candidate portal so you can track everything about your job search in one place —
      application status, interview schedules, and updates from your recruiter, as they happen.
    </p>
    <p style="margin:0 0 4px;font-size:14px;line-height:22px;color:#374151;">
      Click below to set up your account with a password, or sign in with Google.
    </p>
    ${button(params.inviteUrl, "Set up your account")}
    <p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#9ca3af;">
      This link is unique to you — please don't forward it. If the button doesn't work, copy and paste this URL:<br>
      <a href="${params.inviteUrl}" style="color:#4f46e5;word-break:break-all;">${params.inviteUrl}</a>
    </p>
    `
  );
  return { subject, html };
}
