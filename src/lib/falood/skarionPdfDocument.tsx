// src/lib/falood/skarionPdfDocument.tsx
// Renders a ResumeDocument into a PDF using jsPDF - same "Skarion Compact
// Professional" layout intent as before (one page target, compact but readable,
// no colors/photos/icons, ATS-friendly headings, bullet-heavy, single column).
//
// Previously used @react-pdf/renderer (PDFKit-based). Switched to jsPDF after a
// real deploy attempt confirmed @react-pdf/pdfkit's browser build (900 KiB) was
// being included in the Cloudflare Worker SCRIPT bundle itself - not just static
// assets - despite only ever being referenced from a "use client" file behind a
// dynamic import(). Next.js's "standalone" output file-tracing copies anything
// reachable anywhere in the build (client chunks included), and excluding it via
// next.config.mjs's outputFileTracingExcludes still didn't keep it out of what
// wrangler's own bundler resolves for the deployed script - Cloudflare Workers
// don't support genuinely separate, lazily-fetched script files the way a
// browser or a Node server with disk access does, so anything reachable by the
// SSR-capable app has to fit in the one deployed script regardless of how it's
// imported client-side. jsPDF has no native rendering engine dependency and is
// far smaller, sidestepping the problem entirely rather than continuing to fight
// the bundler. It's also now called directly from server-side agent code
// (hiringPanel.ts/finalPolish.ts) to measure real page-fit before/after AI
// edits - verified safe under the Workers Paid plan's 9000 KiB budget (see
// deploy.yml's size-check step), which jsPDF alone comes nowhere near.
//
// Lower visual fidelity than PDFKit's typography engine, but a real, working,
// deployable PDF - see docxExport.ts for the still-PDFKit-free DOCX export,
// which was never actually the size problem (only @react-pdf/pdfkit was flagged
// in the wrangler size-limit diagnostic).

import { jsPDF } from "jspdf";
import { ResumeDocument } from "@/lib/falood/types";

const PAGE_WIDTH_IN = 8.5;
const PAGE_HEIGHT_IN = 11;
const A4_WIDTH_IN = 8.27;
const A4_HEIGHT_IN = 11.69;

// The one source of truth for "is this font size still readable when
// rendered" - shared with autoFit.ts's formatting-reduction floor so the two
// can never silently disagree about what "readable" means.
export const READABILITY_FLOOR_FONT_SIZE = 9;

export interface ResumePageMetrics {
  pageCount: number;
  /** 0-1: how much of the usable body height on the (last) page is filled. */
  contentUtilization: number;
  bottomWhitespaceInches: number;
  overflow: boolean;
  readable: boolean;
}

function contactLine(content: ResumeDocument): string {
  return [
    content.header.location,
    content.header.phone,
    content.header.email,
    content.header.linkedin,
    content.header.github,
    content.header.portfolio,
  ].filter(Boolean).join("   |   ");
}

interface RenderResult {
  doc: jsPDF;
  maxYPerPage: number[];
  baseFontSize: number;
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
}

function renderInternal(content: ResumeDocument): RenderResult {
  const { formatting } = content;
  const isA4 = formatting.pageFormat === "a4";
  const pageWidth = isA4 ? A4_WIDTH_IN : PAGE_WIDTH_IN;
  const pageHeight = isA4 ? A4_HEIGHT_IN : PAGE_HEIGHT_IN;

  const marginTop = formatting.marginTop ?? 0.5;
  const marginRight = formatting.marginRight ?? 0.5;
  const marginBottom = formatting.marginBottom ?? 0.5;
  const marginLeft = formatting.marginLeft ?? 0.5;
  const contentWidth = pageWidth - marginLeft - marginRight;

  const baseFontSize = formatting.fontSize || 10.5;
  const lineHeight = (formatting.lineHeight || 1.15) * (baseFontSize / 72) * 1.05;
  const sectionSpacing = (formatting.sectionSpacing ?? 5) / 72;
  const bulletSpacing = (formatting.bulletSpacing ?? 1) / 72;

  const doc = new jsPDF({ unit: "in", format: isA4 ? "a4" : "letter" });
  doc.setFont("helvetica");

  let y = marginTop;
  // maxYPerPage[i] tracks the deepest y actually written to on page i+1 - the
  // real, measured "how full is this page" signal renderResumePdfWithMetrics
  // reports, as opposed to guessing from character/word counts.
  const maxYPerPage: number[] = [marginTop];

  function bumpY(delta: number) {
    y += delta;
    maxYPerPage[maxYPerPage.length - 1] = Math.max(maxYPerPage[maxYPerPage.length - 1], y);
  }

  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
      maxYPerPage.push(marginTop);
    }
  }

  function writeWrapped(text: string, x: number, maxWidth: number, fontSize: number, opts: { bold?: boolean; italic?: boolean; align?: "left" | "center" } = {}) {
    doc.setFont("helvetica", opts.bold && opts.italic ? "bolditalic" : opts.bold ? "bold" : opts.italic ? "italic" : "normal");
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, x, y, { align: opts.align });
      bumpY(lineHeight);
    }
  }

  function sectionTitle(title: string) {
    ensureSpace(lineHeight + sectionSpacing);
    bumpY(sectionSpacing * 0.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(baseFontSize + 0.25);
    doc.text(title.toUpperCase(), marginLeft, y);
    doc.setLineWidth(0.008);
    doc.line(marginLeft, y + 0.03, marginLeft + contentWidth, y + 0.03);
    bumpY(lineHeight + 0.02);
  }

  function bullet(text: string) {
    const bulletIndent = 0.14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(baseFontSize - 0.5);
    const lines = doc.splitTextToSize(text, contentWidth - bulletIndent) as string[];
    lines.forEach((line, i) => {
      ensureSpace(lineHeight);
      if (i === 0) doc.text("•", marginLeft, y);
      doc.text(line, marginLeft + bulletIndent, y);
      bumpY(lineHeight);
    });
    bumpY(bulletSpacing);
  }

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(baseFontSize + 4);
  doc.text(content.header.fullName, pageWidth / 2, y, { align: "center" });
  bumpY(lineHeight + 0.01);

  const contact = contactLine(content);
  if (contact) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(baseFontSize - 0.5);
    writeWrapped(contact, pageWidth / 2, contentWidth, baseFontSize - 0.5, { align: "center" });
    bumpY(sectionSpacing * 0.5);
  }

  if (content.summary?.text) {
    writeWrapped(content.summary.text, marginLeft, contentWidth, baseFontSize);
    bumpY(sectionSpacing * 0.5);
  }

  if (content.skills.length > 0) {
    sectionTitle("Technical Skills");
    for (const s of content.skills) {
      ensureSpace(lineHeight);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(baseFontSize - 0.5);
      const label = `${s.title}: `;
      doc.text(label, marginLeft, y);
      const labelWidth = doc.getTextWidth(label);
      doc.setFont("helvetica", "normal");
      writeWrapped(s.skills.join(", "), marginLeft + labelWidth, contentWidth - labelWidth, baseFontSize - 0.5);
    }
    bumpY(sectionSpacing * 0.5);
  }

  if (content.experience.length > 0) {
    sectionTitle("Professional Experience");
    for (const exp of content.experience) {
      ensureSpace(lineHeight * 2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(baseFontSize - 0.5);
      doc.text(`${exp.title} — ${exp.company}${exp.location ? `, ${exp.location}` : ""}`, marginLeft, y);
      doc.setFont("helvetica", "italic");
      const dates = `${exp.startDate} – ${exp.isCurrent ? "Present" : exp.endDate ?? ""}`;
      doc.text(dates, marginLeft + contentWidth, y, { align: "right" });
      bumpY(lineHeight);
      for (const b of exp.bullets) bullet(b.text);
    }
    bumpY(sectionSpacing * 0.5);
  }

  if (content.projects && content.projects.length > 0) {
    sectionTitle("Projects");
    for (const p of content.projects) {
      ensureSpace(lineHeight);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(baseFontSize - 0.5);
      doc.text(p.name + (p.technologies?.length ? ` (${p.technologies.join(", ")})` : ""), marginLeft, y);
      bumpY(lineHeight);
      if (p.description) writeWrapped(p.description, marginLeft, contentWidth, baseFontSize - 0.5);
      for (const b of p.bullets) bullet(b.text);
    }
    bumpY(sectionSpacing * 0.5);
  }

  if (content.education.length > 0) {
    sectionTitle("Education");
    for (const edu of content.education) {
      writeWrapped(
        `${edu.degree} — ${edu.school}${edu.location ? `, ${edu.location}` : ""}${edu.graduationDate ? `  (${edu.graduationDate})` : ""}`,
        marginLeft,
        contentWidth,
        baseFontSize - 0.5
      );
    }
    bumpY(sectionSpacing * 0.5);
  }

  if (content.certifications && content.certifications.length > 0) {
    sectionTitle("Certifications");
    for (const c of content.certifications) {
      writeWrapped(
        `${c.name}${c.issuer ? ` — ${c.issuer}` : ""}${c.date ? ` (${c.date})` : ""}`,
        marginLeft,
        contentWidth,
        baseFontSize - 0.5
      );
    }
    bumpY(sectionSpacing * 0.5);
  }

  for (const section of content.customSections ?? []) {
    sectionTitle(section.title);
    for (const b of section.bullets) bullet(b.text);
  }

  return { doc, maxYPerPage, baseFontSize, pageHeight, marginTop, marginBottom };
}

function computeMetrics(result: RenderResult): ResumePageMetrics {
  const { doc, maxYPerPage, baseFontSize, pageHeight, marginTop, marginBottom } = result;
  const usableHeight = Math.max(0.01, pageHeight - marginTop - marginBottom);
  const pageCount = doc.getNumberOfPages();
  const lastPageMaxY = maxYPerPage[maxYPerPage.length - 1] ?? marginTop;
  const lastPageUsed = Math.max(0, lastPageMaxY - marginTop);

  // Multi-page: bottom whitespace isn't the number that matters (the overflow
  // itself is), so it's reported as 0 rather than measuring the final,
  // possibly near-empty overflow page.
  const bottomWhitespaceInches = pageCount === 1
    ? Math.round(Math.max(0, pageHeight - marginBottom - lastPageMaxY) * 100) / 100
    : 0;

  let contentUtilization: number;
  if (pageCount <= 1) {
    contentUtilization = Math.min(1, lastPageUsed / usableHeight);
  } else {
    // Prior pages overflowed, so they're treated as fully utilized; blend in
    // the last page's actual fill so utilization stays a meaningful "how
    // close to fitting" signal instead of pinning at 100%.
    const fullPages = pageCount - 1;
    contentUtilization = Math.min(1, (fullPages * usableHeight + lastPageUsed) / (pageCount * usableHeight));
  }

  return {
    pageCount,
    contentUtilization: Math.round(contentUtilization * 1000) / 1000,
    bottomWhitespaceInches,
    overflow: pageCount > 1,
    readable: baseFontSize >= READABILITY_FLOOR_FONT_SIZE,
  };
}

export function renderResumePdfDoc(content: ResumeDocument): jsPDF {
  return renderInternal(content).doc;
}

/**
 * Same rendering pass as renderResumePdfDoc, but also returns real,
 * rendered-PDF-derived page-fit metrics (page count via doc.getNumberOfPages(),
 * fill/whitespace from tracking the deepest y actually written to per page) -
 * the "actual rendered PDF, not character count" source of truth the resume
 * pipeline's page-fit QA loop is built on (autoFit.ts, hiringPanel.ts,
 * finalPolish.ts).
 */
export function renderResumePdfWithMetrics(content: ResumeDocument): { doc: jsPDF; metrics: ResumePageMetrics } {
  const result = renderInternal(content);
  return { doc: result.doc, metrics: computeMetrics(result) };
}
