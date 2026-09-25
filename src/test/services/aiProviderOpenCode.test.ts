import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProviderFromDbKey } from "@/server/services/aiProvider";

function okResponse() {
  return new Response(JSON.stringify({
    choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const request = {
  system: "system",
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Reply OK" }] }],
  tools: [],
};

describe("database-managed OpenCode provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("always sends the configured session header on chat completions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const provider = buildProviderFromDbKey(
      "opencode",
      "test-key",
      "deepseek-v4-flash",
      null,
      null,
      null,
      { opencode_session_id: "talentos-test-session" },
    );

    await provider!.send(request);

    const init = fetchMock.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get("x-opencode-session")).toBe("talentos-test-session");
    expect(headers.get("user-agent")).toBe("TalentOS-AI-Router/1.0");
  });

  it("uses a stable fallback session when legacy rows lack provider config", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const provider = buildProviderFromDbKey("opencode", "test-key", "deepseek-v4-flash");

    await provider!.send(request);

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("x-opencode-session")).toBe("talentos-opencode-default");
  });

  it("sends the same session header on the OpenCode Responses path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = buildProviderFromDbKey(
      "opencode",
      "test-key",
      "gpt-5.6-luna",
      null,
      null,
      null,
      { opencode_session_id: "talentos-responses-session" },
    );

    await provider!.send(request);

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("x-opencode-session")).toBe("talentos-responses-session");
  });

  it("uses OpenCode Go's Anthropic Messages endpoint for Qwen 3.7 Plus", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        content: [{ type: "text", text: "{\"summary\":\"Evidence-based summary\"}" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 120, output_tokens: 18 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const provider = buildProviderFromDbKey(
      "opencode",
      "test-key",
      "qwen3.7-plus",
      "https://opencode.ai/zen/go/v1",
      "/chat/completions",
      { "X-Trace-Id": "trace-123" },
      { opencode_session_id: "talentos-resume-forge-test" },
    );

    const result = await provider!.send({
      system: "Return resume JSON only.",
      messages: [{ role: "user", content: [{ type: "text", text: "Tailor this resume." }] }],
      tools: [{
        name: "evidence_lookup",
        description: "Look up verified candidate facts",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      }],
      temperature: 0.2,
      maxTokens: 256,
      timeoutMs: 500,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/messages",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
          "x-opencode-session": "talentos-resume-forge-test",
          "User-Agent": "TalentOS-AI-Router/1.0",
          "X-Trace-Id": "trace-123",
        }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("qwen3.7-plus");
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0.2);
    expect(body.messages[0].content).toEqual([{ type: "text", text: "Tailor this resume." }]);
    expect(body.tools[0]).toEqual({
      name: "evidence_lookup",
      description: "Look up verified candidate facts",
      input_schema: { type: "object", properties: { query: { type: "string" } } },
    });
    expect(result.content).toEqual([{ type: "text", text: "{\"summary\":\"Evidence-based summary\"}" }]);
    expect(result.usage).toEqual({ input_tokens: 120, output_tokens: 18 });
  });

  it("uses OpenCode Go's chat-completions endpoint for GLM 5.3", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const provider = buildProviderFromDbKey(
      "opencode",
      "test-key",
      "glm-5.3",
      null,
      null,
      null,
      { opencode_session_id: "talentos-glm53-test" },
    );

    await provider!.send(request);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(headers.get("x-opencode-session")).toBe("talentos-glm53-test");
    expect(headers.get("user-agent")).toBe("TalentOS-AI-Router/1.0");
    expect(JSON.parse(String(init?.body)).model).toBe("glm-5.3");
  });
});
