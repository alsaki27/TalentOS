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

  it("accepts structured Haiku tool output from a Messages-compatible proxy", async () => {
    const stage = await prepareEvidenceStage("application_hiring_panel", context(), 6000);
    const review = { atsScore: 8, recruiterScore: 8, roleFitScore: 7, risk: "clear", issues: [] };
    const proxy = buildProviderFromDbKey("anthropic", "test-token", "claude-haiku-5-5",
      "https://proxy.example.test/v1", "/messages", null, null, null, "anthropic_tool_json")!;
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
        tools: [{ name: "emit_result", input_schema: stage.task!.schema }],
      });
      expect(request).not.toHaveProperty("output_config");
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
