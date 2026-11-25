import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateContractSigning } from "@/lib/contractSignature";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  pdf: vi.fn(),
  graph: vi.fn(),
  configured: vi.fn(),
}));
vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
}));
vi.mock("@/server/services/contractSigningPdf", () => ({
  renderSignedContractPdf: mocks.pdf,
}));
vi.mock("@/lib/msGraphMail", () => ({
  isGraphMailConfigured: mocks.configured,
  sendGraphMail: mocks.graph,
}));
import {
  saveSignedContract,
  processContractDeliveries,
} from "@/server/services/contractSigningService";
import { sha256Hex } from "@/lib/sha256";
const valid = () => ({
  signerName: "Test Client",
  signerEmail: "client@example.com",
  signingDate: new Date().toISOString().slice(0, 10),
  signature: { type: "typed", text: "Test Client" },
  signatureConsent: true,
});
describe("contract signature validation", () => {
  it("accepts typed and drawn signatures", () => {
    expect(validateContractSigning(valid()).signature.type).toBe("typed");
    expect(
      validateContractSigning({
        ...valid(),
        signature: {
          type: "drawn",
          strokes: [
            [
              [0, 0],
              [0.1, 0.1],
              [0.2, 0.2],
              [0.3, 0.1],
            ],
          ],
        },
      }).signature.type,
    ).toBe("drawn");
  });
  it("rejects missing consent, mismatched names, blank or malformed drawings, stale dates and email injection", () => {
    for (const changes of [
      { signatureConsent: false },
      { signature: { type: "typed", text: "Other name" } },
      { signature: { type: "drawn", strokes: [] } },
      {
        signature: {
          type: "drawn",
          strokes: [
            [
              [0, 0],
              [NaN, 0],
            ],
          ],
        },
      },
      { signingDate: "2026-02-30" },
      { signerEmail: "one@example.com,second@example.com" },
      { signerEmail: "a@b.com\r\nBcc: victim@example.com" },
    ])
      expect(() =>
        validateContractSigning({ ...valid(), ...changes }),
      ).toThrow();
  });
});
describe("contract persistence and delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "");
    mocks.configured.mockReturnValue(false);
  });
  it("reuses a signed record without regenerating or modifying it", async () => {
    mocks.queryOne.mockResolvedValue({ id: "existing" });
    expect(
      await saveSignedContract(
        "candidate",
        validateContractSigning(valid()),
        false,
        null,
      ),
    ).toEqual({ id: "existing" });
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.queryOne).toHaveBeenCalledTimes(1);
  });
  it("never accepts onboarding when PDF generation fails", async () => {
    mocks.queryOne.mockResolvedValue(null);
    mocks.pdf.mockRejectedValue(new Error("renderer unavailable"));
    await expect(
      saveSignedContract(
        "candidate",
        validateContractSigning(valid()),
        false,
        null,
      ),
    ).rejects.toThrow();
    expect(mocks.queryOne).toHaveBeenCalledTimes(1);
  });
  it("does not pretend to send if no provider is configured", async () => {
    expect(await processContractDeliveries()).toEqual({
      sent: 0,
      pending: true,
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("attaches the exact saved PDF and marks accepted delivery", async () => {
    mocks.configured.mockReturnValue(true);
    const bytes = Buffer.from("%PDF-synthetic");
    mocks.query
      .mockResolvedValueOnce([
        {
          id: "job",
          contract_id: "contract",
          recipient: "info@skarion.com",
          pdf_base64: bytes.toString("base64"),
          pdf_sha256: await sha256Hex(bytes),
        },
      ])
      .mockResolvedValue([]);
    mocks.graph.mockResolvedValue({ success: true });
    expect((await processContractDeliveries()).sent).toBe(1);
    expect(mocks.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "info@skarion.com",
        attachments: [
          expect.objectContaining({ contentBytes: bytes.toString("base64") }),
        ],
      }),
    );
    expect(mocks.query.mock.calls[1][0]).toContain("sent_at=now()");
  });
  it("retains failed emails for retry and never marks them sent", async () => {
    mocks.configured.mockReturnValue(true);
    const bytes = Buffer.from("%PDF-synthetic");
    mocks.query
      .mockResolvedValueOnce([
        {
          id: "job",
          recipient: "client@example.com",
          pdf_base64: bytes.toString("base64"),
          pdf_sha256: await sha256Hex(bytes),
        },
      ])
      .mockResolvedValue([]);
    mocks.graph.mockResolvedValue({ success: false });
    expect((await processContractDeliveries()).sent).toBe(0);
    expect(mocks.query.mock.calls[1][0]).toContain("retry scheduled");
  });
});
