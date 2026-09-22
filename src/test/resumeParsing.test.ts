import { describe, expect, it, vi } from "vitest";

const firstProviderSend = vi.fn();
const secondProviderSend = vi.fn();

vi.mock("@/lib/ai/routing", () => ({
  callWithUsageTracking: vi.fn(async (_automationId: string, _context: unknown, fn: (provider: any) => Promise<unknown>) => {
    try {
      return { result: await fn({ send: firstProviderSend }) };
    } catch {
      return { result: await fn({ send: secondProviderSend }) };
    }
  }),
}));

describe("resume parsing provider fallback", () => {
  it("retries raw-text parsing after a provider quota failure", async () => {
    firstProviderSend.mockRejectedValueOnce(new Error("Google Vertex Proxy: rate limit or quota exceeded."));
    secondProviderSend.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: JSON.stringify({
          name: "Taylor Example",
          email: "taylor@example.com",
          skills: [{ category: "Engineering", items: ["AutoCAD"] }],
          experience: [],
          education: [],
          projects: [],
          certifications: [],
        }),
      }],
    });

    const { parseResumeFields } = await import("@/lib/resumeParsing");
    const parsed = await parseResumeFields("Taylor Example\nEngineering\nAutoCAD");

    expect(firstProviderSend).toHaveBeenCalledOnce();
    expect(secondProviderSend).toHaveBeenCalledOnce();
    expect(parsed.parse_error).toBeUndefined();
    expect(parsed.name).toBe("Taylor Example");
    expect(parsed.skills).toEqual(["Engineering: AutoCAD"]);
  });
});
