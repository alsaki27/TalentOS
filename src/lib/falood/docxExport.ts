// src/lib/falood/docxExport.ts
// DOCX export — the brief explicitly says PDF+JSON are enough for MVP "if DOCX is too
// much, but architecture should leave room for DOCX." Implemented directly since the
// same ResumeDocument structure renders cleanly to either format; mirrors the section
// order/styling of skarionPdfDocument.tsx so the two exports stay visually consistent.

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";
import { ResumeDocument } from "@/lib/falood/types";

function contactLine(content: ResumeDocument): string {
  return [
    content.header.location,
    content.header.phone,
    content.header.email,
    content.header.linkedin,
    content.header.github,
    content.header.portfolio,
  ].filter(Boolean).join("  |  ");
}

function sectionHeading(text: string) {
  return new Paragraph({
    text: text.toUpperCase(),
    heading: HeadingLevel.HEADING_2,
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" } },
    spacing: { before: 200, after: 80 },
  });
}

function bulletParagraph(text: string) {
  return new Paragraph({ text, bullet: { level: 0 } });
}

export async function renderResumeDocx(content: ResumeDocument): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: content.header.fullName, bold: true, size: 32 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: contactLine(content), size: 20 })],
      spacing: { after: 160 },
    }),
  ];

  if (content.summary?.text) {
    children.push(new Paragraph({ text: content.summary.text, spacing: { after: 160 } }));
  }

  if (content.skills.length > 0) {
    children.push(sectionHeading("Technical Skills"));
    for (const s of content.skills) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${s.title}: `, bold: true }),
          new TextRun({ text: s.skills.join(", ") }),
        ],
      }));
    }
  }

  if (content.experience.length > 0) {
    children.push(sectionHeading("Professional Experience"));
    for (const exp of content.experience) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${exp.title} — ${exp.company}${exp.location ? `, ${exp.location}` : ""}`, bold: true }),
          new TextRun({ text: `\t${exp.startDate} – ${exp.isCurrent ? "Present" : exp.endDate ?? ""}`, italics: true }),
        ],
        spacing: { before: 120 },
      }));
      for (const b of exp.bullets) children.push(bulletParagraph(b.text));
    }
  }

  if (content.projects && content.projects.length > 0) {
    children.push(sectionHeading("Projects"));
    for (const p of content.projects) {
      children.push(new Paragraph({
        children: [new TextRun({ text: p.name + (p.technologies?.length ? ` (${p.technologies.join(", ")})` : ""), bold: true })],
        spacing: { before: 120 },
      }));
      if (p.description) children.push(new Paragraph({ text: p.description }));
      for (const b of p.bullets) children.push(bulletParagraph(b.text));
    }
  }

  if (content.education.length > 0) {
    children.push(sectionHeading("Education"));
    for (const edu of content.education) {
      children.push(new Paragraph({
        text: `${edu.degree} — ${edu.school}${edu.location ? `, ${edu.location}` : ""}${edu.graduationDate ? `  (${edu.graduationDate})` : ""}`,
      }));
    }
  }

  if (content.certifications && content.certifications.length > 0) {
    children.push(sectionHeading("Certifications"));
    for (const c of content.certifications) {
      children.push(new Paragraph({ text: `${c.name}${c.issuer ? ` — ${c.issuer}` : ""}${c.date ? ` (${c.date})` : ""}` }));
    }
  }

  for (const section of content.customSections ?? []) {
    children.push(sectionHeading(section.title));
    for (const b of section.bullets) children.push(bulletParagraph(b.text));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: (content.formatting.marginTop ?? 0.5) * 1440,
            right: (content.formatting.marginRight ?? 0.5) * 1440,
            bottom: (content.formatting.marginBottom ?? 0.5) * 1440,
            left: (content.formatting.marginLeft ?? 0.5) * 1440,
          },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}
