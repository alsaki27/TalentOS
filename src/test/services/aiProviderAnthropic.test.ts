import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProviderFromDbKey } from "@/server/services/aiProvider";

describe("database-managed Anthropic provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes the Messages API payload, tools, usage, and abort signal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        content: [{ type: "text", text: "OK" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 3 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const provider = buildProviderFromDbKey(
      "anthropic",
      "test-key",
      "claude-sonnet-5",
      "https://claude.example/v1",
      "/messages",
    );

    const result = await provider!.send({
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "Reply OK" }] }],
      tools: [{
        name: "lookup",
        description: "Look something up",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
      }],
      maxTokens: 32,
      timeoutMs: 500,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://claude.example/v1/messages",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.model).toBe("claude-sonnet-5");
    expect(request.max_tokens).toBe(32);
    expect(request.tools[0]).toEqual({
      name: "lookup",
      description: "Look something up",
      input_schema: { type: "object", properties: { id: { type: "string" } } },
    });
    expect(result.content).toEqual([{ type: "text", text: "OK" }]);
    expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 3 });
  });

  it("aborts a stalled request and exposes a classified timeout error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Expected an abort signal");
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("This operation was aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    });
    const provider = buildProviderFromDbKey("anthropic", "test-key", "claude-sonnet-5");

    await expect(provider!.send({
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "Reply OK" }] }],
      tools: [],
      timeoutMs: 10,
    })).rejects.toThrow("Anthropic request timed out after 10ms");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
