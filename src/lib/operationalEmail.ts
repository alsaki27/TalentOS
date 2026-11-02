import { isGraphMailConfigured, sendGraphMail } from "@/lib/msGraphMail";

export async function sendOperationalEmail(to: string, subject: string, html: string) {
  if (isGraphMailConfigured()) return sendGraphMail({ to, subject, html });
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { success: false, error: "No configured email sender is available." };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return response.ok ? { success: true } : { success: false, error: `Email provider rejected the send (${response.status}).` };
  } catch {
    return { success: false, error: "Could not reach the configured email provider." };
  }
}
