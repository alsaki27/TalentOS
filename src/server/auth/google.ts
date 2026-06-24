import { sanitizeInternalPath } from "@/lib/auth";

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID ?? "";
}

function getGoogleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET ?? "";
}

export function getGoogleOAuthRedirectUri(origin: string) {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || `${origin}/api/auth/google/callback`;
}

export function getGoogleAuthUrl(origin: string, state: string, nextPath?: string | null) {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured.");
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getGoogleOAuthRedirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "select_account");

  const safeNextPath = sanitizeInternalPath(nextPath);
  if (safeNextPath) {
    url.searchParams.set("hd", "");
  }

  return url.toString();
}

export async function exchangeGoogleCodeForUser(origin: string, code: string) {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: getGoogleOAuthRedirectUri(origin),
    }),
    cache: "no-store",
  });

  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Google token exchange failed.");
  }

  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${String(tokenData.access_token)}`,
    },
    cache: "no-store",
  });

  const userInfo = (await userInfoResponse.json().catch(() => ({}))) as Partial<GoogleUserInfo>;
  if (!userInfoResponse.ok || !userInfo.email || !userInfo.sub) {
    throw new Error("Could not load the Google account profile.");
  }

  return {
    sub: userInfo.sub,
    email: userInfo.email.toLowerCase(),
    email_verified: Boolean(userInfo.email_verified),
    name: userInfo.name || userInfo.given_name || userInfo.email.split("@")[0],
    picture: userInfo.picture,
  };
}
