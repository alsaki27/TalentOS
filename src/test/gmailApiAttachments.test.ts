import { describe, expect, it } from "vitest";
import { extractAttachments } from "@/lib/integrations/gmailApi";

describe("Gmail attachment metadata", () => {
  it("walks nested MIME parts and preserves attachment identity", () => {
    const result = extractAttachments({
      mimeType: "multipart/mixed",
      parts: [{
        mimeType: "multipart/alternative",
        parts: [{ filename: "resume.pdf", mimeType: "application/pdf", body: { attachmentId: "att-1", size: 1234 } }],
      }, { filename: "offer.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body: { attachmentId: "att-2", size: 456 } }],
    });

    expect(result).toEqual([
      { filename: "resume.pdf", mimeType: "application/pdf", size: 1234, attachmentId: "att-1" },
      { filename: "offer.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 456, attachmentId: "att-2" },
    ]);
  });

  it("ignores MIME parts without an attachment body", () => {
    expect(extractAttachments({ parts: [{ filename: "inline.png", mimeType: "image/png", body: { data: "abc" } }] })).toEqual([]);
  });
});
