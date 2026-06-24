// src/lib/integrations/sharepoint.ts
// Optional alternative resume storage backend via Microsoft Graph / SharePoint, selected
// with RESUME_STORAGE_PROVIDER=sharepoint (default is R2 — see src/lib/resumeStorage.ts).
// App-only auth (client credentials flow), raw fetch — no Microsoft Graph SDK.

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

// Encode each path segment individually so '/' stays as a separator but special chars
// like '#', '?', spaces are properly escaped.
function encodeGraphPath(path: string): string {
  if (!path) return "";
  return path.split("/").map(encodeURIComponent).join("/");
}

// Ensure every folder in the chain exists. SharePoint PUT /content fails with 404
// if the parent folder does not already exist, so we create them first.
async function ensureFolderPath(token: string, siteId: string, folderPath: string): Promise<void> {
  const segments = folderPath.split("/").filter(Boolean);

  for (let i = 0; i < segments.length; i++) {
    const parentPath = segments.slice(0, i).join("/");
    const folderName = segments[i];

    const url = parentPath
      ? `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeGraphPath(parentPath)}:/children`
      : `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root/children`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });

    // 201 = created, 409 = already exists (conflict). Anything else is a real error.
    if (!res.ok && res.status !== 409) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `SharePoint folder creation failed (${res.status}) for '${folderName}' under '${parentPath || "root"}': ${text}`.trim()
      );
    }
  }
}

export async function uploadToSharePoint(path: string, buffer: Uint8Array, contentType: string): Promise<{ url: string }> {
  const token = await getGraphToken();
  const siteId = requireEnv("SHAREPOINT_SITE_ID");
  const folder = process.env.SHAREPOINT_DRIVE_FOLDER || "resumes";
  const graphPath = `${folder}/${path}`;

  // Ensure parent folders exist before uploading (SharePoint PUT /content does not auto-create parents)
  const lastSlash = graphPath.lastIndexOf("/");
  if (lastSlash > 0) {
    const parentPath = graphPath.substring(0, lastSlash);
    await ensureFolderPath(token, siteId, parentPath);
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeGraphPath(graphPath)}:/content`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType || "application/octet-stream" },
      // Wrapped in a Blob rather than passing the Uint8Array directly - fetch's
      // BodyInit type doesn't always structurally accept Uint8Array depending on
      // TS lib/target version (a type-level issue, not a runtime one). The extra
      // `new Uint8Array(buffer)` copy guarantees a plain ArrayBuffer-backed view
      // (not the generic ArrayBufferLike/SharedArrayBuffer-compatible type some
      // @types/node versions infer), which is what BlobPart actually requires.
      body: new Blob([new Uint8Array(buffer)]),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SharePoint upload failed (${res.status}) ${text}`.trim());
  }
  const item = await res.json();
  return { url: item.webUrl as string };
}

export async function deleteFromSharePoint(webUrl: string): Promise<void> {
  if (!process.env.MS_TENANT_ID || !process.env.MS_CLIENT_ID || !process.env.MS_CLIENT_SECRET || !process.env.SHAREPOINT_SITE_ID) {
    throw new Error("SharePoint credentials not configured");
  }

  const token = await getGraphToken();
  const encodedShareId = "u!" + base64urlEncodeString(webUrl);

  const itemRes = await fetch(`https://graph.microsoft.com/v1.0/shares/${encodedShareId}/driveItem`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!itemRes.ok) {
    if (itemRes.status === 404) {
      console.warn(`SharePoint delete: item already deleted or not found ${webUrl}`);
      return;
    }
    throw new Error(`SharePoint delete: failed to resolve item (${itemRes.status})`);
  }
  const item = await itemRes.json();

  const siteId = process.env.SHAREPOINT_SITE_ID;
  const deleteRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${item.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!deleteRes.ok && deleteRes.status !== 404) {
    throw new Error(`SharePoint delete failed (${deleteRes.status})`);
  }
}

/** Resolves a SharePoint webUrl to its drive item via Graph's shares API, then streams the file bytes. */
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
