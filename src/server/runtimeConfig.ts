const LOCAL_BASE_URL = "http://localhost:3000";

export class RuntimeConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
    this.code = code;
  }
}

function normalizedOrigin(value: string, variableName: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RuntimeConfigurationError(`INVALID_${variableName}`, `${variableName} must be an absolute HTTP(S) URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new RuntimeConfigurationError(`INVALID_${variableName}`, `${variableName} must be a safe HTTP(S) origin.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new RuntimeConfigurationError(`INVALID_${variableName}`, `${variableName} must not contain a path, query, or fragment.`);
  }
  return url.origin;
}

function absoluteRedirectUri(value: string, variableName: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RuntimeConfigurationError(`INVALID_${variableName}`, `${variableName} must be an absolute HTTP(S) URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new RuntimeConfigurationError(`INVALID_${variableName}`, `${variableName} must be a safe absolute HTTP(S) URL.`);
  }
  return url.toString();
}

export function getCanonicalBaseUrl(): string {
  const configured = process.env.TALENTOS_BASE_URL || process.env.APP_BASE_URL;
  if (configured) return normalizedOrigin(configured, "TALENTOS_BASE_URL");
  if (process.env.NODE_ENV !== "production") return LOCAL_BASE_URL;
  throw new RuntimeConfigurationError("MISSING_TALENTOS_BASE_URL", "TALENTOS_BASE_URL is required in production.");
}

export function canonicalUrl(pathname: string): URL {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new RuntimeConfigurationError("INVALID_CANONICAL_PATH", "Canonical paths must be root-relative.");
  }
  return new URL(pathname, getCanonicalBaseUrl());
}

export function envFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name];
  if (value == null || value.trim() === "") return defaultValue;
  return ["1", "true", "yes", "on", "enabled"].includes(value.trim().toLowerCase());
}

export function googleIdentityRedirectUri(): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI
    ? absoluteRedirectUri(process.env.GOOGLE_OAUTH_REDIRECT_URI, "GOOGLE_OAUTH_REDIRECT_URI")
    : canonicalUrl("/api/auth/google/callback").toString();
}

export function candidateGoogleRedirectUri(): string {
  return canonicalUrl("/api/portal/auth/google/callback").toString();
}

export function gmailOAuthRedirectUri(): string {
  return process.env.GMAIL_OAUTH_REDIRECT_URI
    ? absoluteRedirectUri(process.env.GMAIL_OAUTH_REDIRECT_URI, "GMAIL_OAUTH_REDIRECT_URI")
    : canonicalUrl("/api/integrations/gmail/callback").toString();
}

export function googleConfigurationReadiness() {
  const clientIdPresent = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const clientSecretPresent = Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());
  let baseUrl: string | null = null;
  let staffCallback: string | null = null;
  let candidateCallback: string | null = null;
  let gmailCallback: string | null = null;
  let configurationError: string | null = null;
  try {
    baseUrl = getCanonicalBaseUrl();
    staffCallback = googleIdentityRedirectUri();
    candidateCallback = candidateGoogleRedirectUri();
    gmailCallback = gmailOAuthRedirectUri();
  } catch (error) {
    configurationError = error instanceof RuntimeConfigurationError ? error.code : "INVALID_GOOGLE_CONFIGURATION";
  }
  return {
    ready: clientIdPresent && clientSecretPresent && !configurationError,
    clientIdPresent,
    clientSecretPresent,
    baseUrl,
    callbacks: { staff: staffCallback, candidate: candidateCallback, gmail: gmailCallback },
    features: {
      candidateGoogleAuth: envFlag("CANDIDATE_GOOGLE_AUTH_ENABLED"),
      candidateMfa: envFlag("CANDIDATE_MFA_ENABLED"),
      candidateGmail: envFlag("CANDIDATE_GMAIL_ENABLED"),
    },
    configurationError,
  };
}

export function gmailConfigurationReadiness() {
  const clientIdPresent = Boolean(process.env.GMAIL_CLIENT_ID?.trim());
  const clientSecretPresent = Boolean(process.env.GMAIL_CLIENT_SECRET?.trim());
  let baseUrl: string | null = null;
  let gmailCallback: string | null = null;
  let configurationError: string | null = null;
  try {
    baseUrl = getCanonicalBaseUrl();
    gmailCallback = gmailOAuthRedirectUri();
  } catch (error) {
    configurationError = error instanceof RuntimeConfigurationError ? error.code : "INVALID_GMAIL_CONFIGURATION";
  }
  return {
    ready: clientIdPresent && clientSecretPresent && !configurationError,
    clientIdPresent,
    clientSecretPresent,
    baseUrl,
    callbacks: { gmail: gmailCallback },
    configurationError,
  };
}
