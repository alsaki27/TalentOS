import { afterEach, describe, expect, test } from "vitest";
import { candidateGoogleRedirectUri, getCanonicalBaseUrl, gmailOAuthRedirectUri, googleConfigurationReadiness } from "@/server/runtimeConfig";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("production Google runtime configuration", () => {
  test("uses only the canonical TalentOS origin for candidate callback", () => {
    process.env.TALENTOS_BASE_URL = "https://talent.skarion.com";
    delete process.env.GMAIL_OAUTH_REDIRECT_URI;
    expect(getCanonicalBaseUrl()).toBe("https://talent.skarion.com");
    expect(candidateGoogleRedirectUri()).toBe("https://talent.skarion.com/api/portal/auth/google/callback");
    expect(gmailOAuthRedirectUri()).toBe("https://talent.skarion.com/api/integrations/gmail/callback");
  });
  test("fails readiness without credentials and never exposes secret values", () => {
    process.env.TALENTOS_BASE_URL = "https://talent.skarion.com";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const readiness = googleConfigurationReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.clientIdPresent).toBe(false);
    expect(JSON.stringify(readiness)).not.toContain("client_secret");
  });
  test("rejects a canonical base URL containing a path", () => {
    process.env.TALENTOS_BASE_URL = "https://talent.skarion.com/login";
    expect(() => getCanonicalBaseUrl()).toThrow("must not contain a path");
  });
});
