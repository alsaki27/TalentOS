// src/lib/msGraphMail.ts
// Sends mail as a Microsoft 365 mailbox (e.g. talent@skarion.com) via the
// Microsoft Graph API, using an app-only (client credentials) OAuth grant —
// no interactive login, no stored user password. Requires an Azure AD app
// registration with the Mail.Send *application* permission, admin-consented,
// scoped down to just the sending mailbox via an ApplicationAccessPolicy
// (see docs/setup steps given to the user).
//
// Env vars required:
//   MS_GRAPH_TENANT_ID     - Azure AD tenant ID (GUID)
//   MS_GRAPH_CLIENT_ID     - App registration's Application (client) ID
//   MS_GRAPH_CLIENT_SECRET - App registration's client secret value
//   MS_GRAPH_SENDER_EMAIL  - The mailbox to send as, e.g. talent@skarion.com

export function isGraphMailConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID &&
    process.env.MS_GRAPH_CLIENT_ID &&
    process.env.MS_GRAPH_CLIENT_SECRET &&
    process.env.MS_GRAPH_SENDER_EMAIL
  );
}

async function getGraphAccessToken(): Promise<string> {
  const tenantId = process.env.MS_GRAPH_TENANT_ID!;
  const clientId = process.env.MS_GRAPH_CLIENT_ID!;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET!;

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Microsoft Graph token request failed: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token as string;
}

export interface GraphSendMailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendGraphMail(opts: GraphSendMailOptions): Promise<{ success: boolean; error?: string }> {
  try {
    const senderEmail = process.env.MS_GRAPH_SENDER_EMAIL!;
    const accessToken = await getGraphAccessToken();

    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: opts.subject,
          body: { contentType: "HTML", content: opts.html },
          toRecipients: [{ emailAddress: { address: opts.to } }],
        },
        saveToSentItems: true,
      }),
    });

    if (res.status === 202) return { success: true };

    const errBody = await res.text().catch(() => "");
    return { success: false, error: `Microsoft Graph sendMail error (${res.status}): ${errBody.slice(0, 300)}` };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Unknown Microsoft Graph error" };
  }
}
