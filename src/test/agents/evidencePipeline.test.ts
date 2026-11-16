import { describe, expect, it, vi } from "vitest";
import { prepareEvidenceStage, sendEvidenceTask } from "@/lib/ai/application-agents/evidencePipeline";
import { renderEvidenceReleasePdf } from "@/lib/ai/application-agents/resumeReleasePdf";
import type { AgentContext } from "@/lib/ai/application-agents/types";

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
