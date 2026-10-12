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

  it("forces structured output via a synthetic tool call when responseSchema is passed, and unwraps the result back into a plain text block", async () => {
    const responseSchema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        content: [{ type: "tool_use", id: "tool_1", name: "emit_result", input: { foo: "bar" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const provider = buildProviderFromDbKey("anthropic", "test-key", "claude-sonnet-5");

    const result = await provider!.send({
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "Reply with JSON" }] }],
      tools: [],
      responseSchema,
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.tools).toEqual([
      expect.objectContaining({ name: "emit_result", input_schema: responseSchema }),
    ]);
    expect(request.tool_choice).toEqual({ type: "tool", name: "emit_result" });
    // The caller never sees a tool_use block - textOf(response.content) keeps working unchanged.
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ foo: "bar" }) }]);
  });

  it("does not force tool_choice or add the synthetic tool when no responseSchema is passed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        content: [{ type: "text", text: "plain answer" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 4, output_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const provider = buildProviderFromDbKey("anthropic", "test-key", "claude-sonnet-5");

    const result = await provider!.send({
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.tools).toEqual([]);
    expect(request).not.toHaveProperty("tool_choice");
    expect(result.content).toEqual([{ type: "text", text: "plain answer" }]);
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
