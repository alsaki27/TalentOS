import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProviderFromDbKey, testAiKey } from "@/server/services/aiProvider";
import { openAiReasoningEfforts } from "@/lib/ai/openAiReasoning";
import { recordAiKeyFailure, recordAiKeySuccess } from "@/server/repositories/aiKeyRepository";

vi.mock("@/server/repositories/aiKeyRepository", () => ({
  getAiKeyWithDecryptedKey: vi.fn(async () => ({
    provider: "openai", decrypted_key: "test-token", model: "gpt-6-luna",
    base_url: "https://api.openai.com/v1", chat_endpoint: "/responses",
  })),
  recordAiKeyFailure: vi.fn(),
  recordAiKeySuccess: vi.fn(),
}));

describe("Luna key health test", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("uses one short Responses request and validates the model's reply", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
    }));
    expect(await testAiKey("key")).toMatchObject({ success: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      model: "gpt-6-luna", input: [{ role: "user", content: [{ type: "input_text", text: "Reply OK" }] }],
      max_output_tokens: 16, reasoning: { effort: "none" }, store: false, stream: false,
    });
    expect(recordAiKeySuccess).toHaveBeenCalledWith("key");
  });

  it("reports an empty response as a failed test", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "completed", output: [] }));
    expect(await testAiKey("key")).toMatchObject({ success: false });
    expect(recordAiKeyFailure).toHaveBeenCalledWith("key", expect.stringContaining("expected response"));
  });

  it.each(["gpt-6-luna", "gpt-5.6-luna", "gpt-6-sol", "gpt-5.4"])(
    "sends the selected High reasoning on the Responses route for %s",
    async model => {
      expect(openAiReasoningEfforts(model)).toContain("high");
      const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
        status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
      }));
      const provider = buildProviderFromDbKey("openai", "test-token", model, null, null, null, null, "high")!;
      await provider.send({ system: "Test", messages: [], tools: [], maxTokens: 4096 });
      expect(request.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
      expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
        model, reasoning: { effort: "high" }, max_output_tokens: 4096,
      });
    },
  );

  it("keeps traditional OpenAI routes on Chat Completions", async () => {
    expect(openAiReasoningEfforts("gpt-4o")).toEqual([]);
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
    }));
    const provider = buildProviderFromDbKey("openai", "test-token", "gpt-4o", null, null, null, null, "high")!;
    await provider.send({ system: "Test", messages: [], tools: [] });
    expect(request.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).not.toHaveProperty("reasoning");
  });
});
