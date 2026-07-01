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
// the bundler.
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

export function renderResumePdfDoc(content: ResumeDocument): jsPDF {
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

  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
    }
  }

  function writeWrapped(text: string, x: number, maxWidth: number, fontSize: number, opts: { bold?: boolean; italic?: boolean; align?: "left" | "center" } = {}) {
    doc.setFont("helvetica", opts.bold && opts.italic ? "bolditalic" : opts.bold ? "bold" : opts.italic ? "italic" : "normal");
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, x, y, { align: opts.align });
      y += lineHeight;
    }
  }

  function sectionTitle(title: string) {
    ensureSpace(lineHeight + sectionSpacing);
    y += sectionSpacing * 0.5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(baseFontSize + 0.25);
    doc.text(title.toUpperCase(), marginLeft, y);
    const textWidth = doc.getTextWidth(title.toUpperCase());
    doc.setLineWidth(0.008);
    doc.line(marginLeft, y + 0.03, marginLeft + contentWidth, y + 0.03);
    y += lineHeight + 0.02;
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
      y += lineHeight;
    });
    y += bulletSpacing;
  }

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(baseFontSize + 4);
  doc.text(content.header.fullName, pageWidth / 2, y, { align: "center" });
  y += lineHeight + 0.01;

  const contact = contactLine(content);
  if (contact) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(baseFontSize - 0.5);
    writeWrapped(contact, pageWidth / 2, contentWidth, baseFontSize - 0.5, { align: "center" });
    y += sectionSpacing * 0.5;
  }

  if (content.summary?.text) {
    writeWrapped(content.summary.text, marginLeft, contentWidth, baseFontSize);
    y += sectionSpacing * 0.5;
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
    y += sectionSpacing * 0.5;
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
      y += lineHeight;
      for (const b of exp.bullets) bullet(b.text);
    }
    y += sectionSpacing * 0.5;
  }

  if (content.projects && content.projects.length > 0) {
    sectionTitle("Projects");
    for (const p of content.projects) {
      ensureSpace(lineHeight);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(baseFontSize - 0.5);
      doc.text(p.name + (p.technologies?.length ? ` (${p.technologies.join(", ")})` : ""), marginLeft, y);
      y += lineHeight;
      if (p.description) writeWrapped(p.description, marginLeft, contentWidth, baseFontSize - 0.5);
      for (const b of p.bullets) bullet(b.text);
    }
    y += sectionSpacing * 0.5;
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
    y += sectionSpacing * 0.5;
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
    y += sectionSpacing * 0.5;
  }

  for (const section of content.customSections ?? []) {
    sectionTitle(section.title);
    for (const b of section.bullets) bullet(b.text);
  }

  return doc;
}
