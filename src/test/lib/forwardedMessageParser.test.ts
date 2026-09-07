import { describe, it, expect } from "vitest";
import { parseForwardedHeaders, extractEmailAddress } from "@/lib/integrations/forwardedMessageParser";

describe("parseForwardedHeaders", () => {
  it("extracts From/Date/Subject/To from Gmail's standard forwarded block", () => {
    const body = [
      "Hi team, please see below.",
      "",
      "---------- Forwarded message ---------",
      "From: Jane Recruiter <jane@company.com>",
      "Date: Mon, Sep 1, 2026 at 10:00 AM",
      "Subject: Interview invitation",
      "To: Candidate Name <candidate@gmail.com>",
      "",
      "Hi Candidate, we'd like to schedule an interview...",
    ].join("\n");

    const result = parseForwardedHeaders(body);
    expect(result).not.toBeNull();
    expect(result?.from).toBe("Jane Recruiter <jane@company.com>");
    expect(result?.date).toBe("Mon, Sep 1, 2026 at 10:00 AM");
    expect(result?.subject).toBe("Interview invitation");
    expect(result?.to).toEqual(["Candidate Name <candidate@gmail.com>"]);
  });

  it("handles a Cc header and multiple comma-separated recipients", () => {
    const body = [
      "----- Forwarded message -----",
      "From: Jane Recruiter <jane@company.com>",
      "To: Candidate <candidate@gmail.com>, Other Person <other@gmail.com>",
      "Cc: Hiring Manager <hm@company.com>",
      "Subject: Re: Application",
      "",
      "Body text here.",
    ].join("\n");

    const result = parseForwardedHeaders(body);
    expect(result?.to).toEqual(["Candidate <candidate@gmail.com>", "Other Person <other@gmail.com>"]);
    expect(result?.cc).toEqual(["Hiring Manager <hm@company.com>"]);
  });

  it("returns null for a plain, non-forwarded message", () => {
    const body = "Hi, thanks for applying. We'll be in touch soon.";
    expect(parseForwardedHeaders(body)).toBeNull();
  });

  it("returns null for empty/null bodies", () => {
    expect(parseForwardedHeaders(null)).toBeNull();
    expect(parseForwardedHeaders(undefined)).toBeNull();
    expect(parseForwardedHeaders("")).toBeNull();
  });

  it("does not confuse a message that merely mentions 'forwarded' in prose with an actual forward block", () => {
    const body = "I have forwarded message to my manager, please advise.";
    expect(parseForwardedHeaders(body)).toBeNull();
  });
});

describe("extractEmailAddress", () => {
  it("extracts the address out of a 'Name <email>' header value", () => {
    expect(extractEmailAddress("Jane Recruiter <Jane@Company.com>")).toBe("jane@company.com");
  });

  it("accepts a bare email address", () => {
    expect(extractEmailAddress("candidate@gmail.com")).toBe("candidate@gmail.com");
  });

  it("returns null for non-address-shaped input", () => {
    expect(extractEmailAddress("not an email")).toBeNull();
    expect(extractEmailAddress(null)).toBeNull();
    expect(extractEmailAddress("")).toBeNull();
  });
});
