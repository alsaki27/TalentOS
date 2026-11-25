import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  staff: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@/server/auth/candidateAuth", () => ({
  requireCurrentCandidate: mocks.auth,
}));
vi.mock("@/lib/auth", () => ({ requireCandidateContractAccess: mocks.staff }));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.query }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: vi.fn() }));
vi.mock("@/server/storage/candidateContractStorage", () => ({
  downloadCandidateContract: vi.fn(),
  isSharePointCandidateContractStorageKey: vi.fn(),
}));
import { GET as candidateDownload } from "@/app/api/portal/me/signed-contract/route";
import { GET as staffDownload } from "@/app/api/candidates/[id]/contracts/[contractId]/route";
import { sha256Hex } from "@/lib/sha256";

const pdf = Buffer.from("%PDF-synthetic-test-only");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    context: { candidateId: "session-candidate" },
  });
  mocks.staff.mockResolvedValue({
    context: { profile: { user_id: "staff-user" } },
  });
});

it("binds the client download to their session and returns private saved PDF bytes", async () => {
  mocks.query.mockResolvedValue({
    pdf_base64: pdf.toString("base64"),
    pdf_sha256: await sha256Hex(pdf),
  });
  const response = await candidateDownload();
  expect(response.status).toBe(200);
  expect(mocks.query).toHaveBeenCalledWith(
    expect.stringContaining("WHERE candidate_id=$1"),
    ["session-candidate"],
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf);
});

it("requires portal authentication and rejects a corrupted saved PDF", async () => {
  mocks.auth.mockResolvedValueOnce({
    response: NextResponse.json({}, { status: 401 }),
  });
  expect((await candidateDownload()).status).toBe(401);
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.query.mockResolvedValue({
    pdf_base64: pdf.toString("base64"),
    pdf_sha256: "wrong",
  });
  expect((await candidateDownload()).status).toBe(503);
});

it("requires contract staff access and constrains the receipt by both candidate and record ID", async () => {
  const request = new Request(
    "https://talentos.test/api/candidates/candidate/contracts/receipt",
  );
  const params = { params: { id: "candidate", contractId: "receipt" } };
  mocks.staff.mockResolvedValueOnce({
    response: NextResponse.json({}, { status: 403 }),
  });
  expect((await staffDownload(request, params)).status).toBe(403);
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.query.mockResolvedValue(null);
  expect((await staffDownload(request, params)).status).toBe(404);
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.stringContaining("WHERE id=$1 AND candidate_id=$2"),
    ["receipt", "candidate"],
  );
});
