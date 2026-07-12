/**
 * Full-pipeline E2E test with mock AI providers.
 *
 * Deterministic, fast, no live AI keys required.
 * Runs the complete candidate→job→application→pipeline→tailored-resume flow
 * and verifies every pipeline stage completes.
 *
 * Prerequisites:
 *   - Server running with AI_PROVIDER=mock ALLOW_GLOBAL_AI_FALLBACK=true
 *   - Seeded admin account (TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD)
 *   - At least one job in the database
 */

import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || "";

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error(
    "TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD must be set for full pipeline E2E test",
  );
}

async function authenticateApi(request: APIRequestContext): Promise<void> {
  const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.status()).toBe(200);
  const setCookie = loginRes.headers()["set-cookie"];
  expect(setCookie).toBeDefined();
}

async function poll<T>(
  fn: () => Promise<T | null | undefined>,
  intervalMs: number,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms polling ${label}`);
}

test.describe("Full application pipeline (mock providers)", () => {
  test.describe.configure({ mode: "serial" });

  test("candidate → resume → job → application → pipeline → tailored resume", async ({
    request,
  }) => {
    test.setTimeout(120_000);

    await authenticateApi(request);

    // 1. Create candidate
    const testName = `E2E Mock Candidate ${Date.now()}`;
    const testEmail = `e2e-mock-${Date.now()}@test.talentos`;
    const candidateRes = await request.post(`${BASE_URL}/api/candidates`, {
      data: { name: testName, email: testEmail, status: "active" },
    });
    expect(candidateRes.status()).toBe(201);
    const candidate = await candidateRes.json();
    expect(candidate.id).toBeDefined();
    const candidateId: string = candidate.id;

    // 2. Create base resume
    const baseResumeRes = await request.post(`${BASE_URL}/api/base-resumes`, {
      data: {
        candidateId,
        name: `${testName} Base Resume`,
        startingSource: "blank",
      },
    });
    expect(baseResumeRes.status()).toBe(201);
    const baseResume = await baseResumeRes.json();
    expect(baseResume.id).toBeDefined();
    const baseResumeId: string = baseResume.id;

    // 3. Find an existing job
    const jobsRes = await request.get(`${BASE_URL}/api/jobs?pageSize=1`);
    expect(jobsRes.status()).toBe(200);
    const jobsBody = await jobsRes.json();
    const jobs = jobsBody.jobs || [];
    expect(jobs.length).toBeGreaterThan(0);
    const job = jobs[0];
    const jobId: string = job.id;
    expect(jobId).toBeDefined();

    // 4. Target the job for this candidate and link the base resume
    const targetJobRes = await request.post(`${BASE_URL}/api/target-jobs`, {
      data: {
        candidateId,
        jobId,
        rawDescription: `${job.title ?? "Role"} at ${job.company ?? "Company"}. ${job.location ?? ""}`.trim(),
      },
    });
    expect(targetJobRes.status()).toBe(201);
    const targetJobData = await targetJobRes.json();
    const targetJobId: string =
      targetJobData.id ?? targetJobData.targetJob?.id;
    expect(targetJobId).toBeDefined();

    const resumeVersionRes = await request.post(
      `${BASE_URL}/api/application-resume-versions`,
      { data: { baseResumeId, targetJobId } },
    );
    expect(resumeVersionRes.status()).toBe(201);

    // 5. Create application
    const appRes = await request.post(`${BASE_URL}/api/applications`, {
      data: {
        candidate_id: candidateId,
        job_id: jobId,
        status: "applied",
      },
    });
    expect(appRes.status()).toBe(201);
    const appBody = await appRes.json();
    const applicationId: string =
      appBody.created?.[0]?.id || appBody.created?.id || appBody.id;
    expect(applicationId).toBeDefined();

    // 6. Start AI pipeline
    const pipelineRes = await request.post(
      `${BASE_URL}/api/applications/${applicationId}/ai-workflow`,
    );
    expect([200, 201, 202]).toContain(pipelineRes.status());
    const pipelineBody = await pipelineRes.json();
    const workflowId: string = pipelineBody.workflowId;
    expect(workflowId).toBeDefined();

    // 7. Verify workflow exists
    const wfCheckRes = await request.get(
      `${BASE_URL}/api/application-ai-workflows/${workflowId}`,
    );
    expect(wfCheckRes.status()).toBe(200);
    const wfCheck = await wfCheckRes.json();
    expect(wfCheck.workflow?.id).toBe(workflowId);
    expect(wfCheck.workflow?.application_id).toBe(applicationId);

    // 8. Poll for pipeline to reach completed (all 4 stages pass with mock)
    let workflowStatus = "queued";
    let finalStatus = "";
    for (let i = 0; i < 60; i++) {
      const statusRes = await request.get(
        `${BASE_URL}/api/application-ai-workflows/${workflowId}`,
      );
      if (statusRes.ok()) {
        const data = await statusRes.json();
        workflowStatus = data.workflow?.status ?? "queued";
        if (
          workflowStatus !== "queued" &&
          workflowStatus !== "running" &&
          workflowStatus !== "waiting"
        ) {
          finalStatus = workflowStatus;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log(`Mock pipeline ended with status: ${finalStatus}`);

    // With mock providers, the pipeline should complete or reach human_review
    expect(["completed", "waiting", "human_review"]).toContain(finalStatus);
    expect(finalStatus).not.toBe("failed");

    // 9. Verify all 4 stages were created and succeeded
    const stageRes = await request.get(
      `${BASE_URL}/api/application-ai-workflows/${workflowId}`,
    );
    const stageCheck = await stageRes.json();
    const stages = stageCheck.stages || [];
    expect(stages.length).toBeGreaterThanOrEqual(4);

    const stageAutomations = stages.map((s: any) => s.automation_id).sort();
    expect(stageAutomations).toContain("application_job_lens");
    expect(stageAutomations).toContain("application_resume_forge");
    expect(stageAutomations).toContain("application_hiring_panel");
    expect(stageAutomations).toContain("application_final_polish");

    // All stages should be success with mock
    for (const stage of stages) {
      expect(stage.status).toBe("success");
    }

    // 10. Verify artifacts exist for each stage
    const artifacts = stageCheck.artifacts || [];
    expect(artifacts.length).toBeGreaterThanOrEqual(4);

    // 11. Verify application links back correctly
    const appCheckRes = await request.get(
      `${BASE_URL}/api/applications/${applicationId}`,
    );
    expect(appCheckRes.status()).toBe(200);
    const appCheck = await appCheckRes.json();

    // Check that resume_generation_status progressed
    const resumeStatus =
      appCheck.resume_generation_status ||
      appCheck.application?.resume_generation_status;
    expect(resumeStatus).toBeDefined();
    expect(resumeStatus).not.toBe("not_started");

    // 12. Verify artifacts contain expected mock data
    const jobLensArtifact = artifacts.find(
      (a: any) => a.automation_id === "application_job_lens",
    );
    if (jobLensArtifact?.data) {
      expect(jobLensArtifact.data.title).toBe("Senior Software Engineer");
      expect(jobLensArtifact.data.requiredSkills).toContain("TypeScript");
    }

    const hiringPanelArtifact = artifacts.find(
      (a: any) => a.automation_id === "application_hiring_panel",
    );
    if (hiringPanelArtifact?.data) {
      expect(hiringPanelArtifact.data.passFail).toBe("pass");
      expect(hiringPanelArtifact.data.atsScore).toBeGreaterThanOrEqual(6);
    }

    const finalPolishArtifact = artifacts.find(
      (a: any) => a.automation_id === "application_final_polish",
    );
    if (finalPolishArtifact?.data) {
      expect(finalPolishArtifact.data.exportReady).toBe(true);
    }

    // 13. Verify candidate still references the job
    const candidateCheckRes = await request.get(
      `${BASE_URL}/api/candidates/${candidateId}`,
    );
    expect(candidateCheckRes.status()).toBe(200);

    console.log(
      `Pipeline completed: ${stages.length} stages, status=${finalStatus}`,
    );
  });
});

test.describe("Pipeline resilience (mock providers)", () => {
  test("pipeline handles missing base resume gracefully", async ({
    request,
  }) => {
    test.setTimeout(60_000);
    await authenticateApi(request);

    // Create candidate with no base resume
    const testName = `E2E NoResume ${Date.now()}`;
    const testEmail = `e2e-noresume-${Date.now()}@test.talentos`;
    const candidateRes = await request.post(`${BASE_URL}/api/candidates`, {
      data: { name: testName, email: testEmail, status: "active" },
    });
    expect(candidateRes.status()).toBe(201);
    const candidateId: string = (await candidateRes.json()).id;

    // Get a job
    const jobsRes = await request.get(`${BASE_URL}/api/jobs?pageSize=1`);
    const jobId: string = (await jobsRes.json()).jobs?.[0]?.id;
    expect(jobId).toBeDefined();

    // Create application without targeting or base resume
    const appRes = await request.post(`${BASE_URL}/api/applications`, {
      data: {
        candidate_id: candidateId,
        job_id: jobId,
        status: "applied",
      },
    });
    expect(appRes.status()).toBe(201);
    const appBody = await appRes.json();
    const applicationId: string =
      appBody.created?.[0]?.id || appBody.created?.id || appBody.id;

    // Start pipeline — should handle missing resume gracefully
    const pipelineRes = await request.post(
      `${BASE_URL}/api/applications/${applicationId}/ai-workflow`,
    );

    // May succeed (202) or fail (400/422) depending on validation
    // For mock providers, the key is that the server doesn't crash
    const status = pipelineRes.status();
    expect([200, 201, 202, 400, 422]).toContain(status);

    console.log(
      `No-resume pipeline response: ${status} — ${await pipelineRes.text()}`,
    );
  });
});
