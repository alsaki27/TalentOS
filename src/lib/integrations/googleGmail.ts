// src/lib/integrations/googleGmail.ts
// Gmail OAuth helpers. Uses Web Crypto API for Cloudflare Workers compatibility.
import { gmailOAuthRedirectUri } from "@/server/runtimeConfig";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
];

// Never derive this from the incoming request's origin — confirmed unreliable
// inside this Worker runtime (a sibling route's req.url resolved to "http://n"
// in production). GMAIL_OAUTH_REDIRECT_URI is intentionally separate from
// the Google identity login configuration so mailbox consent can rotate
// without changing staff/candidate Google sign-in.
export function googleRedirectUri() {
  return gmailOAuthRedirectUri();
}

export function newOAuthState(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function gmailAuthUrl(params: { state: string }) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) throw new Error("GMAIL_CLIENT_ID is required for Gmail mailbox access.");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeGmailCode(code: string) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required for Gmail mailbox access.");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Google token exchange failed.");
  }
  return data as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  };
}

export async function getGrantedGmailScopes(accessToken: string, returnedScope?: string): Promise<string[]> {
  let scopeText = returnedScope?.trim() || "";
  if (!scopeText) {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.scope !== "string") {
      throw new Error("Could not verify the Gmail scopes granted by Google.");
    }
    scopeText = data.scope;
  }
  const scopes = Array.from(new Set(scopeText.split(/\s+/).filter(Boolean)));
  if (!scopes.includes("https://www.googleapis.com/auth/gmail.modify")) {
    throw new Error("Google did not grant the required gmail.modify permission. Reconnect and approve Gmail access.");
  }
  return scopes;
}

function base64urlDecode(str: string): string {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/") + padding;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeJwtPayload(token: string | undefined) {
  if (!token) return null;
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    return JSON.parse(base64urlDecode(payload));
  } catch {
    return null;
  }
}

export async function getGoogleEmail(accessToken: string, idToken?: string) {
  const payload = decodeJwtPayload(idToken);
  if (payload?.email) return String(payload.email);

  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email ? String(data.email) : null;
}
