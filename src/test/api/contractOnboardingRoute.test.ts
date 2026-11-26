import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  save: vi.fn(),
  deliver: vi.fn(),
  encrypt: vi.fn(),
}));
vi.mock("@/server/auth/candidateAuth", () => ({
  requireCurrentCandidate: mocks.auth,
}));
vi.mock("@/server/services/contractSigningService", () => ({
  saveSignedContract: mocks.save,
  processContractDeliveries: mocks.deliver,
}));
vi.mock("@/server/privacy/candidateSsnCrypto", () => ({
  encryptCandidateSsnLast4: mocks.encrypt,
}));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: vi.fn() }));
import { GET, POST } from "@/app/api/portal/me/onboarding/route";
import {
  CANDIDATE_AGREEMENT_VERSION,
  CANDIDATE_PRIVACY_NOTICE_VERSION,
} from "@/lib/candidatePortalAgreementVersion";
const body = () => ({
  agreementVersion: CANDIDATE_AGREEMENT_VERSION,
  privacyNoticeVersion: CANDIDATE_PRIVACY_NOTICE_VERSION,
  termsAccepted: true,
  agreementScrolledToEnd: true,
  dataProcessingConsent: true,
  hasSsn: false,
  signerName: "Test Client",
  signerEmail: "client@example.com",
  signingDate: new Date().toISOString().slice(0, 10),
  signature: { type: "typed", text: "Test Client" },
  signatureConsent: true,
});
const request = (value: unknown) =>
  new NextRequest("https://talentos.test/api/portal/me/onboarding", {
    method: "POST",
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    context: {
      candidateId: "session-candidate",
      candidate: { has_contract: false, onboarding_complete: false },
    },
  });
  mocks.save.mockResolvedValue({
    id: "receipt",
    signer_email: "client@example.com",
  });
  mocks.deliver.mockResolvedValue({ sent: 0 });
});
it("rejects unsigned checkbox-only submissions and outdated agreements", async () => {
  for (const patch of [
    { signature: null },
    { signatureConsent: false },
    { termsAccepted: false },
    { agreementVersion: "old" },
  ])
    expect(
      (await POST(request({ ...body(), ...patch }))).status,
    ).toBeGreaterThanOrEqual(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("binds the signature to the session and queues copies only after persistence", async () => {
  const response = await POST(
    request({ ...body(), candidateId: "attacker-specified" }),
  );
  expect(response.status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith(
    "session-candidate",
    expect.objectContaining({ signerEmail: "client@example.com" }),
    false,
    null,
    expect.objectContaining({ version: CANDIDATE_AGREEMENT_VERSION }),
  );
  expect((await response.json()).emailDelivery).toBe("queued");
  expect(mocks.deliver).toHaveBeenCalledTimes(1);
});
it("requires authentication and does not send when save fails", async () => {
  mocks.auth.mockResolvedValueOnce({
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  expect((await POST(request(body()))).status).toBe(401);
  mocks.save.mockRejectedValue(new Error("storage failure"));
  expect((await POST(request(body()))).status).toBe(500);
  expect(mocks.deliver).not.toHaveBeenCalled();
});
it("rejects oversized requests before processing a signature", async () => {
  expect((await POST(request({ extra: "x".repeat(500001) }))).status).toBe(413);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("shows and signs the session candidate's saved terms", async () => {
  const runs = [{ text: "Candidate-specific payment terms", italic: true }];
  mocks.auth.mockResolvedValue({ context: {
    candidateId: "session-candidate",
    candidate: { has_contract: false, contract_terms_version: "revision-2", agreement_runs: runs },
  } });
  expect(await (await GET()).json()).toMatchObject({
    agreementVersion: "revision-2", agreementText: runs[0].text, agreementRuns: runs,
  });
  expect((await POST(request(body()))).status).toBe(409);
  expect((await POST(request({ ...body(), agreementVersion: "revision-2", agreementText: "Other terms" }))).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith("session-candidate", expect.anything(), false, null,
    { version: "revision-2", text: runs[0].text, runs });
});
