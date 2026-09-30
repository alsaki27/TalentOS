import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";
import { uploadResumeFile, deleteResumeFile } from "@/lib/resumeStorage";

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15MB, same limit as skarion-student-audit

// Reuses the same pluggable storage backend as candidate resumes (R2 or
// SharePoint, whichever RESUME_STORAGE_PROVIDER selects) — these PDFs are
// just another kind of uploaded document, not resume-specific despite the
// helper's name.
export async function POST(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const session = await queryOne<{ student_id: string; pdf_url: string | null }>(
      `SELECT student_id, pdf_url FROM student_audit_mock_sessions WHERE id = $1`,
      [params.sessionId]
    );
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Please attach a valid PDF file (.pdf)" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "File too large. Maximum PDF size is 15MB." }, { status: 400 });
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const path = `student-audit/${session.student_id}/${params.sessionId}-${Date.now()}.pdf`;

    let uploaded: { url: string };
    try {
      uploaded = await uploadResumeFile(path, buffer, "application/pdf");
    } catch (err: any) {
      console.error("Mock session PDF upload failed:", err);
      return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
    }

    await execute(
      `UPDATE student_audit_mock_sessions SET pdf_url = $1, pdf_filename = $2, updated_at = now() WHERE id = $3`,
      [uploaded.url, file.name, params.sessionId]
    );

    if (session.pdf_url) {
      await deleteResumeFile(session.pdf_url).catch(() => {});
    }

    return NextResponse.json({ pdf_url: uploaded.url, pdf_filename: file.name });
  } catch (err: any) {
    console.error("POST student-audit mock session PDF error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const session = await queryOne<{ pdf_url: string | null }>(
      `SELECT pdf_url FROM student_audit_mock_sessions WHERE id = $1`,
      [params.sessionId]
    );
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    await deleteResumeFile(session.pdf_url).catch(() => {});
    await execute(
      `UPDATE student_audit_mock_sessions SET pdf_url = NULL, pdf_filename = NULL, updated_at = now() WHERE id = $1`,
      [params.sessionId]
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE student-audit mock session PDF error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
