// src/lib/integrations/sharepoint.ts
// Optional alternative resume storage backend via Microsoft Graph / SharePoint, selected
// with RESUME_STORAGE_PROVIDER=sharepoint (default stays Supabase Storage — see
// src/lib/resumeStorage.ts). Brought over from comparing against the team's skarion-api
// repo, which stores resumes in SharePoint for teams already standardized on
// Microsoft 365 — that's an infrastructure preference, not a feature this app lacked
// (Supabase Storage + resume variants is already a more complete equivalent), but it's
// useful as a real option for a team that wants files living in their own tenant.
// App-only auth (client credentials flow), raw fetch — no Microsoft Graph SDK, same
// "no SDK dependency" convention as every other external integration in this app.

let cachedToken: { token: string; expiresAt: number } | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for SharePoint resume storage.`);
  return value;
}

async function getGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const tenantId = requireEnv("MS_TENANT_ID");
  const clientId = requireEnv("MS_CLIENT_ID");
  const clientSecret = requireEnv("MS_CLIENT_SECRET");

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
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Microsoft Graph token request failed (${res.status}) ${text}`.trim());
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

function base64urlEncodeString(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return btoa(String.fromCharCode(...bytes))
    .replace(/=+$/, "")
    .replace(/\//g, "_")
    .replace(/\+/g, "-");
}

export async function uploadToSharePoint(path: string, buffer: Uint8Array, contentType: string): Promise<{ url: string }> {
  const token = await getGraphToken();
  const siteId = requireEnv("SHAREPOINT_SITE_ID");
  const folder = process.env.SHAREPOINT_DRIVE_FOLDER || "resumes";
  const graphPath = `${folder}/${path}`;

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURI(graphPath)}:/content`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType || "application/octet-stream" },
      body: buffer as any,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SharePoint upload failed (${res.status}) ${text}`.trim());
  }
  const item = await res.json();
  return { url: item.webUrl as string };
}

/** Resolves a SharePoint webUrl to its drive item via Graph's shares API, then streams the file bytes — lets the browser download without ever needing Microsoft auth itself. */
export async function downloadFromSharePoint(webUrl: string): Promise<{ buffer: Uint8Array; contentType: string; fileName: string }> {
  const token = await getGraphToken();
  const encodedShareId = "u!" + base64urlEncodeString(webUrl);

  const itemRes = await fetch(`https://graph.microsoft.com/v1.0/shares/${encodedShareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!itemRes.ok) throw new Error(`Failed to resolve SharePoint item (${itemRes.status})`);
  const item = await itemRes.json();

  const downloadUrl = item["@microsoft.graph.downloadUrl"] as string | undefined;
  if (!downloadUrl) throw new Error("SharePoint item has no download URL.");

  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) throw new Error(`SharePoint download failed (${fileRes.status})`);

  return {
    buffer: new Uint8Array(await fileRes.arrayBuffer()),
    contentType: fileRes.headers.get("content-type") || "application/octet-stream",
    fileName: item.name || "resume",
  };
}
