import { afterEach, describe, expect, test } from "vitest";
import { candidateGoogleRedirectUri, configuredSharedGmailEmail, getCanonicalBaseUrl, gmailOAuthRedirectUri, gmailConfigurationReadiness, googleConfigurationReadiness } from "@/server/runtimeConfig";

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

  test("requires and normalizes the configured shared Gmail address", () => {
    process.env.GMAIL_SHARED_EMAIL = " Mail.Skarion@Gmail.com ";
    expect(configuredSharedGmailEmail()).toBe("mail.skarion@gmail.com");

    delete process.env.GMAIL_SHARED_EMAIL;
    expect(() => configuredSharedGmailEmail()).toThrow("GMAIL_SHARED_EMAIL is required");
  });

  test("reports the shared mailbox as part of Gmail readiness without exposing credentials", () => {
    process.env.TALENTOS_BASE_URL = "https://talent.skarion.com";
    process.env.GMAIL_SHARED_EMAIL = "mail.skarion@gmail.com";
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    const readiness = gmailConfigurationReadiness();
    expect(readiness.ready).toBe(true);
    expect(readiness.sharedMailboxEmail).toBe("mail.skarion@gmail.com");
    expect(JSON.stringify(readiness)).not.toContain("client-secret");
  });
});
