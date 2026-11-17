import puppeteer from "@cloudflare/puppeteer";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { canonicalContent } from "@/lib/ai/application-agents/resumeReleasePdf";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";
import { sha256Hex } from "@/lib/sha256";

export class StudioResumeLayoutError extends Error {}

type StudioPdf = Awaited<ReturnType<typeof renderStudioResumePdf>>;

async function openStudioPdfCache(versionId: string, contentHash: string) {
  // A separate, short-lived Cache API namespace. No public route serves its
  // entries. The exact saved version and content (including theme) are bound
  // to the key so stale drafts can never supply the released PDF.
  if (!globalThis.caches) return null;
  try {
    const cache = await caches.open("studio-approval-pdf-v1");
    const key = new Request(new URL(`/internal/studio-approval/${versionId}/${contentHash}`, process.env.TALENTOS_BASE_URL));
    return { cache, key };
  } catch {
    return null;
  }
}

export async function getStudioApprovalPdf(versionId: string, content: unknown, prepareOnly = false) {
  const contentHash = await sha256Hex(canonicalContent(content));
  const store = await openStudioPdfCache(versionId, contentHash);
  if (!store && prepareOnly) return null;
  if (store) {
    try {
      const cached = await store.cache.match(store.key);
      if (cached) {
        const bytes = Buffer.from(await cached.arrayBuffer());
        const pdfHash = cached.headers.get("x-studio-pdf-sha");
        const metrics: StudioPdf["metrics"] = JSON.parse(cached.headers.get("x-studio-pdf-metrics") ?? "null");
        if (metrics?.identityVerified && !metrics.horizontalOverflow && metrics.pageCount > 0 &&
            pdfHash && pdfHash === await sha256Hex(bytes)) {
          return { bytes, contentHash, pdfHash, metrics, prepared: true, timings: {} };
        }
      }
    } catch {
      // A cache miss or failure leaves the usual live render path available.
    }
  }
  const pdf = await renderStudioResumePdf(content, contentHash);
  if (store && prepareOnly) {
    await store.cache.put(store.key, new Response(new Uint8Array(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "max-age=300",
        "x-studio-pdf-sha": pdf.pdfHash,
        "x-studio-pdf-metrics": JSON.stringify(pdf.metrics),
      },
    })).catch(() => undefined);
  }
  return { ...pdf, prepared: false };
}

export async function renderStudioResumePdf(content: unknown, savedContentHash?: string) {
  const resume = studioDocumentToResumeData(content as Parameters<typeof studioDocumentToResumeData>[0]);
  if (!resume.personalInfo.fullName.trim()) {
    throw new StudioResumeLayoutError("Add the candidate name to the saved resume in Studio.");
  }

  const { env } = getCloudflareContext();
  const binding = (env as unknown as { RESUME_BROWSER: Parameters<typeof puppeteer.launch>[0] }).RESUME_BROWSER;
  const printUrl = new URL("/resume-print", process.env.TALENTOS_BASE_URL);
  const started = performance.now();
  const browser = await puppeteer.launch(binding);
  const launched = performance.now();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15_000);
    await page.setViewport({ width: 1200, height: 1260 });
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = new URL(request.url());
      const allowed = request.method() === "GET" && (
        url.href === printUrl.href ||
        (url.origin === printUrl.origin && url.pathname.startsWith("/_next/static/")) ||
        url.protocol === "data:"
      );
      return allowed ? request.continue() : request.abort();
    });

    const response = await page.goto(printUrl.href, { waitUntil: "domcontentloaded" });
    if (!response?.ok() || page.url() !== printUrl.href) throw new Error("Studio print page is unavailable");
    await page.waitForFunction(() => typeof window.loadResumeForPrint === "function");
    await page.evaluate(data => window.loadResumeForPrint?.(data), resume);
    await page.waitForFunction(() => {
      const area = document.getElementById("resume-print-area");
      const count = Number(area?.dataset.studioPages);
      return document.fonts.status === "loaded" && count > 0 && area?.querySelectorAll(".resume-sheet").length === count;
    });
    const laidOut = performance.now();
    const metrics = await page.evaluate(async (name) => {
      const area = document.getElementById("resume-print-area")!;
      await Promise.all(Array.from(area.querySelectorAll("img"), image => image.decode().catch(() => {})));
      const firstSheet = area.querySelector<HTMLElement>(".resume-sheet-clip")!;
      const visibleText = (container: HTMLElement, bounds: DOMRect) => {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        const parts: string[] = [];
        let overflow = false;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          range.selectNodeContents(node);
          const lines = Array.from(range.getClientRects()).filter(line => line.width > 0 && line.height > 0);
          if (lines.some(line => line.left < bounds.left - 1 || line.right > bounds.right + 1)) overflow = true;
          if (lines.some(line => line.top < bounds.bottom && line.bottom > bounds.top)) parts.push(node.textContent);
        }
        return { overflow, text: parts.join(" ") };
      };
      const source = area.querySelector<HTMLElement>(".resume-pagination-measurement")!;
      const searchable = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const printed = visibleText(firstSheet, firstSheet.getBoundingClientRect());
      const expected = searchable(name);
      return {
        pageCount: Number(area.dataset.studioPages),
        identityVerified: Boolean(expected) && searchable(printed.text).includes(expected),
        horizontalOverflow: visibleText(source, source.getBoundingClientRect()).overflow,
      };
    }, resume.personalInfo.fullName);
    if (!metrics.identityVerified || metrics.horizontalOverflow) {
      throw new StudioResumeLayoutError(metrics.identityVerified
        ? "Some text is clipped in the selected theme. Check the saved Studio preview."
        : "The saved resume must show the candidate name on its first page.");
    }

    const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pdf = Buffer.from(bytes);
    // The PDF page tree is plain text in Chromium's output. Confirm the actual
    // print contains the same number of pages as the shared Studio preview.
    const raw = pdf.toString("latin1");
    const pageCount = Number(raw.match(/\/Type\s*\/Pages\b[^>]*\/Count\s+(\d+)/)?.[1]);
    if (!raw.startsWith("%PDF-") || pageCount !== metrics.pageCount) throw new Error("Studio PDF page count verification failed");

    // Chromium stamps the current time in the PDF metadata. Preserve the byte
    // offsets while making a retry of the same print reuse its archive hash.
    for (const stamp of raw.matchAll(/\/(?:CreationDate|ModDate)\s*\(D:(\d{14})/g)) {
      pdf.write("19700101000000", stamp.index! + stamp[0].length - 14, "ascii");
    }
    return {
      bytes: pdf,
      contentHash: savedContentHash ?? await sha256Hex(canonicalContent(content)),
      pdfHash: await sha256Hex(pdf),
      metrics: { ...metrics, template: resume.template, pageFormat: resume.pageFormat },
      timings: {
        studio_browser: Math.round(launched - started),
        studio_layout: Math.round(laidOut - launched),
        studio_pdf: Math.round(performance.now() - laidOut),
      },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
