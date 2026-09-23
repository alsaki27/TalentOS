import { describe, expect, it, vi } from "vitest";
import { callVertexProxy } from "@/lib/ai/googleVertexProxyProvider";

const baseRequest = {
  proxyUrl: "https://proxy.example",
  proxySecret: "test-secret",
  model: "gemini-2.5-pro",
  system: "Return a result.",
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] }],
  tools: [],
};

describe("Google Vertex proxy response modes", () => {
  it("can disable JSON mode for the plain-text recovery request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ parts: [{ text: "KEYWORDS:\nGIS Technician\nRULES:\nPrefer entry-level roles." }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await callVertexProxy({ ...baseRequest, responseMimeType: null });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.responseMimeType).toBeNull();
    expect(body.responseSchema).toBeUndefined();
    fetchMock.mockRestore();
  });

  it("keeps structured JSON mode when a response schema is supplied", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ parts: [{ text: "{}" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const responseSchema = { type: "OBJECT", properties: { keywords: { type: "ARRAY" } } };
    await callVertexProxy({ ...baseRequest, responseSchema });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.responseMimeType).toBe("application/json");
    expect(body.responseSchema).toEqual(responseSchema);
    fetchMock.mockRestore();
  });
});
