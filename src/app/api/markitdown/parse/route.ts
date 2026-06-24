import { NextRequest, NextResponse } from "next/server";
import { convertPdfToMarkdown } from "@/lib/markitdown";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const result = await convertPdfToMarkdown(buffer, file.name);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ markdown: result.markdown });
}
