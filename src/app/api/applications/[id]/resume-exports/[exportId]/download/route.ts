// src/app/api/applications/[id]/resume-exports/[exportId]/download/route.ts
// GET -> download a previously created export

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { findExportById } from "@/server/repositories/applicationResumeExportsRepository";
import { findResumeVersionById } from "@/server/repositories/applicationResumeVersionsRepository";
import { downloadFromSharePoint } from "@/lib/integrations/sharepoint";
import { exportResumeAsDocx, exportResumeAsPdf, exportResumeAsMarkdown } from "@/server/services/resumeExportService";
import { evidenceResumeExportIsAllowed } from "@/server/services/resumeEvidenceReleaseService";
import { sha256Hex } from "@/lib/sha256";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string; exportId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const exportRecord = await findExportById(params.exportId);
  if (!exportRecord || exportRecord.application_id !== params.id) {
    return NextResponse.json({ error: "Export not found" }, { status: 404 });
  }
  if (!await evidenceResumeExportIsAllowed(params.id, exportRecord.resume_version_id, exportRecord.id)) {
    return NextResponse.json({ error: "This is not the current approved resume PDF" }, { status: 409 });
  }

  if (exportRecord.status === "failed") {
    return NextResponse.json({ error: "This export failed previously. Please generate a new export." }, { status: 400 });
  }

  // Prefer the exact archived bytes. Re-generating here would not only be
  // slower, it can produce a different file after the resume has been edited;
  // it also cannot generate PDF on the Cloudflare worker. SharePoint is the
  // source of truth for client-rendered PDF/DOCX exports.
  if (exportRecord.storage_provider === "sharepoint" && exportRecord.storage_url) {
    try {
      const stored = await downloadFromSharePoint(exportRecord.storage_url);
      if (exportRecord.content_sha256 && await sha256Hex(new Uint8Array(stored.buffer)) !== exportRecord.content_sha256) {
        return NextResponse.json({ error: "The archived file does not match its recorded checksum" }, { status: 409 });
      }
      const contentType = exportRecord.export_type === "pdf"
        ? "application/pdf"
        : exportRecord.export_type === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : stored.contentType;
      return new NextResponse(new Blob([new Uint8Array(stored.buffer)]), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${exportRecord.file_name || stored.fileName}"`,
        },
      });
    } catch (err: any) {
      return NextResponse.json({ error: `Archived file could not be retrieved: ${err.message || err}` }, { status: 502 });
    }
  }

  const version = await findResumeVersionById(exportRecord.resume_version_id);
  if (!version) {
    return NextResponse.json({ error: "Resume version not found" }, { status: 404 });
  }

  try {
    let result;
    if (exportRecord.export_type === "docx") {
      result = await exportResumeAsDocx(params.id, exportRecord.resume_version_id, {});
    } else if (exportRecord.export_type === "pdf") {
      result = await exportResumeAsPdf(params.id, exportRecord.resume_version_id, {});
    } else if (exportRecord.export_type === "markdown" || exportRecord.export_type === "text") {
      result = await exportResumeAsMarkdown(params.id, exportRecord.resume_version_id, {});
    } else {
      return NextResponse.json({ error: "Unsupported export type" }, { status: 400 });
    }

    return new NextResponse(new Blob([new Uint8Array(result.buffer)]), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${exportRecord.file_name}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Download failed" }, { status: 500 });
  }
}
