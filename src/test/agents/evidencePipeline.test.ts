import { describe, expect, it, vi } from "vitest";
import { prepareEvidenceStage, sendEvidenceTask } from "@/lib/ai/application-agents/evidencePipeline";
import { renderEvidenceReleasePdf } from "@/lib/ai/application-agents/resumeReleasePdf";
import type { AgentContext } from "@/lib/ai/application-agents/types";
import { buildProviderFromDbKey } from "@/server/services/aiProvider";

function context(): AgentContext {
  return {
    applicationId: "application", candidateId: "candidate", evidence: [],
    verifiedSkills: ["Kubernetes"], sourceOfTruth: null, previousOutputs: {},
    job: { id: "job", title: "Infrastructure Engineer", company: "Example",
      location: null, rawDescription: null, employmentType: null, seniorityLevel: null, salaryRange: null,
      description: "About us\n" + "We work on many different projects. ".repeat(320) +
        "\nRequired qualifications\nYou must know Kubernetes deployment.",
    },
    baseResume: {
      id: "base", title: "Resume", skills: [], experience: [], education: [],
      content: {
        header: { fullName: "Example Person", email: "private@example.com" },
        skills: [{ name: "Platforms", skills: ["Linux"] }],
        experience: [{ title: "Analyst", company: "Prior employer", startDate: "2020", endDate: "2023",
          bullets: [{ text: "Reviewed deployment workflows before release." }] }],
      },
    },
  } as AgentContext;
}

describe("evidence resume pipeline", () => {
  it("finds evidence for a requirement after the former cutoff without sending the entire resume", async () => {
    const stage = await prepareEvidenceStage("application_resume_forge", context(), 6000);
    expect(stage.task?.body).toContain("You must know Kubernetes deployment.");
    expect(stage.task?.body).not.toContain("private@example.com");
    const task = stage.task!;
    const sentPayload = JSON.parse(task.body);
    const selected = sentPayload.proof.find((item: { text: string }) => item.text === "Kubernetes");
    const send = vi.fn(async () => ({ stopReason: "end_turn", content: [{ type: "text" as const, text: JSON.stringify({ prioritize: [selected.id] }) }] }));
    const result: any = await stage.finish(await sendEvidenceTask(task, { send }, { max_output_tokens: 300 }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.draft.skills).toContainEqual({ title: "Verified skills", skills: ["Kubernetes"] });
    expect(result.draft.experience[0].bullets).toEqual(["Reviewed deployment workflows before release."]);
    expect(result.draft.experience[0].endDate).toBe("2023");
    await expect(stage.finish({ prioritize: ["fabricated-evidence"] })).rejects.toThrow("unknown evidence");
  });

  it("skips paid polish and the extra editor when there is nothing to fix", async () => {
    const ctx = context();
    expect((await prepareEvidenceStage("application_final_polish", ctx, 6000)).task).toBeNull();
    expect((await prepareEvidenceStage("application_release_editor", ctx, 6000)).task).toBeNull();
  });

  it("reviews representative draft evidence even when Forge has no direct match", async () => {
    const ctx = context();
    ctx.job.description = "Required qualifications\nYou must have experience with supplier contracts.";
    ctx.previousOutputs.application_resume_forge = { data: { prioritizedIds: [] } } as any;
    expect((await prepareEvidenceStage("application_resume_forge", ctx, 4000)).task).toBeNull();

    const panel = await prepareEvidenceStage("application_hiring_panel", ctx, 4000);
    const payload = JSON.parse(panel.task!.body);
    expect(payload.selected).toEqual([]);
    expect(payload.requirements.every((item: { match: string[] }) => item.match.length === 0)).toBe(true);
    expect(payload.proof).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "skill", text: "Linux" }),
      expect.objectContaining({ scope: "bullet", text: "Reviewed deployment workflows before release." }),
    ]));
    expect(JSON.stringify(payload.proof).length).toBeLessThanOrEqual(4000 * 0.48);
    expect(panel.task!.body).not.toMatch(/Kubernetes|private@example\.com/);
    const bullet = payload.proof.find((item: { scope: string }) => item.scope === "bullet");
    expect(await panel.finish({
      atsScore: 4, roleFitScore: 5, recruiterScore: 6, risk: "unknown",
      issues: [{ evidenceId: bullet.id, detail: "Check transferable workflow review experience.", material: true }],
    })).toMatchObject({ atsScore: 4, roleFitScore: 5, evidenceIssues: [{ evidenceId: bullet.id }] });
  });

  it("accepts structured Haiku tool output from a Messages-compatible proxy", async () => {
    const stage = await prepareEvidenceStage("application_hiring_panel", context(), 6000);
    const review = { atsScore: 8, recruiterScore: 8, roleFitScore: 7, risk: "clear", issues: [] };
    const proxy = buildProviderFromDbKey("anthropic", "test-token", "claude-haiku-5-5",
      "https://proxy.example.test/v1", "/messages", null, null, null, "anthropic_hiring_panel_json")!;
    const fetchProxy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      stop_reason: "tool_use", content: [
        { type: "text", text: "# Assessment" },
        { type: "tool_use", name: "emit_result", id: "tool-1", input: review },
      ],
    }));
    try {
      const answer = await sendEvidenceTask(stage.task!, proxy, { max_output_tokens: 1000 });
      expect(await stage.finish(answer)).toMatchObject({ atsScore: 8, recruiterScore: 8, roleFitScore: 7 });
      expect(fetchProxy).toHaveBeenCalledTimes(1);
      const request = JSON.parse(String(fetchProxy.mock.calls[0][1]?.body));
      expect(request).toMatchObject({
        tool_choice: { type: "tool", name: "emit_result" },
        tools: [{ name: "emit_result", input_schema: stage.task!.schema, strict: true }],
      });
      expect(request.system).toContain("Call emit_result exactly once");
      expect(request).not.toHaveProperty("output_config");
    } finally {
      fetchProxy.mockRestore();
    }
  });

  it("normalizes serialized proxy replies and rejects invalid or ambiguous reviews", async () => {
    const panel = await prepareEvidenceStage("application_hiring_panel", context(), 4000);
    const proxy = buildProviderFromDbKey("anthropic", "test-token", "claude-haiku-5-5",
      "https://proxy.example.test/v1", "/messages", null, null, null, "anthropic_hiring_panel_json")!;
    const review = { atsScore: 7, recruiterScore: 6, roleFitScore: 7, risk: "unknown", issues: [] };
    const result = JSON.stringify(review);
    const tool = { type: "tool_use", name: "emit_result", id: "review", input: result };
    const textBlock = (text: string) => ({ type: "text", text });
    const fetchProxy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ stop_reason: "tool_use", content: [tool] }))
      .mockResolvedValueOnce(Response.json({ stop_reason: "end_turn", content: [textBlock("# Assessment\n\x60\x60\x60json\n" + result + "\n\x60\x60\x60")] }))
      .mockResolvedValueOnce(Response.json({ stop_reason: "end_turn", content: [textBlock(result + "\n" + result)] }))
      .mockResolvedValueOnce(Response.json({ stop_reason: "tool_use", content: [tool, { ...tool, id: "duplicate" }] }))
      .mockResolvedValueOnce(Response.json({ stop_reason: "max_tokens", content: [textBlock(result)] }))
      .mockResolvedValueOnce(Response.json({ stop_reason: "end_turn", content: [textBlock(JSON.stringify({ ...review, atsScore: "7" }))] }));
    const assess = async () => panel.finish(await sendEvidenceTask(panel.task!, proxy, {}));
    try {
      for (let i = 0; i < 2; i++) await expect(assess()).resolves.toMatchObject({ atsScore: 7, roleFitScore: 7 });
      await expect(assess()).rejects.toThrow("expected one JSON object");
      await expect(assess()).rejects.toThrow("duplicate Hiring Panel tool results");
      await expect(assess()).rejects.toThrow("max_tokens");
      await expect(assess()).rejects.toThrow("review scores must be between 0 and 10");
      expect(fetchProxy).toHaveBeenCalledTimes(6);
    } finally {
      fetchProxy.mockRestore();
    }
  });

  it("rejects a Markdown assessment as invalid output without including provider text in the error", async () => {
    const stage = await prepareEvidenceStage("application_hiring_panel", context(), 6000);
    const send = vi.fn(async () => ({
      stopReason: "end_turn", content: [{ type: "text" as const, text: "# Assessment\nResume review prose" }],
    }));
    await expect(sendEvidenceTask(stage.task!, { send }, {}))
      .rejects.toThrow(/^Invalid model output: expected one JSON object$/);
  });

  it("uses Qwen's OpenCode Messages adapter to produce a structured Forge draft", async () => {
    const forge = await prepareEvidenceStage("application_resume_forge", context(), 6000);
    const adapter = buildProviderFromDbKey("opencode", "test-token", "qwen3.7-plus",
      null, null, null, null, null, "opencode_go")!;
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      stop_reason: "tool_use", content: [{ type: "tool_use", name: "emit_result", id: "result",
        input: { prioritize: [] } }],
    }));
    try {
      const output = await sendEvidenceTask(forge.task!, adapter, { max_output_tokens: 850 });
      expect(await forge.finish(output)).toMatchObject({ draft: { prioritizedIds: [] } });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0][0]).toMatch(/\/messages$/);
      expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
        model: "qwen3.7-plus", max_tokens: 850, tool_choice: { type: "tool", name: "emit_result" },
      });
    } finally {
      request.mockRestore();
    }
  });

  it("keeps unverified issue references for human review and excludes them from automated edits", async () => {
    const ctx = context();
    const panel = await prepareEvidenceStage("application_hiring_panel", ctx, 6000);
    const result = await panel.finish({
      atsScore: 8, recruiterScore: 8, roleFitScore: 7, risk: "clear",
      issues: [
        { evidenceId: "unknown", detail: "Confirm the scope of the listed project.", material: false },
        { detail: "Check this finding." },
      ],
    });
    expect(result).toMatchObject({
      passFail: "review",
      evidenceIssues: [
        { evidenceId: "", detail: "Verify this review finding: Confirm the scope of the listed project.", material: true },
        { evidenceId: "", detail: "Verify this review finding: Check this finding.", material: true },
      ],
    });
    ctx.previousOutputs.application_hiring_panel = { data: result } as any;
    const polish = await prepareEvidenceStage("application_final_polish", ctx, 6000);
    expect(polish.task).toBeNull();
    expect(await polish.finish()).toMatchObject({ reviewerWarnings: [
      "Verify this review finding: Confirm the scope of the listed project.", "Verify this review finding: Check this finding.",
    ] });
  });

  it("produces identical PDF bytes and digest for the same saved content", async () => {
    const content = context().baseResume.content;
    const a = await renderEvidenceReleasePdf(content, 2);
    const b = await renderEvidenceReleasePdf(JSON.parse(JSON.stringify(content)), 2);
    expect(a.passed).toBe(true);
    expect(a.textOrderVerified).toBe(true);
    expect(a.pdfHash).toBe(b.pdfHash);
    expect(a.bytes).toEqual(b.bytes);
  });
});
