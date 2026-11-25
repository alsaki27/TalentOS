import puppeteer from "@cloudflare/puppeteer";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  escapeContractHtml as esc,
  type ContractSigningInput,
} from "@/lib/contractSignature";
export interface ContractPdfInput extends ContractSigningInput {
  id: string;
  agreement: string;
  agreementVersion: string;
  privacyVersion: string;
  agreementHash: string;
  signedAt: string;
}
export function contractSigningHtml(input: ContractPdfInput) {
  const signature =
    input.signature.type === "typed"
      ? `<p class="signature">${esc(input.signature.text)}</p>`
      : `<svg width="500" height="150" viewBox="0 0 500 150" xmlns="http://www.w3.org/2000/svg">${input.signature.strokes.map((s) => `<polyline points="${s.map((p) => `${p[0] * 500},${p[1] * 150}`).join(" ")}" fill="none" stroke="#163e35" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}</svg>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.55;color:#18352e}h1{font-size:22pt}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.signing{break-before:page}dt{font-weight:bold;margin-top:12px}dd{margin:3px 0;overflow-wrap:anywhere}.signature{font-family:cursive;font-size:28pt;overflow-wrap:anywhere}.small{font-size:9pt;color:#53665f}svg{max-width:100%}</style></head><body><h1>Skarion Service Agreement</h1><pre>${esc(input.agreement)}</pre><section class="signing"><h1>Client signature</h1><p>I have read and accepted this agreement and consent to signing it electronically.</p>${signature}<dl><dt>Full legal name</dt><dd>${esc(input.signerName)}</dd><dt>Copy recipients</dt><dd>${esc(input.signerEmail)} and info@skarion.com</dd><dt>Client-entered date</dt><dd>${esc(input.signingDate)}</dd><dt>Recorded signing time (UTC)</dt><dd>${esc(input.signedAt)}</dd><dt>Agreement / privacy versions</dt><dd>${esc(input.agreementVersion)} / ${esc(input.privacyVersion)}</dd><dt>Record ID</dt><dd>${esc(input.id)}</dd><dt>Agreement SHA-256</dt><dd>${esc(input.agreementHash)}</dd></dl><p class="small">Electronic signature recorded through the authenticated TalentOS candidate portal. This document is not sealed with a digital signing certificate. No SSN data is included.</p></section></body></html>`;
}
export async function renderSignedContractPdf(
  input: ContractPdfInput,
): Promise<Buffer> {
  const { env } = getCloudflareContext();
  const browser = await puppeteer.launch(
    (
      env as unknown as {
        RESUME_BROWSER: Parameters<typeof puppeteer.launch>[0];
      }
    ).RESUME_BROWSER,
  );
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => request.abort());
    await page.setContent(contractSigningHtml(input), {
      waitUntil: "load",
      timeout: 20000,
    });
    const pdf = Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      }),
    );
    if (pdf.subarray(0, 5).toString() !== "%PDF-" || pdf.length > 2900000)
      throw new Error("Contract PDF generation failed.");
    return pdf;
  } finally {
    await browser.close();
  }
}
