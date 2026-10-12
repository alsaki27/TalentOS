import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOpenAiResponseFormat, createOpenAiCompatibleProvider } from "@/lib/ai/openAiCompatibleProvider";

describe("buildOpenAiResponseFormat", () => {
  it("builds a strict json_schema response_format when responseSchema is passed", () => {
    const schema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"] };
    expect(buildOpenAiResponseFormat(schema, undefined)).toEqual({
      type: "json_schema",
      json_schema: { name: "talentos_output", schema, strict: true },
    });
  });

  it("builds a json_object response_format when only responseMimeType is application/json", () => {
    expect(buildOpenAiResponseFormat(undefined, "application/json")).toEqual({ type: "json_object" });
  });

  it("returns undefined when neither is passed, preserving today's behavior for every non-resume-pipeline caller", () => {
    expect(buildOpenAiResponseFormat(undefined, undefined)).toBeUndefined();
    expect(buildOpenAiResponseFormat(undefined, null)).toBeUndefined();
  });

  it("prefers responseSchema over responseMimeType when both are passed", () => {
    const schema = { type: "object" };
    expect(buildOpenAiResponseFormat(schema, "application/json")).toEqual({
      type: "json_schema",
      json_schema: { name: "talentos_output", schema, strict: true },
    });
  });
});

describe("createOpenAiCompatibleProvider request body", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockChatCompletionResponse() {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }

  it("includes response_format in the request body when responseSchema is passed", async () => {
    const fetchMock = mockChatCompletionResponse();
    const provider = createOpenAiCompatibleProvider({
      apiUrl: "https://opencode.example/v1/chat/completions",
      apiKey: "test-key",
      model: "glm-5.3-flash",
      errorLabel: "OpenCode API",
    });
    const schema = { type: "object", properties: { foo: { type: "string" } }, required: ["foo"] };

    await provider.send({
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      responseSchema: schema,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "talentos_output", schema, strict: true },
    });
  });

  it("omits response_format entirely when neither responseSchema nor responseMimeType is passed", async () => {
    const fetchMock = mockChatCompletionResponse();
    const provider = createOpenAiCompatibleProvider({
      apiUrl: "https://opencode.example/v1/chat/completions",
      apiKey: "test-key",
      model: "glm-5.3-flash",
      errorLabel: "OpenCode API",
    });

    await provider.send({
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty("response_format");
  });

  it("includes a json_object response_format when only responseMimeType is passed", async () => {
    const fetchMock = mockChatCompletionResponse();
    const provider = createOpenAiCompatibleProvider({
      apiUrl: "https://opencode.example/v1/chat/completions",
      apiKey: "test-key",
      model: "glm-5.3-flash",
      errorLabel: "OpenCode API",
    });

    await provider.send({
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      responseMimeType: "application/json",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});
