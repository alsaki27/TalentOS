import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowserQueueArtifact } from "@/server/services/browserWorkerQueueService";
import { StagedResumePdfMissingError } from "@/server/storage/approvedResumePdfStorage";

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  findExportById: vi.fn(),
  downloadResumeFile: vi.fn(),
  readTemporaryResumePdf: vi.fn(),
  openSharePointItem: vi.fn(),
  downloadFromSharePoint: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({ query: vi.fn(), queryOne: mocks.queryOne }));
vi.mock("@/server/repositories/applicationResumeExportsRepository", () => ({ findExportById: mocks.findExportById }));
vi.mock("@/lib/resumeStorage", () => ({ downloadResumeFile: mocks.downloadResumeFile }));
vi.mock("@/server/services/candidateApplicationFactsService", () => ({ getApprovedApplicationAnswers: vi.fn() }));
vi.mock("@/server/storage/approvedResumePdfStorage", () => ({
  TEMPORARY_RESUME_PDF_PROVIDER: "approved_pdf_staging",
  StagedResumePdfMissingError: class StagedResumePdfMissingError extends Error {},
  readTemporaryResumePdf: mocks.readTemporaryResumePdf,
}));
vi.mock("@/lib/integrations/sharepoint", () => ({
  openSharePointItem: mocks.openSharePointItem,
  downloadFromSharePoint: mocks.downloadFromSharePoint,
}));

const applicationId = "10000000-0000-4000-8000-000000000001";
const exportId = "10000000-0000-4000-8000-000000000002";
const versionId = "10000000-0000-4000-8000-000000000003";
const requestId = "10000000-0000-4000-8000-000000000004";
const bytes = new TextEncoder().encode("%PDF-1.4\napproved fixture\n%%EOF");
const digest = createHash("sha256").update(bytes).digest("hex");
const lease = {
  application_id: applicationId,
  export_id: exportId,
  resume_version_id: versionId,
  content_sha256: digest,
  byte_length: bytes.byteLength,
};
const staged = {
  id: exportId,
  application_id: applicationId,
  resume_version_id: versionId,
  export_type: "pdf",
  status: "created",
  storage_provider: "approved_pdf_staging",
  file_path: "approved-resumes/fixture/current.pdf",
  storage_url: null,
  storage_item_id: null,
  content_sha256: digest,
  file_size_bytes: bytes.byteLength,
  pdf_archive_state: "pending",
};
const archived = {
  ...staged,
  storage_provider: "sharepoint",
  file_path: "approved/fixture/current.pdf",
  storage_url: "https://sharepoint.example.test/approved/current.pdf",
  storage_item_id: "fixture-item",
};

function artifact() {
  const request = new Request("https://talentos.test/api/browser-worker/v3/jobs/fixture/artifact", {
    headers: {
      Authorization: `Bearer tbwq_${"a".repeat(64)}`,
      "X-Browser-Worker-Lease": `tblq_${"b".repeat(64)}`,
    },
  });
  return getBrowserQueueArtifact(request, requestId);
}

describe("dedicated worker approved PDF download", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.queryOne.mockResolvedValue(lease);
    mocks.findExportById.mockResolvedValue(staged);
    mocks.readTemporaryResumePdf.mockResolvedValue(bytes);
    mocks.openSharePointItem.mockResolvedValue({ arrayBuffer: async () => bytes.slice().buffer });
  });

  it("reads the approved staged bytes while the SharePoint archive is pending", async () => {
    await expect(artifact()).resolves.toEqual(bytes);
    expect(mocks.findExportById).toHaveBeenCalledWith(exportId);
    expect(mocks.readTemporaryResumePdf).toHaveBeenCalledWith(staged.file_path, digest);
    expect(mocks.downloadResumeFile).not.toHaveBeenCalled();
    expect(mocks.queryOne).toHaveBeenCalledTimes(2);
  });

  it("uses the upstream approved PDF reader for the exact SharePoint export", async () => {
    mocks.findExportById.mockResolvedValue(archived);
    await expect(artifact()).resolves.toEqual(bytes);
    expect(mocks.openSharePointItem).toHaveBeenCalledWith(archived.storage_item_id);
    expect(mocks.readTemporaryResumePdf).not.toHaveBeenCalled();
    expect(mocks.downloadResumeFile).not.toHaveBeenCalled();
  });

  it("follows the same export to SharePoint when archive cleanup removes its staged object", async () => {
    mocks.readTemporaryResumePdf.mockRejectedValueOnce(new StagedResumePdfMissingError("fixture missing"));
    mocks.findExportById.mockResolvedValueOnce(staged).mockResolvedValueOnce(archived);
    await expect(artifact()).resolves.toEqual(bytes);
    expect(mocks.findExportById.mock.calls).toEqual([[exportId], [exportId]]);
    expect(mocks.openSharePointItem).toHaveBeenCalledWith(archived.storage_item_id);
    expect(mocks.queryOne).toHaveBeenCalledTimes(2);
  });

  it("retains the legacy R2 byte download for eligible older exports", async () => {
    mocks.findExportById.mockResolvedValue({ ...staged, storage_provider: "r2" });
    mocks.downloadResumeFile.mockResolvedValue({ buffer: bytes });
    await expect(artifact()).resolves.toEqual(bytes);
    expect(mocks.downloadResumeFile).toHaveBeenCalledWith("r2", staged.file_path, null);
    expect(mocks.readTemporaryResumePdf).not.toHaveBeenCalled();
  });

  it("accepts a database bigint size represented as a decimal string", async () => {
    mocks.findExportById.mockResolvedValue({ ...staged, file_size_bytes: String(bytes.byteLength) });
    await expect(artifact()).resolves.toEqual(bytes);
  });

  it.each([
    { application_id: versionId },
    { resume_version_id: applicationId },
    { id: requestId },
    { export_type: "docx" },
    { status: "failed" },
    { content_sha256: "f".repeat(64) },
    { file_size_bytes: bytes.byteLength + 1 },
  ])("rejects changed pinned export metadata before storage access (%j)", async changes => {
    mocks.findExportById.mockResolvedValue({ ...staged, ...changes });
    await expect(artifact()).rejects.toMatchObject({ status: 409, message: "Pinned résumé export changed" });
    expect(mocks.readTemporaryResumePdf).not.toHaveBeenCalled();
    expect(mocks.openSharePointItem).not.toHaveBeenCalled();
    expect(mocks.downloadResumeFile).not.toHaveBeenCalled();
  });

  it("rejects changed staged PDF bytes even when storage returns them", async () => {
    mocks.readTemporaryResumePdf.mockResolvedValue(new TextEncoder().encode("%PDF-1.4\nwrong fixture\n%%EOF"));
    await expect(artifact()).rejects.toMatchObject({ status: 409, message: "Pinned résumé bytes changed" });
  });

  it("rejects the download after the source or lease changes during storage access", async () => {
    mocks.queryOne.mockResolvedValueOnce(lease).mockResolvedValueOnce(null);
    await expect(artifact()).rejects.toMatchObject({ status: 409, message: "Lease expired or the pinned application is no longer ready" });
    expect(mocks.readTemporaryResumePdf).toHaveBeenCalledTimes(1);
  });
});
