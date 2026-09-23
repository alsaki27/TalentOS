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
});
