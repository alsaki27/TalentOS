// src/lib/falood/pdfExport.ts
// Renders a ResumeDocument to actual PDF bytes (@react-pdf/renderer), and provides an
// accurate page count by parsing the rendered PDF back with pdf-parse — measuring the
// real output rather than guessing from a text-length heuristic.

import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { SkarionResumePdf } from "@/lib/falood/skarionPdfDocument";
import { ResumeDocument } from "@/lib/falood/types";

export async function renderResumePdf(content: ResumeDocument): Promise<Buffer> {
  return renderToBuffer(React.createElement(SkarionResumePdf, { content }) as any);
}

export async function countPdfPages(pdfBuffer: Buffer): Promise<number> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  return result.total ?? 1;
}

export async function countResumePages(content: ResumeDocument): Promise<number> {
  const buffer = await renderResumePdf(content);
  return countPdfPages(buffer);
}
