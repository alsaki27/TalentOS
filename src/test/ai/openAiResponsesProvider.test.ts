import { describe, expect, it, vi, afterEach } from "vitest";
import { createOpenAiResponsesProvider, fromResponsesOutput } from "@/lib/ai/openAiResponsesProvider";

describe("OpenAI Responses provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends Luna requests to Responses and omits Chat Completions temperature", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "OK" }],
        }],
        usage: { input_tokens: 4, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const provider = createOpenAiResponsesProvider({
      apiUrl: "https://opencode.ai/zen/go/v1/responses",
      apiKey: "test-key",
      model: "gpt-5.6-luna",
      errorLabel: "OpenCode API",
    });
    const result = await provider.send({
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "Reply OK" }] }],
      tools: [],
      temperature: 0.3,
      maxTokens: 16,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/responses",
      expect.objectContaining({ method: "POST" }),
    );
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.model).toBe("gpt-5.6-luna");
    expect(request.input).toEqual([
      { role: "system", content: [{ type: "input_text", text: "system" }] },
      { role: "user", content: [{ type: "input_text", text: "Reply OK" }] },
    ]);
    expect(request.temperature).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "OK" }]);
    expect(result.usage).toEqual({ input_tokens: 4, output_tokens: 1 });
  });

  it("converts Responses function calls and function outputs", () => {
    const result = fromResponsesOutput({
      status: "completed",
      output: [
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: '{"id":"123"}' },
      ],
    });

    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "call_1", name: "lookup", input: { id: "123" } },
    ]);
  });
});
