import { expect, it } from "vitest";
import { candidateHasPortalAccount } from "@/lib/candidateHasPortalAccount";

it("recognizes registered candidates even when the creation date is missing", () => {
  for (const account of [
    { account_created_at: "2026-11-26" }, { last_login_at: "2026-11-26" },
    { google_sub: "google-id" }, { account_email: "candidate@example.com", password_hash: "hash" },
  ]) expect(candidateHasPortalAccount(account)).toBe(true);
});

it("allows invitations for candidates without a portal login", () => {
  expect(candidateHasPortalAccount({})).toBe(false);
  expect(candidateHasPortalAccount({ account_email: "candidate@example.com" })).toBe(false);
});
