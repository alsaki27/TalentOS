import { expect, it, vi } from "vitest";
vi.mock("@cloudflare/puppeteer", () => ({ default: {} }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));
import { contractSigningHtml } from "@/server/services/contractSigningPdf";
it("prints complete agreement and signature with escaped text and no SSN values", () => {
  const html = contractSigningHtml({
    id: "receipt",
    agreement: "Full agreement\n<script>bad()</script>",
    agreementVersion: "v1",
    privacyVersion: "p1",
    agreementHash: "hash",
    signedAt: "2026-11-26T12:00:00.000Z",
    signerName: "<img onerror=x>",
    signerEmail: "client@example.com",
    signingDate: "2026-11-26",
    signature: { type: "typed", text: "Test Client" },
  });
  expect(html).toContain("Full agreement");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img onerror");
  expect(html).toContain("Test Client");
  expect(html).toContain("info@skarion.com");
  expect(html).toContain("2026-11-26T12:00:00.000Z");
});
it("renders normalized drawing strokes as visible vector geometry", () => {
  const html = contractSigningHtml({
    id: "receipt",
    agreement: "Agreement",
    agreementVersion: "v1",
    privacyVersion: "p1",
    agreementHash: "hash",
    signedAt: "now",
    signerName: "Client",
    signerEmail: "client@example.com",
    signingDate: "2026-11-26",
    signature: {
      type: "drawn",
      strokes: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    },
  });
  expect(html).toContain('<polyline points="0,0 500,150"');
});
